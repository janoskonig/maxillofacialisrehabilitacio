import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { HttpError } from '@/lib/auth-server';
import { logger } from '@/lib/logger';
import {
  closeQuestionnaireTasksOnOptOut,
  getQuestionnaireReminderOptOut,
  parseOptOutBody,
  setQuestionnaireReminderOptOut,
} from '@/lib/questionnaire-reminder-optout';

export const dynamic = 'force-dynamic';

/**
 * GET /api/patients/[id]/questionnaire-reminders — leiratkozott-e a beteg a
 * kérdőív-emlékeztetőkről. PUT { optedOut: boolean } — személyzeti beállítás
 * (pl. a beteg szóban jelezte, hogy nem kér kérdőívet).
 */
export const GET = authedHandler(async (_req, { params }) => {
  const state = await getQuestionnaireReminderOptOut(getDbPool(), params.id);
  if (!state) throw new HttpError(404, 'Beteg nem található', 'PATIENT_NOT_FOUND');
  return NextResponse.json(state);
});

export const PUT = roleHandler(['admin', 'fogpótlástanász'], async (req, { auth, params }) => {
  const optedOut = parseOptOutBody(await req.json().catch(() => null));
  if (optedOut === null) throw new HttpError(400, 'Érvénytelen kérés', 'INVALID_BODY');

  const state = await setQuestionnaireReminderOptOut(getDbPool(), params.id, optedOut, auth.email);
  if (!state) throw new HttpError(404, 'Beteg nem található', 'PATIENT_NOT_FOUND');

  if (optedOut) {
    await closeQuestionnaireTasksOnOptOut(params.id).catch((err) =>
      logger.error(`[questionnaire-optout] feladat-zárás hiba (${params.id}):`, err),
    );
  }
  return NextResponse.json(state);
});

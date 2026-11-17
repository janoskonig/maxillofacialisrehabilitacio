import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { apiHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';
import {
  closeQuestionnaireTasksOnOptOut,
  getQuestionnaireReminderOptOut,
  parseOptOutBody,
  setQuestionnaireReminderOptOut,
} from '@/lib/questionnaire-reminder-optout';

export const dynamic = 'force-dynamic';

/**
 * GET /api/patient-portal/questionnaire-reminders — a beteg saját beállítása.
 * PUT { optedOut: boolean } — a beteg maga kapcsolja ki/be a kérdőív-emlékeztetőket.
 */
export const GET = apiHandler(async (req) => {
  const patientId = await verifyPatientPortalSession(req);
  if (!patientId) {
    return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
  }
  const state = await getQuestionnaireReminderOptOut(getDbPool(), patientId);
  if (!state) return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
  return NextResponse.json(state);
});

export const PUT = apiHandler(async (req) => {
  const patientId = await verifyPatientPortalSession(req);
  if (!patientId) {
    return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
  }
  const optedOut = parseOptOutBody(await req.json().catch(() => null));
  if (optedOut === null) {
    return NextResponse.json({ error: 'Érvénytelen kérés' }, { status: 400 });
  }
  const state = await setQuestionnaireReminderOptOut(getDbPool(), patientId, optedOut, 'patient');
  if (!state) return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });

  if (optedOut) {
    await closeQuestionnaireTasksOnOptOut(patientId).catch((err) =>
      logger.error(`[questionnaire-optout] feladat-zárás hiba (${patientId}):`, err),
    );
  }
  return NextResponse.json(state);
});

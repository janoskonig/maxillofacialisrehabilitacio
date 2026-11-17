import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { logActivityWithAuth } from '@/lib/activity';
import {
  getPatientInactivationState,
  inactivatePatient,
  reactivatePatient,
} from '@/lib/patient-inactivation';

export const dynamic = 'force-dynamic';

/** A beteg inaktivitási állapota (+ jövőbeli aktív időpontok száma). */
export const GET = authedHandler(async (_req, { params }) => {
  const state = await getPatientInactivationState(getDbPool(), params.id);
  return NextResponse.json({ inactivation: state });
});

/**
 * Beteg inaktiválása (vagy egy már inaktív beteg okának módosítása).
 * Body: { reason: PatientInactivationReason, note?: string }
 */
export const POST = roleHandler(['admin', 'fogpótlástanász'], async (req, { auth, params }) => {
  const pool = getDbPool();
  const body = await req.json().catch(() => ({}));
  await inactivatePatient(pool, params.id, auth.userId, { reason: body?.reason, note: body?.note });
  const state = await getPatientInactivationState(pool, params.id);
  await logActivityWithAuth(
    req,
    auth,
    'patient_inactivated',
    `Patient ID: ${params.id} — ok: ${state.inaktivalasOka}`,
  );
  return NextResponse.json({ inactivation: state });
});

/** Újraaktiválás. */
export const DELETE = roleHandler(['admin', 'fogpótlástanász'], async (req, { auth, params }) => {
  const pool = getDbPool();
  await reactivatePatient(pool, params.id);
  const state = await getPatientInactivationState(pool, params.id);
  await logActivityWithAuth(req, auth, 'patient_reactivated', `Patient ID: ${params.id}`);
  return NextResponse.json({ inactivation: state });
});

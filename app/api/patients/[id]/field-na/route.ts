import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import { NA_ELIGIBLE_KEYS, naFieldLabel } from '@/lib/patient-data-completeness';
import { reconcileMissingDataTasksSilent } from '@/lib/missing-data-reminders';

export const dynamic = 'force-dynamic';

/**
 * POST /api/patients/[id]/field-na
 *
 * Egy (feltételes kutatási) mező N/A ("nem értelmezhető / nem ismert")
 * megjelölése vagy a jelölés visszavonása. Csak admin. Test:
 *   { fieldKey: string, na: boolean, reason?: string }
 *
 * N/A-jelöléskor a mező többé nem számít adathiánynak (a statisztikában külön
 * megkülönböztethető), és a hozzá tartozó hiányt jelző állapot megszűnik.
 */
export const POST = roleHandler(['admin'], async (req, { auth, params }) => {
  const patientId = params.id;
  const body = (await req.json().catch(() => null)) as
    | { fieldKey?: unknown; na?: unknown; reason?: unknown }
    | null;

  const fieldKey = typeof body?.fieldKey === 'string' ? body.fieldKey : '';
  const na = body?.na === true;
  const reason =
    typeof body?.reason === 'string' && body.reason.trim() !== '' ? body.reason.trim() : null;

  if (!NA_ELIGIBLE_KEYS.has(fieldKey)) {
    throw new HttpError(400, 'Erre a mezőre nem állítható be N/A', 'INVALID_FIELD');
  }

  const pool = getDbPool();

  if (na) {
    await pool.query(
      `INSERT INTO patient_field_na (patient_id, field_key, reason, set_by_user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (patient_id, field_key)
       DO UPDATE SET reason = EXCLUDED.reason,
                     set_by_user_id = EXCLUDED.set_by_user_id,
                     set_at = NOW()`,
      [patientId, fieldKey, reason, auth.userId],
    );
  } else {
    await pool.query(
      `DELETE FROM patient_field_na WHERE patient_id = $1 AND field_key = $2`,
      [patientId, fieldKey],
    );
  }

  // Az N/A-jelölés megváltoztathatja, hogy a beteg "rendezett"-e → a nyitott
  // missing_data feladatok újraértékelése (csak N/A esetén csökkenhet a hiány).
  if (na) reconcileMissingDataTasksSilent(patientId);

  return NextResponse.json({
    success: true,
    patientId,
    fieldKey,
    label: naFieldLabel(fieldKey),
    na,
  });
});

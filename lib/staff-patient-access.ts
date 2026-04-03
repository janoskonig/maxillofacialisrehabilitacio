import { getDbPool } from '@/lib/db';

export async function assertStaffCanAccessPatient(
  staffUserId: string,
  staffEmail: string,
  staffRole: string,
  patientId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const pool = getDbPool();
  const patientResult = await pool.query(
    `SELECT id, kezeleoorvos FROM patients WHERE id = $1`,
    [patientId]
  );

  if (patientResult.rows.length === 0) {
    return { ok: false, status: 404, error: 'Beteg nem található' };
  }

  const patient = patientResult.rows[0];
  if (staffRole === 'admin' || patient.kezeleoorvos === staffEmail) {
    return { ok: true };
  }

  const userResult = await pool.query(`SELECT doktor_neve FROM users WHERE id = $1`, [staffUserId]);
  const userName = userResult.rows.length > 0 ? userResult.rows[0].doktor_neve : null;

  if (patient.kezeleoorvos === userName) {
    return { ok: true };
  }

  return { ok: false, status: 403, error: 'Nincs jogosultsága ehhez a beteghez' };
}

import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { apiHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req, { correlationId }) => {
  const patientId = await verifyPatientPortalSession(req);
  if (!patientId) {
    return NextResponse.json(
      { error: 'Nincs jogosultsága az adatok lekérdezéséhez' },
      { status: 401 }
    );
  }

  const pool = getDbPool();

  const patientResult = await pool.query(
    `SELECT kezeleoorvos_user_id, kezeleoorvos FROM patients WHERE id = $1`,
    [patientId]
  );

  if (patientResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Beteg nem található' },
      { status: 404 }
    );
  }

  const kezeleoorvosUserId: string | null = patientResult.rows[0].kezeleoorvos_user_id ?? null;
  const kezeleoorvosName: string | null = patientResult.rows[0].kezeleoorvos ?? null;

  const allDoctorsResult = await pool.query(
    `SELECT id, email, doktor_neve, role FROM users 
     WHERE active = true AND role != 'technikus'
     ORDER BY doktor_neve ASC, email ASC`
  );

  // Robosztus jelölés: első helyen a `kezeleoorvos_user_id` (027-es migráció
  // után minden új beteg ezt használja). Backward-compat fallback: a régi
  // VARCHAR mező alapján email/név szerinti illesztés (azoknál a betegeknél,
  // akik a backfill előtt érkeztek és még nincs user_id-juk).
  let treatingDoctorId: string | null = null;
  if (kezeleoorvosUserId) {
    const match = allDoctorsResult.rows.find((r: any) => r.id === kezeleoorvosUserId);
    if (match) {
      treatingDoctorId = match.id;
    }
  }
  if (!treatingDoctorId && kezeleoorvosName) {
    const match = allDoctorsResult.rows.find(
      (r: any) => r.email === kezeleoorvosName || r.doktor_neve === kezeleoorvosName
    );
    if (match) {
      treatingDoctorId = match.id;
    }
  }

  const recipients: Array<{ id: string; name: string; type: 'treating_doctor' | 'admin' | 'doctor' }> = [];

  for (const doctor of allDoctorsResult.rows) {
    let type: 'treating_doctor' | 'admin' | 'doctor' = 'doctor';
    if (doctor.id === treatingDoctorId) {
      type = 'treating_doctor';
    } else if (doctor.role === 'admin') {
      type = 'admin';
    }
    recipients.push({
      id: doctor.id,
      name: doctor.doktor_neve || doctor.email,
      type,
    });
  }

  // Kezelőorvos legyen elöl, utána admin, majd a többi
  recipients.sort((a, b) => {
    const order = { treating_doctor: 0, admin: 1, doctor: 2 };
    return order[a.type] - order[b.type];
  });

  return NextResponse.json({ recipients });
});

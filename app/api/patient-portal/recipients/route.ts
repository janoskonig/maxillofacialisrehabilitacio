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
    `SELECT kezeleoorvos FROM patients WHERE id = $1`,
    [patientId]
  );

  if (patientResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Beteg nem található' },
      { status: 404 }
    );
  }

  const recipients: Array<{ id: string; name: string; type: 'treating_doctor' | 'admin' }> = [];

  const kezeleoorvos = patientResult.rows[0].kezeleoorvos;
  if (kezeleoorvos) {
    const treatingDoctorResult = await pool.query(
      `SELECT id, email, doktor_neve FROM users 
       WHERE (email = $1 OR doktor_neve = $1) AND active = true 
       LIMIT 1`,
      [kezeleoorvos]
    );

    if (treatingDoctorResult.rows.length > 0) {
      const doctor = treatingDoctorResult.rows[0];
      recipients.push({
        id: doctor.id,
        name: doctor.doktor_neve || doctor.email,
        type: 'treating_doctor',
      });
    }
  }

  const adminResult = await pool.query(
    `SELECT id, email, doktor_neve FROM users 
     WHERE role = 'admin' AND active = true 
     ORDER BY email ASC 
     LIMIT 1`
  );

  if (adminResult.rows.length > 0) {
    const admin = adminResult.rows[0];
    if (recipients.length === 0 || recipients[0].id !== admin.id) {
      recipients.push({
        id: admin.id,
        name: admin.doktor_neve || admin.email,
        type: 'admin',
      });
    }
  }

  return NextResponse.json({ recipients });
});

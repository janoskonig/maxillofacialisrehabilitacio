import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { logger } from '@/lib/logger';

/**
 * GET /api/patient-portal/recipients - Kezelőorvos és admin adatainak lekérése
 * A páciensek ezt használhatják, hogy kiválasszák, kinek küldenek üzenetet
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Ellenőrizzük, hogy a páciens be van-e jelentkezve
    const patientId = await verifyPatientPortalSession(request);
    if (!patientId) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az adatok lekérdezéséhez' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    
    // Beteg adatainak lekérése (kezelőorvos mező)
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

    // Kezelőorvos lekérése
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

    // Admin lekérése (első aktív admin)
    const adminResult = await pool.query(
      `SELECT id, email, doktor_neve FROM users 
       WHERE role = 'admin' AND active = true 
       ORDER BY email ASC 
       LIMIT 1`
    );

    if (adminResult.rows.length > 0) {
      const admin = adminResult.rows[0];
      // Csak akkor adjuk hozzá, ha nem ugyanaz, mint a kezelőorvos
      if (recipients.length === 0 || recipients[0].id !== admin.id) {
        recipients.push({
          id: admin.id,
          name: admin.doktor_neve || admin.email,
          type: 'admin',
        });
      }
    }

    return NextResponse.json({ recipients });
  } catch (error) {
    logger.error('Error fetching recipients for patient:', error);
    return NextResponse.json(
      { error: 'Hiba történt az adatok lekérdezésekor' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession, clearPatientPortalSession } from '@/lib/patient-portal-server';
import { apiHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET - Retrieve account info with deletion eligibility
 */
export const GET = apiHandler(async (req) => {
  const patientId = await verifyPatientPortalSession(req);

  if (!patientId) {
    return NextResponse.json(
      { error: 'Bejelentkezés szükséges' },
      { status: 401 }
    );
  }

  const pool = getDbPool();

  const patientResult = await pool.query(
    `SELECT p.id, p.nev, p.taj, p.email, p.created_at,
            (SELECT COUNT(*) FROM appointments a 
             JOIN available_time_slots ats ON a.time_slot_id = ats.id 
             WHERE a.patient_id = p.id AND ats.start_time > NOW()) as upcoming_appointments
     FROM patients p WHERE p.id = $1`,
    [patientId]
  );

  if (patientResult.rows.length === 0) {
    return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
  }

  const patient = patientResult.rows[0];

  return NextResponse.json({
    canDelete: true,
    upcomingAppointments: parseInt(patient.upcoming_appointments, 10),
    retentionNotice: 'A magyar egészségügyi törvény (1997. évi CLIV. törvény) szerint az egészségügyi nyilvántartásokat az utolsó kezeléstől számított 30 évig meg kell őrizni. Az Ön kérésére az adatkezelést korlátozzuk, és az adatokat a törvényi megőrzési időszak letelte után töröljük.',
  });
});

/**
 * DELETE - Self-service account deletion (GDPR Art. 17)
 * Marks patient data as restricted and clears portal session.
 * Medical records are retained per Hungarian law but processing is restricted.
 */
export const DELETE = apiHandler(async (req) => {
  const patientId = await verifyPatientPortalSession(req);

  if (!patientId) {
    return NextResponse.json(
      { error: 'Bejelentkezés szükséges' },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { confirmDeletion } = body as { confirmDeletion?: boolean };

  if (!confirmDeletion) {
    return NextResponse.json(
      { error: 'A törlés megerősítése szükséges' },
      { status: 400 }
    );
  }

  const pool = getDbPool();

  try {
    const patientResult = await pool.query(
      'SELECT id, nev, taj, email FROM patients WHERE id = $1',
      [patientId]
    );

    if (patientResult.rows.length === 0) {
      return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
    }

    await pool.query('BEGIN');

    try {
      // Cancel upcoming appointments and free time slots
      const appointmentResult = await pool.query(
        `SELECT a.id, a.time_slot_id 
         FROM appointments a
         JOIN available_time_slots ats ON a.time_slot_id = ats.id
         WHERE a.patient_id = $1 AND ats.start_time > NOW()`,
        [patientId]
      );

      for (const appointment of appointmentResult.rows) {
        await pool.query('DELETE FROM appointments WHERE id = $1', [appointment.id]);
        await pool.query(
          'UPDATE available_time_slots SET status = $1 WHERE id = $2',
          ['available', appointment.time_slot_id]
        );
      }

      // Anonymize contact data (retain medical records per Hungarian law)
      await pool.query(
        `UPDATE patients SET
          email = NULL,
          telefonszam = NULL,
          cim = NULL,
          varos = NULL,
          iranyitoszam = NULL,
          intake_status = 'DELETED',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
        [patientId]
      );

      // Delete patient portal tokens
      await pool.query(
        'DELETE FROM patient_portal_tokens WHERE patient_id = $1',
        [patientId]
      );

      // Record consent withdrawal
      await pool.query(
        `UPDATE gdpr_consents SET withdrawn_at = CURRENT_TIMESTAMP 
         WHERE patient_id = $1 AND withdrawn_at IS NULL`,
        [patientId]
      );

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

    // Clear the portal session cookie
    await clearPatientPortalSession();

    logger.info(`Patient self-service deletion completed for patient ${patientId}`);

    return NextResponse.json({
      success: true,
      message: 'Fiók sikeresen törölve. A személyes adatok anonimizálva lettek. Az egészségügyi nyilvántartásokat a törvényi megőrzési kötelezettség szerint őrizzük meg.',
    });
  } catch (error) {
    logger.error('Error during patient self-service deletion:', error);
    return NextResponse.json(
      { error: 'Hiba történt a fiók törlése során' },
      { status: 500 }
    );
  }
});

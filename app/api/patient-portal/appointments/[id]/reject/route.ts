import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { sendConditionalAppointmentRequestToPatient } from '@/lib/email';
import { apiHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export const POST = apiHandler(async (req, { correlationId, params }) => {
  const patientId = await verifyPatientPortalSession(req);

  if (!patientId) {
    return NextResponse.json(
      { error: 'Bejelentkezés szükséges' },
      { status: 401 }
    );
  }

  const pool = getDbPool();

  const appointmentResult = await pool.query(
    `SELECT a.*, ats.start_time, ats.cim, ats.teremszam,
            p.nev as patient_name, p.email as patient_email, p.nem as patient_nem,
            u.doktor_neve, u.email as dentist_email
     FROM appointments a
     JOIN available_time_slots ats ON a.time_slot_id = ats.id
     JOIN patients p ON a.patient_id = p.id
     LEFT JOIN users u ON a.dentist_email = u.email
     WHERE a.id = $1 AND a.patient_id = $2 AND a.approval_status = 'pending'`,
    [params.id, patientId]
  );

  if (appointmentResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Időpont nem található, vagy már nem vár jóváhagyásra' },
      { status: 404 }
    );
  }

  const appointment = appointmentResult.rows[0];

  const startTime = new Date(appointment.start_time);
  if (startTime <= new Date()) {
    return NextResponse.json(
      { error: 'Ez az időpont már elmúlt, nem lehet elutasítani' },
      { status: 400 }
    );
  }

  const alternativeIdsRaw = appointment.alternative_time_slot_ids;
  const alternativeIds = Array.isArray(alternativeIdsRaw) 
    ? alternativeIdsRaw 
    : (alternativeIdsRaw ? [alternativeIdsRaw] : []);
  const currentAlternativeIndex = appointment.current_alternative_index;

  let nextAlternativeIndex: number | null = null;
  if (currentAlternativeIndex === null) {
    nextAlternativeIndex = alternativeIds.length > 0 ? 0 : null;
  } else if (currentAlternativeIndex < alternativeIds.length - 1) {
    nextAlternativeIndex = currentAlternativeIndex + 1;
  }

  await pool.query('BEGIN');

  try {
    if (nextAlternativeIndex !== null) {
      const nextAlternativeId = alternativeIds[nextAlternativeIndex];

      await pool.query(
        'UPDATE available_time_slots SET status = $1 WHERE id = $2',
        ['available', appointment.time_slot_id]
      );

      const nextAltSlotResult = await pool.query(
        `SELECT ats.*, u.doktor_neve, u.email as dentist_email
         FROM available_time_slots ats
         JOIN users u ON ats.user_id = u.id
         WHERE ats.id = $1`,
        [nextAlternativeId]
      );

      if (nextAltSlotResult.rows.length === 0 || nextAltSlotResult.rows[0].status !== 'available') {
        await pool.query(
          'UPDATE appointments SET approval_status = $1 WHERE id = $2',
          ['rejected', appointment.id]
        );

        const validIds = alternativeIds.filter((id: any) => id && typeof id === 'string');
        if (validIds.length > 0) {
          await pool.query(
            'UPDATE available_time_slots SET status = $1 WHERE id = ANY($2::uuid[])',
            ['available', validIds]
          );
        }

        await pool.query('COMMIT');

        return NextResponse.json({
          success: true,
          message: 'Időpont elutasítva. Az alternatív időpontok már nem elérhetők.',
          hasMoreAlternatives: false,
        });
      }

      const nextAltSlot = nextAltSlotResult.rows[0];

      await pool.query(
        'UPDATE available_time_slots SET status = $1 WHERE id = $2',
        ['booked', nextAlternativeId]
      );

      await pool.query(
        `UPDATE appointments 
         SET time_slot_id = $1, current_alternative_index = $2, approval_status = 'pending'
         WHERE id = $3`,
        [nextAlternativeId, nextAlternativeIndex, appointment.id]
      );

      await pool.query('COMMIT');

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
        (req.headers.get('origin') || 'http://localhost:3000');

      const dentistFullName = nextAltSlot.doktor_neve || nextAltSlot.dentist_email;
      const nextStartTime = new Date(nextAltSlot.start_time);

      let remainingAlternatives: Array<{ id: string; startTime: Date; cim: string | null; teremszam: string | null }> = [];
      const remainingIds = alternativeIds.slice(nextAlternativeIndex + 1);
      if (remainingIds.length > 0) {
        const remainingSlotsResult = await pool.query(
          `SELECT ats.id, ats.start_time, ats.cim, ats.teremszam
           FROM available_time_slots ats
           WHERE ats.id = ANY($1::uuid[])
           ORDER BY ats.start_time ASC`,
          [remainingIds]
        );
        remainingAlternatives = remainingSlotsResult.rows.map((row: any) => ({
          id: row.id,
          startTime: new Date(row.start_time),
          cim: row.cim,
          teremszam: row.teremszam,
        }));
      }

      try {
        await sendConditionalAppointmentRequestToPatient(
          appointment.patient_email,
          appointment.patient_name,
          appointment.patient_nem,
          nextStartTime,
          dentistFullName,
          appointment.approval_token,
          baseUrl,
          remainingAlternatives,
          nextAltSlot.cim,
          nextAltSlot.teremszam,
          false
        );
      } catch (emailError) {
        logger.error('Failed to send alternative appointment email:', emailError);
      }

      return NextResponse.json({
        success: true,
        message: 'Időpont elutasítva. Egy alternatív időpontot küldtünk emailben.',
        hasMoreAlternatives: true,
        nextAppointment: {
          id: appointment.id,
          startTime: nextStartTime.toISOString(),
          cim: nextAltSlot.cim,
          teremszam: nextAltSlot.teremszam,
          dentistName: dentistFullName,
        },
      });
    } else {
      await pool.query(
        'UPDATE appointments SET approval_status = $1 WHERE id = $2',
        ['rejected', appointment.id]
      );

      await pool.query(
        'UPDATE available_time_slots SET status = $1 WHERE id = $2',
        ['available', appointment.time_slot_id]
      );

      const validIds = alternativeIds.filter((id: any) => id && typeof id === 'string');
      if (validIds.length > 0) {
        await pool.query(
          'UPDATE available_time_slots SET status = $1 WHERE id = ANY($2::uuid[])',
          ['available', validIds]
        );
      }

      await pool.query('COMMIT');

      return NextResponse.json({
        success: true,
        message: 'Időpont elutasítva. Az összes időpont újra foglalhatóvá vált.',
        hasMoreAlternatives: false,
      });
    }
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
});

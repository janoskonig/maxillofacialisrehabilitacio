import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { sendAppointmentCancellationNotification, sendEmail } from '@/lib/email';
import { deleteGoogleCalendarEvent, createGoogleCalendarEvent } from '@/lib/google-calendar';
import { apiHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

/**
 * Modify patient's appointment (change time slot)
 * PUT /api/patient-portal/appointments/[id]
 * DISABLED: Patients are not allowed to modify appointments
 */
export const dynamic = 'force-dynamic';

export const PUT = apiHandler(async (req, { correlationId, params }) => {
  return NextResponse.json(
    { error: 'Az időpontok módosítása nem engedélyezett' },
    { status: 403 }
  );
});

/**
 * Cancel patient's appointment
 * DELETE /api/patient-portal/appointments/[id]
 */
export const DELETE = apiHandler(async (req, { correlationId, params }) => {
  const patientId = await verifyPatientPortalSession(req);

  if (!patientId) {
    return NextResponse.json(
      { error: 'Bejelentkezés szükséges' },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { cancellationReason } = body;

  if (!cancellationReason || typeof cancellationReason !== 'string' || cancellationReason.trim().length === 0) {
    return NextResponse.json(
      { error: 'A lemondás indokának megadása kötelező' },
      { status: 400 }
    );
  }

  const pool = getDbPool();

  const appointmentResult = await pool.query(
    `SELECT 
      a.id,
      a.patient_id,
      a.time_slot_id,
      a.created_by,
      a.dentist_email,
      a.google_calendar_event_id,
      a.appointment_status,
      ats.start_time,
      ats.user_id as time_slot_user_id,
      ats.source as time_slot_source,
      ats.google_calendar_event_id as time_slot_google_calendar_event_id,
      p.nev as patient_name,
      p.taj as patient_taj,
      p.email as patient_email,
      u.doktor_neve as dentist_name
    FROM appointments a
    JOIN available_time_slots ats ON a.time_slot_id = ats.id
    JOIN patients p ON a.patient_id = p.id
    LEFT JOIN users u ON a.dentist_email = u.email
    WHERE a.id = $1 AND a.patient_id = $2`,
    [params.id, patientId]
  );

  if (appointmentResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Időpont nem található vagy nincs jogosultsága lemondani' },
      { status: 404 }
    );
  }

  const appointment = appointmentResult.rows[0];

  if (appointment.appointment_status === 'cancelled_by_patient' || appointment.appointment_status === 'cancelled_by_doctor') {
    return NextResponse.json(
      { error: 'Ez az időpont már le van mondva' },
      { status: 400 }
    );
  }

  const startTime = new Date(appointment.start_time);
  if (startTime <= new Date()) {
    return NextResponse.json(
      { error: 'Csak jövőbeli időpontot lehet lemondani' },
      { status: 400 }
    );
  }

  await pool.query('BEGIN');

  try {
    await pool.query(
      `UPDATE appointments 
       SET appointment_status = $1, completion_notes = $2
       WHERE id = $3`,
      ['cancelled_by_patient', cancellationReason.trim(), params.id]
    );

    await pool.query(
      'UPDATE available_time_slots SET status = $1 WHERE id = $2',
      ['available', appointment.time_slot_id]
    );

    await pool.query('COMMIT');

    try {
      const dentistFullName = appointment.dentist_name || appointment.dentist_email;

      await Promise.all([
        sendAppointmentCancellationNotification(
          appointment.dentist_email,
          appointment.patient_name,
          appointment.patient_taj,
          startTime,
          'Páciens portál',
          cancellationReason.trim()
        ),
        (async () => {
          if (appointment.google_calendar_event_id && appointment.time_slot_user_id) {
            try {
              const userCalendarResult = await pool.query(
                `SELECT google_calendar_source_calendar_id, google_calendar_target_calendar_id 
                 FROM users 
                 WHERE id = $1`,
                [appointment.time_slot_user_id]
              );
              const sourceCalendarId = userCalendarResult.rows[0]?.google_calendar_source_calendar_id || 'primary';
              const targetCalendarId = userCalendarResult.rows[0]?.google_calendar_target_calendar_id || 'primary';

              await deleteGoogleCalendarEvent(
                appointment.time_slot_user_id,
                appointment.google_calendar_event_id,
                targetCalendarId
              );
              logger.info('[Patient Portal Cancellation] Deleted patient event from target calendar');

              const isFromGoogleCalendar = appointment.time_slot_source === 'google_calendar' && appointment.time_slot_google_calendar_event_id;

              if (isFromGoogleCalendar) {
                const endTime = new Date(startTime);
                endTime.setMinutes(endTime.getMinutes() + 30);

                const szabadEventId = await createGoogleCalendarEvent(
                  appointment.time_slot_user_id,
                  {
                    summary: 'szabad',
                    description: 'Szabad időpont',
                    startTime: startTime,
                    endTime: endTime,
                    location: 'Maxillofaciális Rehabilitáció',
                    calendarId: sourceCalendarId,
                  }
                );

                if (szabadEventId) {
                  logger.info('[Patient Portal Cancellation] Recreated "szabad" event in source calendar');
                  await pool.query(
                    `UPDATE available_time_slots 
                     SET google_calendar_event_id = $1 
                     WHERE id = $2`,
                    [szabadEventId, appointment.time_slot_id]
                  );
                }
              }
            } catch (error) {
              logger.error('Failed to handle Google Calendar event:', error);
            }
          }
        })(),
      ]);
    } catch (emailError) {
      logger.error('Failed to send cancellation email:', emailError);
    }

    try {
      const adminResult = await pool.query(
        'SELECT email FROM users WHERE role = $1 AND active = true',
        ['admin']
      );
      const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);

      if (adminEmails.length > 0) {
        const dentistFullName = appointment.dentist_name || appointment.dentist_email;
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #dc2626;">Időpont lemondva - Páciens portál</h2>
            <p>Kedves adminisztrátor,</p>
            <p>Egy páciens lemondta az időpontját a páciens portálon keresztül:</p>
            <ul>
              <li><strong>Beteg neve:</strong> ${appointment.patient_name || 'Név nélküli'}</li>
              <li><strong>TAJ szám:</strong> ${appointment.patient_taj || 'Nincs megadva'}</li>
              <li><strong>Időpont:</strong> ${startTime.toLocaleString('hu-HU')}</li>
              <li><strong>Fogpótlástanász:</strong> ${dentistFullName}</li>
              <li><strong>Lemondás indoka:</strong> ${cancellationReason.trim()}</li>
            </ul>
            <p>Az időpont újra elérhetővé vált a rendszerben.</p>
            <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
          </div>
        `;

        await sendEmail({
          to: adminEmails,
          subject: 'Időpont lemondva - Páciens portál - Maxillofaciális Rehabilitáció',
          html,
        });
      }
    } catch (adminEmailError) {
      logger.error('Failed to send cancellation email to admins:', adminEmailError);
    }

    return NextResponse.json({
      success: true,
      message: 'Időpont sikeresen lemondva!',
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
});

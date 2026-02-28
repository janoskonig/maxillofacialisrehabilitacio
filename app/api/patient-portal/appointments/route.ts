import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { sendEmail, sendAppointmentBookingNotification, sendAppointmentBookingNotificationToPatient, sendAppointmentBookingNotificationToAdmins } from '@/lib/email';
import { generateIcsFile } from '@/lib/calendar';
import { createGoogleCalendarEvent, deleteGoogleCalendarEvent } from '@/lib/google-calendar';
import { apiHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

/**
 * Get patient's appointments
 * GET /api/patient-portal/appointments
 */
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req, { correlationId }) => {
  const patientId = await verifyPatientPortalSession(req);

  if (!patientId) {
    return NextResponse.json(
      { error: 'Bejelentkezés szükséges' },
      { status: 401 }
    );
  }

  const pool = getDbPool();

  const result = await pool.query(
    `SELECT 
      a.id,
      a.patient_id as "patientId",
      a.time_slot_id as "timeSlotId",
      a.created_by as "createdBy",
      a.dentist_email as "dentistEmail",
      a.created_at as "createdAt",
      a.approval_token as "approvalToken",
      a.appointment_status as "appointmentStatus",
      a.approval_status as "approvalStatus",
      ats.start_time as "startTime",
      ats.cim,
      ats.teremszam,
      u.doktor_neve as "dentistName"
    FROM appointments a
    JOIN available_time_slots ats ON a.time_slot_id = ats.id
    LEFT JOIN users u ON a.dentist_email = u.email
    WHERE a.patient_id = $1
    ORDER BY ats.start_time DESC`,
    [patientId]
  );

  return NextResponse.json({
    appointments: result.rows,
  });
});

/**
 * Request new appointment (without time slot selection) OR book appointment directly (with timeSlotId)
 * POST /api/patient-portal/appointments
 */
export const POST = apiHandler(async (req, { correlationId }) => {
  const patientId = await verifyPatientPortalSession(req);

  if (!patientId) {
    return NextResponse.json(
      { error: 'Bejelentkezés szükséges' },
      { status: 401 }
    );
  }

  const body = await req.json();
  const { beutaloOrvos, beutaloIndokolas, timeSlotId } = body;

  if (timeSlotId) {
    return await handleDirectBooking(patientId, timeSlotId);
  }

  const pool = getDbPool();

  const patientResult = await pool.query(
    'SELECT id, email, nev, taj FROM patients WHERE id = $1',
    [patientId]
  );

  if (patientResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Beteg nem található' },
      { status: 404 }
    );
  }

  const patient = patientResult.rows[0];

  if (!patient.email || patient.email.trim() === '') {
    return NextResponse.json(
      { error: 'Email cím szükséges az időpont kéréséhez' },
      { status: 400 }
    );
  }

  if (beutaloOrvos || beutaloIndokolas) {
    await pool.query(
      `INSERT INTO patient_referral (patient_id, beutalo_orvos, beutalo_indokolas)
       VALUES ($1, $2, $3)
       ON CONFLICT (patient_id) DO UPDATE SET
         beutalo_orvos = COALESCE(EXCLUDED.beutalo_orvos, patient_referral.beutalo_orvos),
         beutalo_indokolas = COALESCE(EXCLUDED.beutalo_indokolas, patient_referral.beutalo_indokolas)`,
      [patientId, beutaloOrvos?.trim() || null, beutaloIndokolas?.trim() || null]
    );
  }

  try {
    const adminResult = await pool.query(
      'SELECT email FROM users WHERE role = $1 AND active = true',
      ['admin']
    );
    const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);

    if (adminEmails.length > 0) {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">Új időpont kérés a páciens portálról</h2>
          <p>Kedves adminisztrátor,</p>
          <p>Egy páciens új időpontot kért a páciens portálon keresztül:</p>
          <ul>
            <li><strong>Beteg neve:</strong> ${patient.nev || 'Név nélküli'}</li>
            <li><strong>TAJ szám:</strong> ${patient.taj || 'Nincs megadva'}</li>
            <li><strong>Email cím:</strong> ${patient.email}</li>
            ${beutaloOrvos ? `<li><strong>Beutaló orvos:</strong> ${beutaloOrvos}</li>` : ''}
            ${beutaloIndokolas ? `<li><strong>Beutalás indoka:</strong> ${beutaloIndokolas}</li>` : ''}
          </ul>
          <p>Kérjük, jelentkezzen be a rendszerbe és válasszon időpontot a páciens számára.</p>
          <p>Üdvözlettel,<br>Maxillofaciális Rehabilitáció Rendszer</p>
        </div>
      `;

      await sendEmail({
        to: adminEmails,
        subject: 'Új időpont kérés a páciens portálról - Maxillofaciális Rehabilitáció',
        html,
      });
    }
  } catch (emailError) {
    logger.error('Hiba az értesítő email küldésekor:', emailError);
  }

  return NextResponse.json({
    success: true,
    message: 'Időpont kérés sikeresen elküldve. Az adminisztráció hamarosan felveszi Önnel a kapcsolatot.',
  });
});

/**
 * Handle direct booking of an appointment
 */
async function handleDirectBooking(patientId: string, timeSlotId: string) {
  const pool = getDbPool();
  const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';

  await pool.query('BEGIN');

  try {
    const patientResult = await pool.query(
      'SELECT id, email, nev, taj, nem FROM patients WHERE id = $1',
      [patientId]
    );

    if (patientResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    const patient = patientResult.rows[0];

    const timeSlotResult = await pool.query(
      `SELECT ats.*, u.email as dentist_email, u.id as dentist_user_id, u.doktor_neve as dentist_name
       FROM available_time_slots ats
       JOIN users u ON ats.user_id = u.id
       WHERE ats.id = $1
       FOR UPDATE`,
      [timeSlotId]
    );

    if (timeSlotResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Időpont nem található' },
        { status: 404 }
      );
    }

    const timeSlot = timeSlotResult.rows[0];

    // G3: Patient portal — only consult/flexible slots
    const slotPurpose = timeSlot.slot_purpose;
    if (slotPurpose !== 'consult' && slotPurpose !== 'flexible') {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        {
          error: 'Ez az időpont típusa nem foglalható közvetlenül a páciens portálon. Kérjük, kérjen időpontot az adminisztrációtól.',
          code: 'WORK_CONTROL_SLOT_NOT_ALLOWED',
        },
        { status: 403 }
      );
    }

    const slotState = timeSlot.state ?? (timeSlot.status === 'available' ? 'free' : 'booked');
    if (slotState !== 'free') {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Ez az időpont már le van foglalva' },
        { status: 400 }
      );
    }

    const startTime = new Date(timeSlot.start_time);
    if (startTime <= new Date()) {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Csak jövőbeli időpontot lehet foglalni' },
        { status: 400 }
      );
    }

    const appointmentResult = await pool.query(
      `INSERT INTO appointments (patient_id, time_slot_id, created_by, dentist_email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (time_slot_id) 
       DO UPDATE SET
         patient_id = EXCLUDED.patient_id,
         created_by = EXCLUDED.created_by,
         dentist_email = EXCLUDED.dentist_email,
         appointment_status = NULL,
         completion_notes = NULL,
         google_calendar_event_id = NULL,
         approved_at = NULL,
         approval_status = NULL,
         approval_token = NULL,
         alternative_time_slot_ids = NULL,
         current_alternative_index = NULL,
         is_late = false
       WHERE appointments.appointment_status IN ('cancelled_by_patient', 'cancelled_by_doctor')
       RETURNING 
         id,
         patient_id as "patientId",
         time_slot_id as "timeSlotId",
         created_by as "createdBy",
         dentist_email as "dentistEmail",
         created_at as "createdAt"`,
      [patientId, timeSlotId, 'patient-portal', timeSlot.dentist_email]
    );

    const appointment = appointmentResult.rows[0];

    if (!appointment) {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        {
          error: 'Ez az időpont már le van foglalva egy aktív foglalással. Kérjük, válasszon másik időpontot.',
          code: 'SLOT_HAS_ACTIVE_APPOINTMENT',
        },
        { status: 409 }
      );
    }

    await pool.query(
      `UPDATE available_time_slots SET status = 'booked', state = 'booked' WHERE id = $1`,
      [timeSlotId]
    );

    await pool.query('COMMIT');

    const appointmentCim = timeSlot.cim || DEFAULT_CIM;
    const appointmentTeremszam = timeSlot.teremszam || null;
    const dentistFullName = timeSlot.dentist_name || timeSlot.dentist_email;

    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + 30);

    const icsFileData = {
      patientName: patient.nev,
      patientTaj: patient.taj,
      startTime: startTime,
      surgeonName: 'Páciens portál',
      dentistName: dentistFullName,
    };
    const icsFile = await generateIcsFile(icsFileData);

    try {
      const [adminResult] = await Promise.all([
        pool.query('SELECT email FROM users WHERE role = $1 AND active = true', ['admin']),
      ]);

      const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);
      const adminEmail = adminEmails.length > 0 ? adminEmails[0] : '';

      await Promise.all([
        sendAppointmentBookingNotification(
          timeSlot.dentist_email,
          patient.nev,
          patient.taj,
          startTime,
          'Páciens portál',
          icsFile,
          appointmentCim,
          appointmentTeremszam
        ),
        patient.email && patient.email.trim() !== ''
          ? sendAppointmentBookingNotificationToPatient(
              patient.email,
              patient.nev,
              patient.nem,
              startTime,
              dentistFullName,
              timeSlot.dentist_email,
              icsFile,
              appointmentCim,
              appointmentTeremszam,
              adminEmail
            )
          : Promise.resolve(),
        adminEmails.length > 0
          ? sendAppointmentBookingNotificationToAdmins(
              adminEmails,
              patient.nev,
              patient.taj,
              startTime,
              'Páciens portál',
              timeSlot.dentist_email,
              icsFile,
              appointmentCim,
              appointmentTeremszam
            )
          : Promise.resolve(),
        (async () => {
          try {
            const googleCalendarEventId = timeSlot.google_calendar_event_id;
            const source = timeSlot.source;

            logger.info('[Patient Portal Booking] Time slot info:', {
              id: timeSlot.id,
              google_calendar_event_id: googleCalendarEventId,
              source: source,
              dentist_user_id: timeSlot.dentist_user_id,
              status: timeSlot.status
            });

            const isFromGoogleCalendar = googleCalendarEventId && source === 'google_calendar';

            let finalEventId: string | null = null;

            const userCalendarResult = await pool.query(
              `SELECT google_calendar_enabled, google_calendar_source_calendar_id, google_calendar_target_calendar_id 
               FROM users 
               WHERE id = $1`,
              [timeSlot.dentist_user_id]
            );
            if (userCalendarResult.rows[0]?.google_calendar_enabled !== true) {
              logger.info('[Patient Portal Booking] Slot owner has Google Calendar disabled, skipping sync');
              return;
            }
            const sourceCalendarId = userCalendarResult.rows[0]?.google_calendar_source_calendar_id || 'primary';
            const targetCalendarId = userCalendarResult.rows[0]?.google_calendar_target_calendar_id || 'primary';

            if (isFromGoogleCalendar) {
              logger.info('[Patient Portal Booking] Deleting "szabad" event from source calendar:', googleCalendarEventId);
              const deleteResult = await deleteGoogleCalendarEvent(
                timeSlot.dentist_user_id,
                googleCalendarEventId,
                sourceCalendarId
              );
              logger.info('[Patient Portal Booking] Delete result:', deleteResult);

              logger.info('[Patient Portal Booking] Creating new event with patient name in target calendar');
              const newEventId = await createGoogleCalendarEvent(
                timeSlot.dentist_user_id,
                {
                  summary: `Betegfogadás - ${patient.nev || 'Név nélküli beteg'}`,
                  description: `Beteg: ${patient.nev || 'Név nélküli'}\nTAJ: ${patient.taj || 'Nincs megadva'}\nBeutaló orvos: Páciens portál`,
                  startTime: startTime,
                  endTime: endTime,
                  location: 'Maxillofaciális Rehabilitáció',
                  calendarId: targetCalendarId,
                }
              );
              finalEventId = newEventId;

              if (!newEventId) {
                logger.error('[Patient Portal Booking] Failed to create new Google Calendar event in target calendar');
              } else {
                logger.info('[Patient Portal Booking] Successfully created new event with patient name in target calendar');
              }
            } else {
              logger.info('[Patient Portal Booking] Time slot is not from Google Calendar, creating new event');
              const newEventId = await createGoogleCalendarEvent(
                timeSlot.dentist_user_id,
                {
                  summary: `Betegfogadás - ${patient.nev || 'Név nélküli beteg'}`,
                  description: `Beteg: ${patient.nev || 'Név nélküli'}\nTAJ: ${patient.taj || 'Nincs megadva'}\nBeutaló orvos: Páciens portál`,
                  startTime: startTime,
                  endTime: endTime,
                  location: 'Maxillofaciális Rehabilitáció',
                  calendarId: targetCalendarId,
                }
              );
              finalEventId = newEventId;
            }

            logger.info('[Patient Portal Booking] Final event ID:', finalEventId);

            if (finalEventId) {
              await pool.query(
                'UPDATE appointments SET google_calendar_event_id = $1 WHERE id = $2',
                [finalEventId, appointment.id]
              );
            }
          } catch (error) {
            logger.error('[Patient Portal Booking] Failed to handle Google Calendar event:', error);
          }
        })(),
      ]);
    } catch (emailError) {
      logger.error('Hiba az értesítő email küldésekor:', emailError);
    }

    return NextResponse.json({
      success: true,
      appointment,
      message: 'Időpont sikeresen lefoglalva!',
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

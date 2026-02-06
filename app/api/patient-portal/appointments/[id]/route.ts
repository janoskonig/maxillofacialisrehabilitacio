import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { sendAppointmentModificationNotification, sendAppointmentModificationNotificationToPatient, sendAppointmentCancellationNotification, sendEmail } from '@/lib/email';
import { generateIcsFile } from '@/lib/calendar';
import { deleteGoogleCalendarEvent, createGoogleCalendarEvent } from '@/lib/google-calendar';

/**
 * Modify patient's appointment (change time slot)
 * PUT /api/patient-portal/appointments/[id]
 * DISABLED: Patients are not allowed to modify appointments
 */
export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Patients are not allowed to modify appointments
  return NextResponse.json(
    { error: 'Az időpontok módosítása nem engedélyezett' },
    { status: 403 }
  );
  
  /* DISABLED CODE - Patients cannot modify appointments
  try {
    const patientId = await verifyPatientPortalSession(request);

    if (!patientId) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { timeSlotId, startTime, teremszam } = body;

    // Either timeSlotId or startTime must be provided
    if (!timeSlotId && !startTime) {
      return NextResponse.json(
        { error: 'Időpont ID vagy dátum/idő megadása kötelező' },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    // Get current appointment details and verify it belongs to this patient
    const appointmentResult = await pool.query(
      `SELECT 
        a.id,
        a.patient_id,
        a.time_slot_id as old_time_slot_id,
        a.created_by,
        a.dentist_email,
        a.google_calendar_event_id,
        ats.start_time as old_start_time,
        ats.user_id as time_slot_user_id,
        p.nev as patient_name,
        p.taj as patient_taj,
        p.email as patient_email,
        u.email as time_slot_user_email
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN users u ON ats.user_id = u.id
      WHERE a.id = $1 AND a.patient_id = $2`,
      [params.id, patientId]
    );

    if (appointmentResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Időpont nem található vagy nincs jogosultsága módosítani' },
        { status: 404 }
      );
    }

    const appointment = appointmentResult.rows[0];

    // Check if appointment is in the future (can only modify future appointments)
    const oldStartTime = new Date(appointment.old_start_time);
    if (oldStartTime <= new Date()) {
      return NextResponse.json(
        { error: 'Csak jövőbeli időpontot lehet módosítani' },
        { status: 400 }
      );
    }

    // Check if appointment is approved (patients can only modify approved appointments)
    const approvalStatusResult = await pool.query(
      'SELECT approval_status FROM appointments WHERE id = $1',
      [params.id]
    );
    
    if (approvalStatusResult.rows.length > 0) {
      const approvalStatus = approvalStatusResult.rows[0].approval_status;
      if (approvalStatus === 'pending') {
        return NextResponse.json(
          { error: 'A jóváhagyásra váró időpontot nem lehet módosítani. Kérjük, először várja meg a jóváhagyást.' },
          { status: 400 }
        );
      }
      if (approvalStatus === 'rejected') {
        return NextResponse.json(
          { error: 'Az elutasított időpontot nem lehet módosítani.' },
          { status: 400 }
        );
      }
    }

    let newTimeSlot: any;
    let newStartTime: Date;
    let finalTimeSlotId: string;
    let existingAppointmentId: string | null = null;

    // If startTime is provided, create a new time slot
    if (startTime) {
      const startDate = new Date(startTime);
      const now = new Date();

      // Validate that start time is in the future
      if (startDate <= now) {
        return NextResponse.json(
          { error: 'Az időpont csak jövőbeli dátum lehet' },
          { status: 400 }
        );
      }

      newStartTime = startDate;

      // Get the dentist user ID from the current appointment's time slot
      const dentistUserResult = await pool.query(
        `SELECT ats.user_id, u.email as dentist_email
         FROM available_time_slots ats
         LEFT JOIN users u ON ats.user_id = u.id
         WHERE ats.id = $1`,
        [appointment.old_time_slot_id]
      );

      if (dentistUserResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Nem található fogpótlástanász az időponthoz' },
          { status: 404 }
        );
      }

      const dentistUserId = dentistUserResult.rows[0].user_id;
      const dentistEmail = dentistUserResult.rows[0].dentist_email;
      const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';

      // Create new time slot
      const newSlotResult = await pool.query(
        `INSERT INTO available_time_slots (user_id, start_time, status, cim, teremszam)
         VALUES ($1, $2, 'booked', $3, $4)
         RETURNING id, start_time, cim, teremszam`,
        [dentistUserId, startTime, DEFAULT_CIM, teremszam || null]
      );

      finalTimeSlotId = newSlotResult.rows[0].id;
      newTimeSlot = {
        id: finalTimeSlotId,
        start_time: startTime,
        dentist_email: dentistEmail,
        dentist_user_id: dentistUserId,
        cim: DEFAULT_CIM,
        teremszam: teremszam || null,
      };
    } else if (timeSlotId) {
      // Use existing time slot (legacy support)
      const newTimeSlotResult = await pool.query(
        `SELECT ats.*, u.email as dentist_email, u.id as dentist_user_id
         FROM available_time_slots ats
         LEFT JOIN users u ON ats.user_id = u.id
         WHERE ats.id = $1`,
        [timeSlotId]
      );

      if (newTimeSlotResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Új időpont nem található' },
          { status: 404 }
        );
      }

      newTimeSlot = newTimeSlotResult.rows[0];
      newStartTime = new Date(newTimeSlot.start_time);
      finalTimeSlotId = timeSlotId;

      // Check if new time slot is in the future
      if (newStartTime <= new Date()) {
        return NextResponse.json(
          { error: 'Csak jövőbeli időpontra lehet módosítani' },
          { status: 400 }
        );
      }

      // Don't allow changing to the same time slot
      if (appointment.old_time_slot_id === timeSlotId) {
        return NextResponse.json(
          { error: 'Az új időpont megegyezik a régi időponttal' },
          { status: 400 }
        );
      }

      // Check if new time slot is booked - if so, we need to swap appointments
      if (newTimeSlot.status === 'booked') {
        const existingAppointmentResult = await pool.query(
          'SELECT id, patient_id FROM appointments WHERE time_slot_id = $1',
          [timeSlotId]
        );
        
        if (existingAppointmentResult.rows.length > 0) {
          existingAppointmentId = existingAppointmentResult.rows[0].id;
        }
      }
    } else {
      return NextResponse.json(
        { error: 'Időpont ID vagy dátum/idő megadása kötelező' },
        { status: 400 }
      );
    }

    // Start transaction
    await pool.query('BEGIN');

    try {
      if (newTimeSlot.status === 'booked' && existingAppointmentId) {
        // Swap appointments: move existing appointment to old time slot
        await pool.query(
          `UPDATE appointments 
           SET time_slot_id = $1, dentist_email = $2
           WHERE id = $3`,
          [appointment.old_time_slot_id, appointment.dentist_email, existingAppointmentId]
        );
      }

      // Update current appointment to new time slot
      const updateResult = await pool.query(
        `UPDATE appointments 
         SET time_slot_id = $1, dentist_email = $2
         WHERE id = $3
         RETURNING 
           id,
           patient_id as "patientId",
           time_slot_id as "timeSlotId",
           created_by as "createdBy",
           dentist_email as "dentistEmail",
           created_at as "createdAt"`,
        [timeSlotId, newTimeSlot.dentist_email, params.id]
      );

      // Update old time slot status
      if (newTimeSlot.status === 'booked' && existingAppointmentId) {
        // Old slot becomes booked (by the swapped appointment)
        await pool.query(
          'UPDATE available_time_slots SET status = $1 WHERE id = $2',
          ['booked', appointment.old_time_slot_id]
        );
      } else {
        // Old slot becomes available
        await pool.query(
          'UPDATE available_time_slots SET status = $1 WHERE id = $2',
          ['available', appointment.old_time_slot_id]
        );
      }

      // Update new time slot status (always booked after modification)
      await pool.query(
        'UPDATE available_time_slots SET status = $1 WHERE id = $2',
        ['booked', timeSlotId]
      );

      await pool.query('COMMIT');

      const updatedAppointment = updateResult.rows[0];

      // Send email notifications and update Google Calendar event (parallel)
      const newEndTime = new Date(newStartTime);
      newEndTime.setMinutes(newEndTime.getMinutes() + 30); // 30 minutes duration
      
      try {
        const icsFile = await generateIcsFile({
          patientName: appointment.patient_name,
          patientTaj: appointment.patient_taj,
          startTime: newStartTime,
          surgeonName: appointment.created_by,
          dentistName: newTimeSlot.dentist_email,
        });

        // Promise.all() használata: email és Google Calendar párhuzamosan
        await Promise.all([
          // Email küldés a fogpótlástanásznak
          sendAppointmentModificationNotification(
            newTimeSlot.dentist_email,
            appointment.patient_name,
            appointment.patient_taj,
            oldStartTime,
            newStartTime,
            appointment.patient_email, // created_by for patient modifications
            icsFile
          ),
          // Google Calendar esemény frissítése
          (async () => {
            try {
              // Naptár ID-k lekérése a felhasználó beállításaiból
              const userCalendarResult = await pool.query(
                `SELECT google_calendar_target_calendar_id 
                 FROM users 
                 WHERE id = $1`,
                [newTimeSlot.dentist_user_id]
              );
              const targetCalendarId = userCalendarResult.rows[0]?.google_calendar_target_calendar_id || 'primary';
              
              // Ha van régi Google Calendar event ID, töröljük a cél naptárból
              if (appointment.google_calendar_event_id && appointment.time_slot_user_id) {
                await deleteGoogleCalendarEvent(
                  appointment.time_slot_user_id,
                  appointment.google_calendar_event_id,
                  targetCalendarId
                ).catch((error) => {
                  console.error('Failed to delete old Google Calendar event:', error);
                  // Nem blokkoljuk, ha a törlés sikertelen
                });
              }
              
              // Új esemény létrehozása az új időponttal a cél naptárban
              const newEventId = await createGoogleCalendarEvent(
                newTimeSlot.dentist_user_id,
                {
                  summary: `Betegfogadás - ${appointment.patient_name || 'Név nélküli beteg'}`,
                  description: `Beteg: ${appointment.patient_name || 'Név nélküli'}\nTAJ: ${appointment.patient_taj || 'Nincs megadva'}\nBeutaló orvos: ${appointment.created_by}`,
                  startTime: newStartTime,
                  endTime: newEndTime,
                  location: 'Maxillofaciális Rehabilitáció',
                  calendarId: targetCalendarId,
                }
              );
              
              // Event ID mentése az appointments táblába
              if (newEventId) {
                await pool.query(
                  'UPDATE appointments SET google_calendar_event_id = $1 WHERE id = $2',
                  [newEventId, params.id]
                );
              }
            } catch (error) {
              console.error('Failed to update Google Calendar event:', error);
              // Nem blokkolja az időpont módosítását
            }
          })(),
        ]);
      } catch (emailError) {
        console.error('Failed to send modification email to dentist:', emailError);
        // Don't fail the request if email fails
      }

      // Send email to patient if email is available
      if (appointment.patient_email && appointment.patient_email.trim() !== '') {
        try {
          const icsFile = await generateIcsFile({
            patientName: appointment.patient_name,
            patientTaj: appointment.patient_taj,
            startTime: newStartTime,
            surgeonName: appointment.created_by,
            dentistName: newTimeSlot.dentist_email,
          });

          await sendAppointmentModificationNotificationToPatient(
            appointment.patient_email,
            appointment.patient_name,
            oldStartTime,
            newStartTime,
            newTimeSlot.dentist_email,
            icsFile
          );
        } catch (emailError) {
          console.error('Failed to send modification email to patient:', emailError);
          // Don't fail the request if email fails
        }
      }

      return NextResponse.json({ 
        appointment: updatedAppointment,
        message: 'Időpont sikeresen módosítva! A fogpótlástanász és Ön értesítést kapott.'
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error modifying appointment:', error);
    return NextResponse.json(
      { error: 'Hiba történt az időpont módosításakor' },
      { status: 500 }
    );
  }
  */
}

/**
 * Cancel patient's appointment
 * DELETE /api/patient-portal/appointments/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const patientId = await verifyPatientPortalSession(request);

    if (!patientId) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { cancellationReason } = body;

    // Validate cancellation reason
    if (!cancellationReason || typeof cancellationReason !== 'string' || cancellationReason.trim().length === 0) {
      return NextResponse.json(
        { error: 'A lemondás indokának megadása kötelező' },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    // Get appointment details and verify it belongs to this patient
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

    // Check if appointment is already cancelled
    if (appointment.appointment_status === 'cancelled_by_patient' || appointment.appointment_status === 'cancelled_by_doctor') {
      return NextResponse.json(
        { error: 'Ez az időpont már le van mondva' },
        { status: 400 }
      );
    }

    // Check if appointment is in the future (can only cancel future appointments)
    const startTime = new Date(appointment.start_time);
    if (startTime <= new Date()) {
      return NextResponse.json(
        { error: 'Csak jövőbeli időpontot lehet lemondani' },
        { status: 400 }
      );
    }

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Update appointment status to cancelled_by_patient and save cancellation reason
      await pool.query(
        `UPDATE appointments 
         SET appointment_status = $1, completion_notes = $2
         WHERE id = $3`,
        ['cancelled_by_patient', cancellationReason.trim(), params.id]
      );

      // Update time slot status back to available
      await pool.query(
        'UPDATE available_time_slots SET status = $1 WHERE id = $2',
        ['available', appointment.time_slot_id]
      );

      await pool.query('COMMIT');

      // Send cancellation email notifications and handle Google Calendar event (parallel)
      try {
        const dentistFullName = appointment.dentist_name || appointment.dentist_email;

        await Promise.all([
          // Email to dentist
          sendAppointmentCancellationNotification(
            appointment.dentist_email,
            appointment.patient_name,
            appointment.patient_taj,
            startTime,
            'Páciens portál',
            cancellationReason.trim()
          ),
          // Google Calendar event handling (if exists)
          (async () => {
            if (appointment.google_calendar_event_id && appointment.time_slot_user_id) {
              try {
                // Get calendar IDs from user settings
                const userCalendarResult = await pool.query(
                  `SELECT google_calendar_source_calendar_id, google_calendar_target_calendar_id 
                   FROM users 
                   WHERE id = $1`,
                  [appointment.time_slot_user_id]
                );
                const sourceCalendarId = userCalendarResult.rows[0]?.google_calendar_source_calendar_id || 'primary';
                const targetCalendarId = userCalendarResult.rows[0]?.google_calendar_target_calendar_id || 'primary';
                
                // Delete the patient event from target calendar
                await deleteGoogleCalendarEvent(
                  appointment.time_slot_user_id,
                  appointment.google_calendar_event_id,
                  targetCalendarId
                );
                console.log('[Patient Portal Cancellation] Deleted patient event from target calendar');
                
                // If time slot came from Google Calendar, recreate "szabad" event in source calendar
                const isFromGoogleCalendar = appointment.time_slot_source === 'google_calendar' && appointment.time_slot_google_calendar_event_id;
                
                if (isFromGoogleCalendar) {
                  const endTime = new Date(startTime);
                  endTime.setMinutes(endTime.getMinutes() + 30); // 30 minutes duration
                  
                  // Create "szabad" event in source calendar
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
                    console.log('[Patient Portal Cancellation] Recreated "szabad" event in source calendar');
                    // Update time slot google_calendar_event_id with new event ID
                    await pool.query(
                      `UPDATE available_time_slots 
                       SET google_calendar_event_id = $1 
                       WHERE id = $2`,
                      [szabadEventId, appointment.time_slot_id]
                    );
                  }
                }
              } catch (error) {
                console.error('Failed to handle Google Calendar event:', error);
                // Don't block cancellation if Google Calendar fails
              }
            }
          })(),
        ]);
      } catch (emailError) {
        console.error('Failed to send cancellation email:', emailError);
        // Don't fail the request if email fails
      }

      // Send email to admins
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
        console.error('Failed to send cancellation email to admins:', adminEmailError);
        // Don't fail the request if email fails
      }

      return NextResponse.json({
        success: true,
        message: 'Időpont sikeresen lemondva!',
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error cancelling appointment:', error);
    return NextResponse.json(
      { error: 'Hiba történt az időpont lemondásakor' },
      { status: 500 }
    );
  }
}


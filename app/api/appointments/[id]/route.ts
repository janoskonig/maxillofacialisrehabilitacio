import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { sendAppointmentCancellationNotification, sendAppointmentCancellationNotificationToPatient, sendAppointmentModificationNotification, sendAppointmentModificationNotificationToPatient } from '@/lib/email';
import { generateIcsFile } from '@/lib/calendar';
import { deleteGoogleCalendarEvent, updateGoogleCalendarEvent, createGoogleCalendarEvent } from '@/lib/google-calendar';

// Update an appointment (change time slot)
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    // Only sebészorvos, fogpótlástanász, or admin can modify appointments
    if (auth.role !== 'sebészorvos' && auth.role !== 'fogpótlástanász' && auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az időpont módosításához' },
        { status: 403 }
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

    // Get current appointment details
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
      JOIN users u ON ats.user_id = u.id
      WHERE a.id = $1`,
      [params.id]
    );

    if (appointmentResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Időpont nem található' },
        { status: 404 }
      );
    }

    const appointment = appointmentResult.rows[0];

    // Check permissions:
    // - Sebészorvos: can modify if they created the appointment
    // - Fogpótlástanász: can modify if the time slot belongs to them
    // - Admin: can modify any appointment
    if (auth.role === 'sebészorvos' && appointment.created_by !== auth.email) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága ezt az időpontot módosítani' },
        { status: 403 }
      );
    }

    if (auth.role === 'fogpótlástanász' && appointment.time_slot_user_email !== auth.email) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága ezt az időpontot módosítani' },
        { status: 403 }
      );
    }

    let newTimeSlot: any;
    let newStartTime: Date;
    let finalTimeSlotId: string;

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
         JOIN users u ON ats.user_id = u.id
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

      if (newTimeSlot.status !== 'available') {
        return NextResponse.json(
          { error: 'Az új időpont már le van foglalva' },
          { status: 400 }
        );
      }

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
    } else {
      return NextResponse.json(
        { error: 'Időpont ID vagy dátum/idő megadása kötelező' },
        { status: 400 }
      );
    }

    const oldStartTime = new Date(appointment.old_start_time);

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Update appointment to new time slot
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
        [finalTimeSlotId, newTimeSlot.dentist_email, params.id]
      );

      // Update old time slot status back to available
      await pool.query(
        'UPDATE available_time_slots SET status = $1 WHERE id = $2',
        ['available', appointment.old_time_slot_id]
      );

      // New time slot is already booked (created as booked or updated to booked)
      if (!startTime) {
        // Only update status if using existing time slot
        await pool.query(
          'UPDATE available_time_slots SET status = $1 WHERE id = $2',
          ['booked', finalTimeSlotId]
        );
      }

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
          // Email küldés
          sendAppointmentModificationNotification(
            newTimeSlot.dentist_email,
            appointment.patient_name,
            appointment.patient_taj,
            oldStartTime,
            newStartTime,
            auth.email,
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

      return NextResponse.json({ appointment: updatedAppointment });
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
}

// Delete an appointment (cancel booking)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    // Only sebészorvos, fogpótlástanász, or admin can cancel appointments
    if (auth.role !== 'sebészorvos' && auth.role !== 'fogpótlástanász' && auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az időpont lemondásához' },
        { status: 403 }
      );
    }

    const pool = getDbPool();

    // Get appointment details with patient and time slot info
    const appointmentResult = await pool.query(
      `SELECT 
        a.id,
        a.patient_id,
        a.time_slot_id,
        a.created_by,
        a.dentist_email,
        a.google_calendar_event_id,
        ats.start_time,
        ats.user_id as time_slot_user_id,
        ats.source as time_slot_source,
        ats.google_calendar_event_id as time_slot_google_calendar_event_id,
        p.nev as patient_name,
        p.taj as patient_taj,
        p.email as patient_email,
        u.email as time_slot_user_email
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN patients p ON a.patient_id = p.id
      JOIN users u ON ats.user_id = u.id
      WHERE a.id = $1`,
      [params.id]
    );

    if (appointmentResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Időpont nem található' },
        { status: 404 }
      );
    }

    const appointment = appointmentResult.rows[0];

    // Check permissions:
    // - Sebészorvos: can cancel if they created the appointment (created_by matches)
    // - Fogpótlástanász: can cancel if the time slot belongs to them
    // - Admin: can cancel any appointment
    if (auth.role === 'sebészorvos' && appointment.created_by !== auth.email) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága ezt az időpontot lemondani' },
        { status: 403 }
      );
    }

    if (auth.role === 'fogpótlástanász' && appointment.time_slot_user_email !== auth.email) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága ezt az időpontot lemondani' },
        { status: 403 }
      );
    }

    // Check if appointment is in the future (optional, but good practice)
    const startTime = new Date(appointment.start_time);
    if (startTime <= new Date()) {
      // Still allow cancellation, but could warn
    }

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Delete the appointment
      await pool.query('DELETE FROM appointments WHERE id = $1', [params.id]);

      // Update time slot status back to available
      await pool.query(
        'UPDATE available_time_slots SET status = $1 WHERE id = $2',
        ['available', appointment.time_slot_id]
      );

      await pool.query('COMMIT');

      // Send cancellation email notifications and delete Google Calendar event (parallel)
      try {
        await Promise.all([
          // Email küldés
          sendAppointmentCancellationNotification(
            appointment.dentist_email,
            appointment.patient_name,
            appointment.patient_taj,
            startTime,
            auth.email
          ),
          // Google Calendar esemény kezelése (ha van event ID)
          (async () => {
            if (appointment.google_calendar_event_id && appointment.time_slot_user_id) {
              try {
                // Naptár ID-k lekérése a felhasználó beállításaiból
                const userCalendarResult = await pool.query(
                  `SELECT google_calendar_source_calendar_id, google_calendar_target_calendar_id 
                   FROM users 
                   WHERE id = $1`,
                  [appointment.time_slot_user_id]
                );
                const sourceCalendarId = userCalendarResult.rows[0]?.google_calendar_source_calendar_id || 'primary';
                const targetCalendarId = userCalendarResult.rows[0]?.google_calendar_target_calendar_id || 'primary';
                
                // Töröljük a beteg nevével létrehozott eseményt a cél naptárból
                await deleteGoogleCalendarEvent(
                  appointment.time_slot_user_id,
                  appointment.google_calendar_event_id,
                  targetCalendarId
                );
                console.log('[Appointment Cancellation] Deleted patient event from target calendar');
                
                // Ha a time slot Google Calendar-ból származik, hozzuk vissza a "szabad" eseményt a forrás naptárba
                const isFromGoogleCalendar = appointment.time_slot_source === 'google_calendar' && appointment.time_slot_google_calendar_event_id;
                
                if (isFromGoogleCalendar) {
                  const endTime = new Date(startTime);
                  endTime.setMinutes(endTime.getMinutes() + 30); // 30 minutes duration
                  
                  // Létrehozzuk a "szabad" eseményt a forrás naptárba
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
                    console.log('[Appointment Cancellation] Recreated "szabad" event in source calendar');
                    // Frissítjük a time slot google_calendar_event_id mezőjét az új esemény ID-jával
                    await pool.query(
                      `UPDATE available_time_slots 
                       SET google_calendar_event_id = $1 
                       WHERE id = $2`,
                      [szabadEventId, appointment.time_slot_id]
                    );
                  } else {
                    console.error('[Appointment Cancellation] Failed to recreate "szabad" event in source calendar');
                  }
                }
              } catch (error) {
                console.error('Failed to handle Google Calendar event:', error);
                // Nem blokkolja az időpont törlését
              }
            }
          })(),
        ]);
      } catch (emailError) {
        console.error('Failed to send cancellation email to dentist:', emailError);
        // Don't fail the request if email fails
      }

      // Send email to patient if email is available
      if (appointment.patient_email && appointment.patient_email.trim() !== '') {
        try {
          await sendAppointmentCancellationNotificationToPatient(
            appointment.patient_email,
            appointment.patient_name,
            startTime,
            appointment.dentist_email
          );
        } catch (emailError) {
          console.error('Failed to send cancellation email to patient:', emailError);
          // Don't fail the request if email fails
        }
      }

      return NextResponse.json({ success: true });
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

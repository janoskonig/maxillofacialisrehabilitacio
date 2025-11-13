import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { sendAppointmentBookingNotification, sendAppointmentBookingNotificationToPatient, sendAppointmentBookingNotificationToAdmins } from '@/lib/email';
import { generateIcsFile } from '@/lib/calendar';
import { createGoogleCalendarEvent, deleteGoogleCalendarEvent } from '@/lib/google-calendar';
import { handleApiError } from '@/lib/api-error-handler';

// Get all appointments
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();

    // Everyone sees all appointments
    const query = `
      SELECT 
        a.id,
        a.patient_id as "patientId",
        a.time_slot_id as "timeSlotId",
        a.created_by as "createdBy",
        a.dentist_email as "dentistEmail",
        a.created_at as "createdAt",
        ats.start_time as "startTime",
        ats.status,
        ats.cim,
        ats.teremszam,
        p.nev as "patientName",
        p.taj as "patientTaj",
        u.doktor_neve as "dentistName"
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN users u ON a.dentist_email = u.email
      ORDER BY ats.start_time ASC
    `;
    const params: unknown[] = [];

    const result = await pool.query(query, params);
    return NextResponse.json({ appointments: result.rows });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    return NextResponse.json(
      { error: 'Hiba történt a foglalások lekérdezésekor' },
      { status: 500 }
    );
  }
}

// Book an appointment (only sebészorvos)
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    if (auth.role !== 'sebészorvos' && auth.role !== 'admin' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json(
        { error: 'Csak sebészorvos, admin vagy fogpótlástanász foglalhat időpontot' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { patientId, timeSlotId, cim, teremszam } = body;

    if (!patientId || !timeSlotId) {
      return NextResponse.json(
        { error: 'Beteg ID és időpont ID megadása kötelező' },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    // Check if patient exists and was created by this surgeon
    const patientResult = await pool.query(
      'SELECT id, nev, taj, email, nem, created_by FROM patients WHERE id = $1',
      [patientId]
    );

    if (patientResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    const patient = patientResult.rows[0];

    // For surgeons: verify that the patient was created by this surgeon (only for editing, not for booking)
    // For admins: can book for any patient
    // Note: Surgeons can book appointments for any patient, but can only edit their own patients

    // Check if time slot exists and is available
    const timeSlotResult = await pool.query(
      `SELECT ats.*, u.email as dentist_email, u.id as dentist_user_id
       FROM available_time_slots ats
       JOIN users u ON ats.user_id = u.id
       WHERE ats.id = $1`,
      [timeSlotId]
    );
    
    // Default cím érték
    const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';

    if (timeSlotResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Időpont nem található' },
        { status: 404 }
      );
    }

    const timeSlot = timeSlotResult.rows[0];

    if (timeSlot.status !== 'available') {
      return NextResponse.json(
        { error: 'Ez az időpont már le van foglalva' },
        { status: 400 }
      );
    }

    // Check if time slot is in the future
    const startTime = new Date(timeSlot.start_time);
    if (startTime <= new Date()) {
      return NextResponse.json(
        { error: 'Csak jövőbeli időpontot lehet lefoglalni' },
        { status: 400 }
      );
    }

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Create appointment
      // created_by: surgeon/admin who booked the appointment
      // dentist_email: dentist who created the time slot
      const appointmentResult = await pool.query(
        `INSERT INTO appointments (patient_id, time_slot_id, created_by, dentist_email)
         VALUES ($1, $2, $3, $4)
         RETURNING 
           id,
           patient_id as "patientId",
           time_slot_id as "timeSlotId",
           created_by as "createdBy",
           dentist_email as "dentistEmail",
           created_at as "createdAt"`,
        [patientId, timeSlotId, auth.email, timeSlot.dentist_email]
      );

      const appointment = appointmentResult.rows[0];
      
      // Google Calendar event ID inicializálása (null)
      let googleCalendarEventId: string | null = null;

      // Update time slot status to booked and optionally update cim and teremszam
      const updateFields: string[] = ['status = $1'];
      const updateValues: (string | null)[] = ['booked'];
      let paramIndex = 2;
      
      if (cim !== undefined && cim !== null && cim.trim() !== '') {
        updateFields.push(`cim = $${paramIndex}`);
        updateValues.push(cim.trim());
        paramIndex++;
      }
      
      if (teremszam !== undefined && teremszam !== null && teremszam.trim() !== '') {
        updateFields.push(`teremszam = $${paramIndex}`);
        updateValues.push(teremszam.trim());
        paramIndex++;
      }
      
      updateValues.push(timeSlotId);
      await pool.query(
        `UPDATE available_time_slots SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`,
        updateValues
      );

      await pool.query('COMMIT');
      
      // Re-fetch time slot to get updated teremszam
      const updatedTimeSlotResult = await pool.query(
        `SELECT ats.*, u.email as dentist_email, u.id as dentist_user_id
         FROM available_time_slots ats
         JOIN users u ON ats.user_id = u.id
         WHERE ats.id = $1`,
        [timeSlotId]
      );
      const updatedTimeSlot = updatedTimeSlotResult.rows[0] || timeSlot;

      // Cím és teremszám információk - itt definiáljuk, hogy mindenhol elérhető legyen
      const appointmentCim = updatedTimeSlot.cim || DEFAULT_CIM;
      const appointmentTeremszam = updatedTimeSlot.teremszam || null;

      // Send email notification to dentist and create Google Calendar event (parallel)
      const updatedStartTime = new Date(updatedTimeSlot.start_time);
      const endTime = new Date(updatedStartTime);
      endTime.setMinutes(endTime.getMinutes() + 30); // 30 minutes duration

      // Optimalizálás: admin email-eket és dentist full name-t egyszer lekérdezzük
      // ICS fájlt is egyszer generáljuk és újrahasznosítjuk
      const [adminResult, dentistUserResult] = await Promise.all([
        pool.query('SELECT email FROM users WHERE role = $1 AND active = true', ['admin']),
        pool.query(`SELECT doktor_neve FROM users WHERE email = $1`, [timeSlot.dentist_email])
      ]);
      
      const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);
      const adminEmail = adminEmails.length > 0 ? adminEmails[0] : '';
      const dentistFullName = dentistUserResult.rows[0]?.doktor_neve || timeSlot.dentist_email;

      // ICS fájl generálása egyszer, majd újrahasznosítás
      const icsFileData = {
        patientName: patient.nev,
        patientTaj: patient.taj,
        startTime: updatedStartTime,
        surgeonName: auth.email,
        dentistName: timeSlot.dentist_email,
      };
      const icsFile = await generateIcsFile(icsFileData);

      try {
        // Promise.all() használata: email és Google Calendar párhuzamosan
        await Promise.all([
          // Email küldés
          sendAppointmentBookingNotification(
            timeSlot.dentist_email,
            patient.nev,
            patient.taj,
            updatedStartTime,
            auth.email,
            icsFile,
            appointmentCim,
            appointmentTeremszam
          ),
          // Google Calendar esemény kezelése
          (async () => {
            try {
              // Ellenőrizzük, hogy az időpont Google Calendar-ból származik-e
              // A mezők snake_case-ben jönnek az adatbázisból
              const googleCalendarEventId = timeSlot.google_calendar_event_id;
              const source = timeSlot.source;
              
              console.log('[Appointment Booking] Time slot info:', {
                id: timeSlot.id,
                google_calendar_event_id: googleCalendarEventId,
                source: source,
                dentist_user_id: timeSlot.dentist_user_id,
                status: timeSlot.status
              });

              const isFromGoogleCalendar = googleCalendarEventId && source === 'google_calendar';

              let finalEventId: string | null = null;

              // Naptár ID-k lekérése a felhasználó beállításaiból
              const userCalendarResult = await pool.query(
                `SELECT google_calendar_source_calendar_id, google_calendar_target_calendar_id 
                 FROM users 
                 WHERE id = $1`,
                [timeSlot.dentist_user_id]
              );
              const sourceCalendarId = userCalendarResult.rows[0]?.google_calendar_source_calendar_id || 'primary';
              const targetCalendarId = userCalendarResult.rows[0]?.google_calendar_target_calendar_id || 'primary';
              
              if (isFromGoogleCalendar) {
                console.log('[Appointment Booking] Deleting "szabad" event from source calendar:', googleCalendarEventId);
                // Ha Google Calendar-ból származik, töröljük a "szabad" eseményt a forrás naptárból
                const deleteResult = await deleteGoogleCalendarEvent(
                  timeSlot.dentist_user_id,
                  googleCalendarEventId,
                  sourceCalendarId
                );
                console.log('[Appointment Booking] Delete result:', deleteResult);
                
                // Létrehozunk egy új eseményt a beteg nevével a cél naptárban
                console.log('[Appointment Booking] Creating new event with patient name in target calendar');
                const newEventId = await createGoogleCalendarEvent(
                  timeSlot.dentist_user_id,
                  {
                    summary: `Betegfogadás - ${patient.nev || 'Név nélküli beteg'}`,
                    description: `Beteg: ${patient.nev || 'Név nélküli'}\nTAJ: ${patient.taj || 'Nincs megadva'}\nBeutaló orvos: ${auth.email}`,
                    startTime: updatedStartTime,
                    endTime: endTime,
                    location: 'Maxillofaciális Rehabilitáció',
                    calendarId: targetCalendarId,
                  }
                );
                finalEventId = newEventId;
                
                if (!newEventId) {
                  console.error('[Appointment Booking] Failed to create new Google Calendar event in target calendar');
                } else {
                  console.log('[Appointment Booking] Successfully created new event with patient name in target calendar');
                }
              } else {
                console.log('[Appointment Booking] Time slot is not from Google Calendar, creating new event');
                // Ha nem Google Calendar-ból származik, új eseményt hozunk létre
                const newEventId = await createGoogleCalendarEvent(
                  timeSlot.dentist_user_id,
                  {
                    summary: `Betegfogadás - ${patient.nev || 'Név nélküli beteg'}`,
                    description: `Beteg: ${patient.nev || 'Név nélküli'}\nTAJ: ${patient.taj || 'Nincs megadva'}\nBeutaló orvos: ${auth.email}`,
                    startTime: updatedStartTime,
                    endTime: endTime,
                    location: 'Maxillofaciális Rehabilitáció',
                    calendarId: targetCalendarId,
                  }
                );
                finalEventId = newEventId;
              }

              console.log('[Appointment Booking] Final event ID:', finalEventId);

              if (finalEventId) {
                // Event ID mentése az appointments táblába
                await pool.query(
                  'UPDATE appointments SET google_calendar_event_id = $1 WHERE id = $2',
                  [finalEventId, appointment.id]
                );
              }
            } catch (error) {
              // Google Calendar hiba esetén csak logolás, nem blokkolja az időpontfoglalást
              console.error('[Appointment Booking] Failed to handle Google Calendar event:', error);
            }
          })(),
        ]);
      } catch (emailError) {
        console.error('Failed to send appointment booking notification to dentist:', emailError);
        // Don't fail the request if email fails
      }

      // Send email notification to patient if email is available
      if (patient.email && patient.email.trim() !== '') {
        try {
          console.log('[Appointment Booking] Sending email to patient:', patient.email);

          await sendAppointmentBookingNotificationToPatient(
            patient.email,
            patient.nev,
            patient.nem,
            updatedStartTime,
            dentistFullName,
            timeSlot.dentist_email,
            icsFile,
            appointmentCim,
            appointmentTeremszam,
            adminEmail
          );
          console.log('[Appointment Booking] Email sent successfully to patient:', patient.email);
        } catch (emailError) {
          console.error('Failed to send appointment booking notification to patient:', emailError);
          console.error('Error details:', emailError instanceof Error ? emailError.stack : emailError);
          // Don't fail the request if email fails
        }
      } else {
        console.log('[Appointment Booking] Patient has no email address, skipping email notification');
      }

      // Send email notification to all admins
      if (adminEmails.length > 0) {
        try {
          await sendAppointmentBookingNotificationToAdmins(
            adminEmails,
            patient.nev,
            patient.taj,
            updatedStartTime,
            auth.email,
            timeSlot.dentist_email,
            icsFile,
            appointmentCim,
            appointmentTeremszam
          );
        } catch (emailError) {
          console.error('Failed to send appointment booking notification to admins:', emailError);
          // Don't fail the request if email fails
        }
      }

      return NextResponse.json({ appointment }, { status: 201 });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'Hiba történt az időpont foglalásakor');
  }
}

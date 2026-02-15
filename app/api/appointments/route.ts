import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { sendAppointmentBookingNotification, sendAppointmentBookingNotificationToPatient, sendAppointmentBookingNotificationToAdmins } from '@/lib/email';
import { generateIcsFile } from '@/lib/calendar';
import { createGoogleCalendarEvent, deleteGoogleCalendarEvent } from '@/lib/google-calendar';
import { handleApiError } from '@/lib/api-error-handler';
import { sendPushNotification } from '@/lib/push-notifications';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { checkOneHardNext, getAppointmentRiskSettings } from '@/lib/scheduling-service';
import { getSchedulingFeatureFlag } from '@/lib/scheduling-feature-flags';
import { emitSchedulingEvent } from '@/lib/scheduling-events';

// Get all appointments
export const dynamic = 'force-dynamic';

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

    // Pagination paraméterek
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = (page - 1) * limit;
    const patientId = searchParams.get('patientId');

    // WHERE feltétel építése
    let whereClause = '';
    const queryParams: unknown[] = [];
    let paramIndex = 1;

    if (patientId) {
      whereClause = `WHERE a.patient_id = $${paramIndex}`;
      queryParams.push(patientId);
      paramIndex++;
    }

    // Count query
    const countQuery = `
      SELECT COUNT(*) as total
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN users u ON a.dentist_email = u.email
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, queryParams);

    // Data query with optional patientId filter
    const query = `
      SELECT 
        a.id,
        a.patient_id as "patientId",
        a.time_slot_id as "timeSlotId",
        a.created_by as "createdBy",
        a.dentist_email as "dentistEmail",
        a.created_at as "createdAt",
        a.approved_at as "approvedAt",
        a.approval_status as "approvalStatus",
        a.approval_token as "approvalToken",
        a.appointment_status as "appointmentStatus",
        a.completion_notes as "completionNotes",
        a.is_late as "isLate",
        a.appointment_type as "appointmentType",
        ats.start_time as "startTime",
        ats.status,
        ats.cim,
        ats.teremszam,
        ats.source as "timeSlotSource",
        p.nev as "patientName",
        p.taj as "patientTaj",
        p.email as "patientEmail"
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN users u ON a.dentist_email = u.email
      ${whereClause}
      ORDER BY ats.start_time ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    queryParams.push(limit.toString(), offset.toString());

    const result = await pool.query(query, queryParams);
    
    const total = parseInt(countResult.rows[0].total, 10);
    const totalPages = Math.ceil(total / limit);
    
    return NextResponse.json({ 
      appointments: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      }
    });
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
    const { patientId, timeSlotId, cim, teremszam, appointmentType, episodeId, pool = 'work', overrideReason, stepCode, createdVia: createdViaParam } = body;
    // Explicit boolean validation — reject truthy non-booleans (e.g. "true" string)
    const requiresPrecommit = body.requiresPrecommit === true;

    const validCreatedVia = ['worklist', 'patient_form', 'patient_self', 'admin_override', 'surgeon_override', 'migration', 'google_import'] as const;
    const createdVia = typeof createdViaParam === 'string' && validCreatedVia.includes(createdViaParam as (typeof validCreatedVia)[number])
      ? createdViaParam
      : 'worklist';

    if (!patientId || !timeSlotId) {
      return NextResponse.json(
        { error: 'Beteg ID és időpont ID megadása kötelező' },
        { status: 400 }
      );
    }

    const validPools = ['consult', 'work', 'control'];
    const poolValue = validPools.includes(pool) ? pool : 'work';

    const db = getDbPool();

    // Check if patient exists and was created by this surgeon
    const patientResult = await db.query(
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

    let usedOverride = false;
    const durationMinutes = 30;

    let noShowRisk = 0;
    let requiresConfirmation = false;
    let holdExpiresAt: Date | null = null;
    const now = new Date();
    const roughStart = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    try {
      const riskSettings = await getAppointmentRiskSettings(patientId, roughStart, auth.email);
      noShowRisk = riskSettings.noShowRisk;
      requiresConfirmation = riskSettings.requiresConfirmation;
      holdExpiresAt = riskSettings.holdExpiresAt;
    } catch {
      holdExpiresAt = new Date();
      holdExpiresAt.setHours(holdExpiresAt.getHours() + 48);
    }

    // G2: Work pool requires episodeId (kivéve override — override csak one-hard-next fail esetén, ami episodeId-t igényel)
    if (poolValue === 'work' && !episodeId) {
      return NextResponse.json(
        { error: 'Work pool foglaláshoz epizód ID kötelező (episodeId)', code: 'EPISODE_ID_REQUIRED' },
        { status: 400 }
      );
    }

    // Start transaction — all slot/episode checks + locks inside TX
    await db.query('BEGIN');
    let committed = false;

    try {
      // 1) Lock episode first (consistent lock order) and enforce one-hard-next + care_pathway check
      if (episodeId && poolValue === 'work') {
        const episodeLock = await db.query(
          `SELECT id, care_pathway_id, assigned_provider_id FROM patient_episodes WHERE id = $1 FOR UPDATE`,
          [episodeId]
        );
        if (episodeLock.rows.length === 0) {
          await db.query('ROLLBACK');
          return NextResponse.json(
            { error: 'Epizód nem található' },
            { status: 404 }
          );
        }
        if (!episodeLock.rows[0].care_pathway_id) {
          await db.query('ROLLBACK');
          return NextResponse.json(
            {
              error: 'Epizódhoz nincs hozzárendelve kezelési út. Először válasszon pathway-t.',
              code: 'NO_CARE_PATHWAY',
              overrideHint: 'Assign care_pathway_id to episode before booking work pool.',
            },
            { status: 409 }
          );
        }
        const assignedProviderId = episodeLock.rows[0].assigned_provider_id;
        if (assignedProviderId && auth.role !== 'admin') {
          if (auth.userId !== assignedProviderId) {
            await db.query('ROLLBACK');
            return NextResponse.json(
              {
                error: 'Csak a hozzárendelt felelős orvos (vagy admin) foglalhat work pool időpontot ehhez az epizódhoz.',
                code: 'ASSIGNED_PROVIDER_ONLY',
              },
              { status: 403 }
            );
          }
        }
        const oneHardNext = await checkOneHardNext(episodeId, 'work', {
          requiresPrecommit: requiresPrecommit === true,
          stepCode: typeof stepCode === 'string' ? stepCode : undefined,
        });
        if (!oneHardNext.allowed) {
          const strictOneHardNext = await getSchedulingFeatureFlag('strict_one_hard_next');
          const mayOverride = !strictOneHardNext && (auth.role === 'admin' || auth.role === 'sebészorvos' || auth.role === 'fogpótlástanász') && overrideReason && typeof overrideReason === 'string' && overrideReason.trim().length >= 10;
          if (mayOverride) {
            await db.query(
              `INSERT INTO scheduling_override_audit (episode_id, user_id, override_reason) VALUES ($1, $2, $3)`,
              [episodeId, auth.userId, overrideReason.trim()]
            );
            usedOverride = true;
          } else {
            await db.query('ROLLBACK');
            return NextResponse.json(
              {
                error: oneHardNext.reason ?? 'Episode already has a future work appointment (one-hard-next)',
                code: 'ONE_HARD_NEXT_VIOLATION',
                overrideHint: 'Provide overrideReason (min 10 chars) to bypass. Admin/sebészorvos/fogpótlástanász only.',
              },
              { status: 409 }
            );
          }
        } else if (requiresPrecommit === true && episodeId) {
          // Audit: precommit exception allows 2nd future work appointment
          await db.query(
            `INSERT INTO scheduling_override_audit (episode_id, user_id, override_reason) VALUES ($1, $2, $3)`,
            [episodeId, auth.userId, `precommit: ${typeof stepCode === 'string' ? stepCode : 'unknown'}`]
          );
        }
      }

      // 2) Lock time slot and verify free
      const timeSlotResult = await db.query(
        `SELECT ats.*, u.email as dentist_email, u.id as dentist_user_id
         FROM available_time_slots ats
         JOIN users u ON ats.user_id = u.id
         WHERE ats.id = $1
         FOR UPDATE`,
        [timeSlotId]
      );

      if (timeSlotResult.rows.length === 0) {
        await db.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Időpont nem található' },
          { status: 404 }
        );
      }

      const timeSlot = timeSlotResult.rows[0];
      // state (slot state machine) is authoritative; fallback to status (legacy) for backward compat
      const slotState = timeSlot.state ?? (timeSlot.status === 'available' ? 'free' : 'booked');
      if (slotState !== 'free') {
        await db.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Ez az időpont már le van foglalva' },
          { status: 400 }
        );
      }

      const startTime = new Date(timeSlot.start_time);
      if (startTime <= now) {
        await db.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Csak jövőbeli időpontot lehet lefoglalni' },
          { status: 400 }
        );
      }

      // Refine risk settings with actual start time
      try {
        const riskSettings = await getAppointmentRiskSettings(patientId, startTime, auth.email);
        noShowRisk = riskSettings.noShowRisk;
        requiresConfirmation = riskSettings.requiresConfirmation;
        holdExpiresAt = riskSettings.holdExpiresAt;
      } catch {
        // keep defaults from pre-fetch
      }

      // Default cím érték
      const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';

      // Create or update appointment (UPSERT)
      // If there's a cancelled appointment for this time slot, update it instead of creating new
      // created_by: surgeon/admin who booked the appointment
      // dentist_email: dentist who created the time slot
      // When usedOverride: must set requires_precommit=true to bypass UNIQUE(episode_id) WHERE requires_precommit=false
      const reqPrecommit = requiresPrecommit === true || usedOverride;
      const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
      const appointmentResult = await db.query(
        `INSERT INTO appointments (
          patient_id, episode_id, time_slot_id, created_by, dentist_email, appointment_type,
          pool, duration_minutes, no_show_risk, requires_confirmation, hold_expires_at, created_via, requires_precommit, start_time, end_time
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (time_slot_id) 
         DO UPDATE SET
           patient_id = EXCLUDED.patient_id,
           episode_id = EXCLUDED.episode_id,
           created_by = EXCLUDED.created_by,
           dentist_email = EXCLUDED.dentist_email,
           appointment_type = EXCLUDED.appointment_type,
           pool = EXCLUDED.pool,
           duration_minutes = EXCLUDED.duration_minutes,
           no_show_risk = EXCLUDED.no_show_risk,
           requires_confirmation = EXCLUDED.requires_confirmation,
           hold_expires_at = EXCLUDED.hold_expires_at,
           created_via = EXCLUDED.created_via,
           requires_precommit = EXCLUDED.requires_precommit,
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
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
           episode_id as "episodeId",
           time_slot_id as "timeSlotId",
           created_by as "createdBy",
           dentist_email as "dentistEmail",
           created_at as "createdAt",
           appointment_type as "appointmentType",
           pool,
           duration_minutes as "durationMinutes"`,
        [patientId, episodeId || null, timeSlotId, auth.email, timeSlot.dentist_email, appointmentType || null, poolValue, durationMinutes, noShowRisk, requiresConfirmation, holdExpiresAt, usedOverride ? (auth.role === 'admin' ? 'admin_override' : 'surgeon_override') : createdVia, reqPrecommit, startTime, endTime]
      );

      const appointment = appointmentResult.rows[0];
      if (!appointment) {
        await db.query('ROLLBACK');
        // ON CONFLICT DO UPDATE returned 0 rows: slot was free but an active (non-cancelled) appointment exists on it — data integrity issue or race
        return NextResponse.json(
          {
            error: 'Ez az időpont már le van foglalva (aktív foglalás van az időponton)',
            code: 'SLOT_CONFLICT',
            hint: 'A slot szabadnak látszik, de már van aktív foglalás rajta. Próbálja újra, vagy forduljon az adminisztrátorhoz.',
          },
          { status: 409 }
        );
      }

      // Google Calendar event ID inicializálása (null)
      let googleCalendarEventId: string | null = null;

      // Update time slot: status (legacy) and state (slot state machine) both to booked
      // Use explicit literals for consistency with slot-intents convert and hold-expiry
      const updateFields: string[] = ["status = 'booked'", "state = 'booked'"];
      const updateValues: (string | null)[] = [];
      let paramIndex = 1;
      
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
      await db.query(
        `UPDATE available_time_slots SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`,
        updateValues
      );

      await db.query('COMMIT');
      committed = true;
      // Post-commit: emit events, refetch, send notifications. Errors here must NOT trigger rollback (tx already committed).

      if (episodeId) {
        try {
          await emitSchedulingEvent('appointment', appointment.id, 'created');
        } catch {
          // Non-blocking
        }
      }

      // Re-fetch time slot to get updated teremszam (post-commit; no ROLLBACK on failure)
      const updatedTimeSlotResult = await db.query(
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
      const updatedEndTime = new Date(updatedStartTime.getTime() + durationMinutes * 60 * 1000);

      // Format date for notifications
      const formattedDate = format(updatedStartTime, "yyyy. MM. dd. HH:mm", { locale: hu });

      // Optimalizálás: admin email-eket és dentist full name-t egyszer lekérdezzük
      // ICS fájlt is egyszer generáljuk és újrahasznosítjuk
      const [adminResult, dentistUserResult] = await Promise.all([
        db.query('SELECT email FROM users WHERE role = $1 AND active = true', ['admin']),
        db.query(`SELECT doktor_neve FROM users WHERE email = $1`, [timeSlot.dentist_email])
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
              const userCalendarResult = await db.query(
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
                    endTime: updatedEndTime,
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
                    endTime: updatedEndTime,
                    location: 'Maxillofaciális Rehabilitáció',
                    calendarId: targetCalendarId,
                  }
                );
                finalEventId = newEventId;
              }

              console.log('[Appointment Booking] Final event ID:', finalEventId);

              if (finalEventId) {
                // Event ID mentése az appointments táblába
                await db.query(
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

      // Send push notification to dentist
      try {
        if (timeSlot.dentist_user_id) {
          await sendPushNotification(timeSlot.dentist_user_id, {
            title: "Új időpont foglalás",
            body: `${patient.nev || 'Név nélküli beteg'} - ${formattedDate}`,
            icon: "/icon-192x192.png",
            tag: `appointment-${appointment.id}`,
            data: {
              url: `/calendar`,
              type: "appointment",
              id: appointment.id,
            },
          });
        }
      } catch (pushError) {
        console.error('Failed to send push notification to dentist:', pushError);
        // Don't fail the request if push fails
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

      // Send push notification to patient (if patient portal user exists)
      try {
        // Check if patient has a portal account (users table with patient_id)
        const patientUserResult = await db.query(
          'SELECT id FROM users WHERE email = $1 AND active = true',
          [patient.email]
        );
        
        if (patientUserResult.rows.length > 0 && patient.email) {
          const patientUserId = patientUserResult.rows[0].id;
          await sendPushNotification(patientUserId, {
            title: "Időpont foglalva",
            body: `Időpont: ${formattedDate}`,
            icon: "/icon-192x192.png",
            tag: `appointment-${appointment.id}`,
            data: {
              url: `/patient-portal/appointments`,
              type: "appointment",
              id: appointment.id,
            },
          });
        }
      } catch (pushError) {
        console.error('Failed to send push notification to patient:', pushError);
        // Don't fail the request if push fails
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
      if (!committed) {
        try {
          await db.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('Rollback failed:', rollbackError);
        }
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'Hiba történt az időpont foglalásakor');
  }
}

import { Pool } from 'pg';
import { sendAppointmentBookingNotification, sendAppointmentBookingNotificationToPatient, sendAppointmentBookingNotificationToAdmins } from '@/lib/email';
import { generateIcsFile } from '@/lib/calendar';
import { createGoogleCalendarEvent, deleteGoogleCalendarEvent } from '@/lib/google-calendar';
import { sendPushNotification } from '@/lib/push-notifications';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { checkOneHardNext, getAppointmentRiskSettings } from '@/lib/scheduling-service';
import { getSchedulingFeatureFlag } from '@/lib/scheduling-feature-flags';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateAppointmentParams {
  patientId: string;
  timeSlotId: string;
  episodeId: string | null;
  appointmentType: string | null;
  pool: 'consult' | 'work' | 'control';
  cim?: string | null;
  teremszam?: string | null;
  overrideReason?: string;
  stepCode?: string | null;
  createdVia: string;
  slotIntentId?: string | null;
  stepSeq?: number | null;
  requiresPrecommit: boolean;
}

export interface CreateAppointmentAuth {
  email: string;
  userId: string;
  role: string;
}

export interface CreatedAppointment {
  id: string;
  patientId: string;
  episodeId: string | null;
  timeSlotId: string;
  createdBy: string;
  dentistEmail: string;
  createdAt: string;
  appointmentType: string | null;
  pool: string;
  durationMinutes: number;
}

export interface CreateAppointmentResult {
  appointment: CreatedAppointment;
  timeSlot: Record<string, unknown>;
  updatedTimeSlot: Record<string, unknown>;
  usedOverride: boolean;
  durationMinutes: number;
}

interface ValidationError {
  error: string;
  code?: string;
  overrideHint?: string;
  hint?: string;
  status: number;
}

type TransactionOutcome =
  | { ok: true; result: CreateAppointmentResult }
  | { ok: false; validationError: ValidationError };

const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';

// ---------------------------------------------------------------------------
// createAppointment – transactional core
// ---------------------------------------------------------------------------

export async function createAppointment(
  db: Pool,
  params: CreateAppointmentParams,
  auth: CreateAppointmentAuth,
): Promise<TransactionOutcome> {
  const {
    patientId,
    timeSlotId,
    episodeId,
    appointmentType,
    pool: poolValue,
    cim,
    teremszam,
    overrideReason,
    stepCode,
    createdVia,
    slotIntentId: slotIntentIdRaw,
    stepSeq: stepSeqRaw,
    requiresPrecommit: bodyRequiresPrecommit,
  } = params;

  const durationMinutes = 30;
  let usedOverride = false;

  // Pre-fetch risk settings with a rough start estimate
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

  let requiresPrecommit = bodyRequiresPrecommit;

  await db.query('BEGIN');
  let committed = false;

  try {
    // 1) Lock episode first (consistent lock order) and enforce one-hard-next + care_pathway check
    if (episodeId && poolValue === 'work') {
      const episodeLock = await db.query(
        `SELECT id, care_pathway_id, assigned_provider_id FROM patient_episodes WHERE id = $1 FOR UPDATE`,
        [episodeId],
      );
      if (episodeLock.rows.length === 0) {
        await db.query('ROLLBACK');
        return { ok: false, validationError: { error: 'Epizód nem található', status: 404 } };
      }

      let hasAnyPathway = !!episodeLock.rows[0].care_pathway_id;
      if (!hasAnyPathway) {
        try {
          const epPwCheck = await db.query(
            `SELECT 1 FROM episode_pathways WHERE episode_id = $1 LIMIT 1`,
            [episodeId],
          );
          hasAnyPathway = epPwCheck.rows.length > 0;
        } catch { /* episode_pathways table might not exist */ }
      }
      if (!hasAnyPathway) {
        await db.query('ROLLBACK');
        return {
          ok: false,
          validationError: {
            error: 'Epizódhoz nincs hozzárendelve kezelési út. Először válasszon pathway-t.',
            code: 'NO_CARE_PATHWAY',
            overrideHint: 'Assign care_pathway_id to episode before booking work pool.',
            status: 409,
          },
        };
      }

      // Derive requiresPrecommit from pathway step definition
      let allPathwaySteps: Array<{ step_code: string; requires_precommit?: boolean }> = [];
      try {
        const multiPwResult = await db.query(
          `SELECT cp.steps_json FROM episode_pathways ep
           JOIN care_pathways cp ON ep.care_pathway_id = cp.id
           WHERE ep.episode_id = $1`,
          [episodeId],
        );
        for (const row of multiPwResult.rows) {
          if (Array.isArray(row.steps_json)) {
            allPathwaySteps.push(...(row.steps_json as Array<{ step_code: string; requires_precommit?: boolean }>));
          }
        }
      } catch {
        if (episodeLock.rows[0].care_pathway_id) {
          const pathwayResult = await db.query(
            `SELECT cp.steps_json FROM care_pathways cp WHERE cp.id = $1`,
            [episodeLock.rows[0].care_pathway_id],
          );
          allPathwaySteps = (pathwayResult.rows[0]?.steps_json as Array<{ step_code: string; requires_precommit?: boolean }>) ?? [];
        }
      }
      const matchedStep = typeof stepCode === 'string' ? allPathwaySteps.find((s) => s.step_code === stepCode) : null;
      const pathwayStepRequiresPrecommit = matchedStep?.requires_precommit === true;
      requiresPrecommit = pathwayStepRequiresPrecommit || bodyRequiresPrecommit;

      const assignedProviderId = episodeLock.rows[0].assigned_provider_id;
      if (assignedProviderId && auth.role !== 'admin') {
        if (auth.userId !== assignedProviderId) {
          await db.query('ROLLBACK');
          return {
            ok: false,
            validationError: {
              error: 'Csak a hozzárendelt felelős orvos (vagy admin) foglalhat work pool időpontot ehhez az epizódhoz.',
              code: 'ASSIGNED_PROVIDER_ONLY',
              status: 403,
            },
          };
        }
      }

      const oneHardNext = await checkOneHardNext(episodeId, 'work', {
        requiresPrecommit: requiresPrecommit === true,
        stepCode: typeof stepCode === 'string' ? stepCode : undefined,
      });
      if (!oneHardNext.allowed) {
        const strictOneHardNext = await getSchedulingFeatureFlag('strict_one_hard_next');
        const mayOverride =
          !strictOneHardNext &&
          (auth.role === 'admin' || auth.role === 'sebészorvos' || auth.role === 'fogpótlástanász') &&
          overrideReason &&
          typeof overrideReason === 'string' &&
          overrideReason.trim().length >= 10;
        if (mayOverride) {
          await db.query(
            `INSERT INTO scheduling_override_audit (episode_id, user_id, override_reason) VALUES ($1, $2, $3)`,
            [episodeId, auth.userId, overrideReason!.trim()],
          );
          usedOverride = true;
        } else {
          await db.query('ROLLBACK');
          return {
            ok: false,
            validationError: {
              error: oneHardNext.reason ?? 'Episode already has a future work appointment (one-hard-next)',
              code: 'ONE_HARD_NEXT_VIOLATION',
              overrideHint: 'Provide overrideReason (min 10 chars) to bypass. Admin/sebészorvos/fogpótlástanász only.',
              status: 409,
            },
          };
        }
      } else if (requiresPrecommit === true && episodeId) {
        await db.query(
          `INSERT INTO scheduling_override_audit (episode_id, user_id, override_reason) VALUES ($1, $2, $3)`,
          [episodeId, auth.userId, `precommit: ${typeof stepCode === 'string' ? stepCode : 'unknown'}`],
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
      [timeSlotId],
    );

    if (timeSlotResult.rows.length === 0) {
      await db.query('ROLLBACK');
      return { ok: false, validationError: { error: 'Időpont nem található', status: 404 } };
    }

    const timeSlot = timeSlotResult.rows[0];
    const slotState = timeSlot.state ?? (timeSlot.status === 'available' ? 'free' : 'booked');
    if (slotState !== 'free') {
      await db.query('ROLLBACK');
      return { ok: false, validationError: { error: 'Ez az időpont már le van foglalva', status: 400 } };
    }

    const startTime = new Date(timeSlot.start_time);
    if (startTime <= now) {
      await db.query('ROLLBACK');
      return { ok: false, validationError: { error: 'Csak jövőbeli időpontot lehet lefoglalni', status: 400 } };
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

    const reqPrecommit = requiresPrecommit === true || usedOverride;
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

    const effectiveIntentId = typeof slotIntentIdRaw === 'string' ? slotIntentIdRaw : null;
    const effectiveStepCode = typeof stepCode === 'string' ? stepCode : null;
    const effectiveStepSeq = typeof stepSeqRaw === 'number' ? stepSeqRaw : null;

    // Validate intent belongs to this episode if provided
    if (effectiveIntentId && episodeId) {
      const intentCheck = await db.query(
        `SELECT episode_id FROM slot_intents WHERE id = $1 AND state = 'open'`,
        [effectiveIntentId],
      );
      if (intentCheck.rows.length === 0) {
        await db.query('ROLLBACK');
        return { ok: false, validationError: { error: 'Intent nem található vagy már nem open', status: 400 } };
      }
      if (intentCheck.rows[0].episode_id !== episodeId) {
        await db.query('ROLLBACK');
        return {
          ok: false,
          validationError: { error: 'Intent episode_id nem egyezik az appointment episode_id-jával', status: 400 },
        };
      }
    }

    const appointmentResult = await db.query(
      `INSERT INTO appointments (
        patient_id, episode_id, time_slot_id, created_by, dentist_email, appointment_type,
        pool, duration_minutes, no_show_risk, requires_confirmation, hold_expires_at, created_via, requires_precommit, start_time, end_time,
        slot_intent_id, step_code, step_seq
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
         slot_intent_id = EXCLUDED.slot_intent_id,
         step_code = EXCLUDED.step_code,
         step_seq = EXCLUDED.step_seq,
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
      [
        patientId, episodeId || null, timeSlotId, auth.email, timeSlot.dentist_email, appointmentType || null,
        poolValue, durationMinutes, noShowRisk, requiresConfirmation, holdExpiresAt,
        usedOverride ? (auth.role === 'admin' ? 'admin_override' : 'surgeon_override') : createdVia,
        reqPrecommit, startTime, endTime, effectiveIntentId, effectiveStepCode, effectiveStepSeq,
      ],
    );

    // Convert intent state if we're linking an intent
    if (effectiveIntentId) {
      await db.query(
        `UPDATE slot_intents SET state = 'converted', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND state = 'open'`,
        [effectiveIntentId],
      );
    }

    const appointment = appointmentResult.rows[0];
    if (!appointment) {
      await db.query('ROLLBACK');
      return {
        ok: false,
        validationError: {
          error: 'Ez az időpont már le van foglalva (aktív foglalás van az időponton)',
          code: 'SLOT_CONFLICT',
          hint: 'A slot szabadnak látszik, de már van aktív foglalás rajta. Próbálja újra, vagy forduljon az adminisztrátorhoz.',
          status: 409,
        },
      };
    }

    // Update time slot: status (legacy) and state (slot state machine) both to booked
    const updateFields: string[] = ["status = 'booked'", "state = 'booked'"];
    const updateValues: (string | null)[] = [];
    let paramIdx = 1;

    if (cim !== undefined && cim !== null && cim.trim() !== '') {
      updateFields.push(`cim = $${paramIdx}`);
      updateValues.push(cim.trim());
      paramIdx++;
    }

    if (teremszam !== undefined && teremszam !== null && teremszam.trim() !== '') {
      updateFields.push(`teremszam = $${paramIdx}`);
      updateValues.push(teremszam.trim());
      paramIdx++;
    }

    updateValues.push(timeSlotId);
    await db.query(
      `UPDATE available_time_slots SET ${updateFields.join(', ')} WHERE id = $${paramIdx}`,
      updateValues,
    );

    await db.query('COMMIT');
    committed = true;

    // Post-commit: emit scheduling events (non-blocking)
    if (episodeId) {
      try {
        await emitSchedulingEvent('appointment', appointment.id, 'created');
        if (!effectiveIntentId) {
          await emitSchedulingEvent('episode', episodeId, 'REPROJECT_INTENTS');
        }
      } catch {
        // Non-blocking
      }
    }

    // Re-fetch time slot to get updated cim/teremszam
    const updatedTimeSlotResult = await db.query(
      `SELECT ats.*, u.email as dentist_email, u.id as dentist_user_id
       FROM available_time_slots ats
       JOIN users u ON ats.user_id = u.id
       WHERE ats.id = $1`,
      [timeSlotId],
    );
    const updatedTimeSlot = updatedTimeSlotResult.rows[0] || timeSlot;

    return {
      ok: true,
      result: { appointment, timeSlot, updatedTimeSlot, usedOverride, durationMinutes },
    };
  } catch (error) {
    if (!committed) {
      try {
        await db.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error('Rollback failed:', rollbackError);
      }
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// syncAppointmentToGoogleCalendar
// ---------------------------------------------------------------------------

export interface GoogleCalendarSyncParams {
  appointmentId: string;
  dentistUserId: string;
  timeSlot: Record<string, unknown>;
  patientName: string;
  patientTaj: string;
  bookerEmail: string;
  startTime: Date;
  endTime: Date;
}

export async function syncAppointmentToGoogleCalendar(
  db: Pool,
  params: GoogleCalendarSyncParams,
): Promise<void> {
  const {
    appointmentId,
    dentistUserId,
    timeSlot,
    patientName,
    patientTaj,
    bookerEmail,
    startTime,
    endTime,
  } = params;

  const gcEventId = timeSlot.google_calendar_event_id as string | null;
  const source = timeSlot.source as string | null;

  logger.info('[Appointment Booking] Time slot info:', {
    id: timeSlot.id,
    google_calendar_event_id: gcEventId,
    source,
    dentist_user_id: dentistUserId,
    status: timeSlot.status,
  });

  const isFromGoogleCalendar = gcEventId && source === 'google_calendar';

  const userCalendarResult = await db.query(
    `SELECT google_calendar_enabled, google_calendar_source_calendar_id, google_calendar_target_calendar_id 
     FROM users 
     WHERE id = $1`,
    [dentistUserId],
  );
  if (userCalendarResult.rows[0]?.google_calendar_enabled !== true) {
    logger.info('[Appointment Booking] Slot owner has Google Calendar disabled, skipping sync');
    return;
  }
  const sourceCalendarId = userCalendarResult.rows[0]?.google_calendar_source_calendar_id || 'primary';
  const targetCalendarId = userCalendarResult.rows[0]?.google_calendar_target_calendar_id || 'primary';

  const eventPayload = {
    summary: `Betegfogadás - ${patientName || 'Név nélküli beteg'}`,
    description: `Beteg: ${patientName || 'Név nélküli'}\nTAJ: ${patientTaj || 'Nincs megadva'}\nBeutaló orvos: ${bookerEmail}`,
    startTime,
    endTime,
    location: 'Maxillofaciális Rehabilitáció',
    calendarId: targetCalendarId,
  };

  let finalEventId: string | null = null;

  if (isFromGoogleCalendar) {
    logger.info('[Appointment Booking] Deleting "szabad" event from source calendar:', gcEventId);
    const deleteResult = await deleteGoogleCalendarEvent(dentistUserId, gcEventId, sourceCalendarId);
    logger.info('[Appointment Booking] Delete result:', deleteResult);

    logger.info('[Appointment Booking] Creating new event with patient name in target calendar');
    finalEventId = await createGoogleCalendarEvent(dentistUserId, eventPayload);

    if (!finalEventId) {
      logger.error('[Appointment Booking] Failed to create new Google Calendar event in target calendar');
    } else {
      logger.info('[Appointment Booking] Successfully created new event with patient name in target calendar');
    }
  } else {
    logger.info('[Appointment Booking] Time slot is not from Google Calendar, creating new event');
    finalEventId = await createGoogleCalendarEvent(dentistUserId, eventPayload);
  }

  logger.info('[Appointment Booking] Final event ID:', finalEventId);

  if (finalEventId) {
    await db.query(
      'UPDATE appointments SET google_calendar_event_id = $1 WHERE id = $2',
      [finalEventId, appointmentId],
    );
  }
}

// ---------------------------------------------------------------------------
// sendAppointmentNotifications
// ---------------------------------------------------------------------------

export interface AppointmentNotificationParams {
  appointment: CreatedAppointment;
  patient: { nev: string; taj: string; email?: string; nem?: string };
  timeSlot: Record<string, unknown>;
  updatedTimeSlot: Record<string, unknown>;
  durationMinutes: number;
  bookerEmail: string;
}

export async function sendAppointmentNotifications(
  db: Pool,
  params: AppointmentNotificationParams,
): Promise<void> {
  const { appointment, patient, timeSlot, updatedTimeSlot, durationMinutes, bookerEmail } = params;

  const appointmentCim = (updatedTimeSlot.cim as string) || DEFAULT_CIM;
  const appointmentTeremszam = (updatedTimeSlot.teremszam as string) || null;

  const updatedStartTime = new Date(updatedTimeSlot.start_time as string);
  const updatedEndTime = new Date(updatedStartTime.getTime() + durationMinutes * 60 * 1000);

  const formattedDate = format(updatedStartTime, 'yyyy. MM. dd. HH:mm', { locale: hu });

  const dentistEmail = timeSlot.dentist_email as string;
  const dentistUserId = timeSlot.dentist_user_id as string;

  const [adminResult, dentistUserResult] = await Promise.all([
    db.query('SELECT email FROM users WHERE role = $1 AND active = true', ['admin']),
    db.query(`SELECT doktor_neve FROM users WHERE email = $1`, [dentistEmail]),
  ]);

  const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);
  const adminEmail = adminEmails.length > 0 ? adminEmails[0] : '';
  const dentistFullName = dentistUserResult.rows[0]?.doktor_neve || dentistEmail;

  const icsFile = await generateIcsFile({
    patientName: patient.nev,
    patientTaj: patient.taj,
    startTime: updatedStartTime,
    surgeonName: bookerEmail,
    dentistName: dentistEmail,
  });

  // Email to dentist + Google Calendar sync in parallel
  try {
    await Promise.all([
      sendAppointmentBookingNotification(
        dentistEmail,
        patient.nev,
        patient.taj,
        updatedStartTime,
        bookerEmail,
        icsFile,
        appointmentCim,
        appointmentTeremszam,
      ),
      syncAppointmentToGoogleCalendar(db, {
        appointmentId: appointment.id,
        dentistUserId,
        timeSlot,
        patientName: patient.nev,
        patientTaj: patient.taj,
        bookerEmail,
        startTime: updatedStartTime,
        endTime: updatedEndTime,
      }).catch((error) => {
        logger.error('[Appointment Booking] Failed to handle Google Calendar event:', error);
      }),
    ]);
  } catch (emailError) {
    logger.error('Failed to send appointment booking notification to dentist:', emailError);
  }

  // Push notification to dentist
  try {
    if (dentistUserId) {
      await sendPushNotification(dentistUserId, {
        title: 'Új időpont foglalás',
        body: `${patient.nev || 'Név nélküli beteg'} - ${formattedDate}`,
        icon: '/icon-192x192.png',
        tag: `appointment-${appointment.id}`,
        data: {
          url: `/calendar`,
          type: 'appointment',
          id: appointment.id,
        },
      });
    }
  } catch (pushError) {
    logger.error('Failed to send push notification to dentist:', pushError);
  }

  // Email to patient
  if (patient.email && patient.email.trim() !== '') {
    try {
      logger.info('[Appointment Booking] Sending email to patient:', patient.email);
      await sendAppointmentBookingNotificationToPatient(
        patient.email,
        patient.nev,
        patient.nem ?? null,
        updatedStartTime,
        dentistFullName,
        dentistEmail,
        icsFile,
        appointmentCim,
        appointmentTeremszam,
        adminEmail,
      );
      logger.info('[Appointment Booking] Email sent successfully to patient:', patient.email);
    } catch (emailError) {
      logger.error('Failed to send appointment booking notification to patient:', emailError);
      logger.error('Error details:', emailError instanceof Error ? emailError.stack : emailError);
    }
  } else {
    logger.info('[Appointment Booking] Patient has no email address, skipping email notification');
  }

  // Push notification to patient (if patient portal user exists)
  try {
    const patientUserResult = await db.query(
      'SELECT id FROM users WHERE email = $1 AND active = true',
      [patient.email],
    );

    if (patientUserResult.rows.length > 0 && patient.email) {
      const patientUserId = patientUserResult.rows[0].id;
      await sendPushNotification(patientUserId, {
        title: 'Időpont foglalva',
        body: `Időpont: ${formattedDate}`,
        icon: '/icon-192x192.png',
        tag: `appointment-${appointment.id}`,
        data: {
          url: `/patient-portal/appointments`,
          type: 'appointment',
          id: appointment.id,
        },
      });
    }
  } catch (pushError) {
    logger.error('Failed to send push notification to patient:', pushError);
  }

  // Email to all admins
  if (adminEmails.length > 0) {
    try {
      await sendAppointmentBookingNotificationToAdmins(
        adminEmails,
        patient.nev,
        patient.taj,
        updatedStartTime,
        bookerEmail,
        dentistEmail,
        icsFile,
        appointmentCim,
        appointmentTeremszam,
      );
    } catch (emailError) {
      logger.error('Failed to send appointment booking notification to admins:', emailError);
    }
  }
}

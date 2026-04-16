/**
 * Earliest free slot matching nextRequiredStep (pool, duration, window) and provider scope.
 *
 * Advisory only: another booking can take the slot until createAppointment locks it
 * (FOR UPDATE on the slot row in convertIntentToAppointment / booking flow).
 */

import { getDbPool } from './db';
import { nextRequiredStep, isBlocked, slotPoolForStep, type NextStepResult } from './next-step-engine';
import { canConsumeSlot } from './scheduling-service';
import { getProviderIdForEpisode } from './refresh-episode-next-step-cache';

export type FirstBookableProviderScope = 'episode' | 'all';

export type FirstBookableSlotBlocked = {
  kind: 'blocked';
  status: 'blocked';
  blockedReason: string;
  requiredPrereqs: string[];
  blockKeys: string[];
  code?: 'NO_CARE_PATHWAY';
};

export type FirstBookableSlotNone = {
  kind: 'none';
  nextStepWindow: { start: string; end: string };
  pool: string;
  durationMinutes: number;
  workPhaseCode: string;
  providerFilterUserId: string | null;
};

export type FirstBookableSlotFound = {
  kind: 'slot';
  slotId: string;
  startTime: string;
  durationMinutes: number | null;
  slotPurpose: string | null;
  dentistUserId: string;
  dentistName: string | null;
  dentistEmail: string | null;
  nextStepWindow: { start: string; end: string };
  pool: string;
  durationMinutesRequired: number;
  workPhaseCode: string;
  providerFilterUserId: string | null;
};

export type FirstBookableSlotResult = FirstBookableSlotBlocked | FirstBookableSlotNone | FirstBookableSlotFound;

const SLOTS_ROLES = ['admin', 'beutalo_orvos', 'fogpótlástanász'] as const;

export function canUseProviderScopeAll(role: string | undefined): boolean {
  if (!role) return false;
  return (SLOTS_ROLES as readonly string[]).includes(role);
}

function blockedPayload(step: Awaited<ReturnType<typeof nextRequiredStep>>): FirstBookableSlotBlocked {
  if (!isBlocked(step)) throw new Error('internal: expected blocked step');
  return {
    kind: 'blocked',
    status: 'blocked',
    blockedReason: step.reason,
    requiredPrereqs: step.required_prereq_keys,
    blockKeys: step.block_keys,
    ...(step.code && { code: step.code }),
  };
}

function windowFromStep(step: NextStepResult) {
  return {
    start: step.earliest_date.toISOString(),
    end: step.latest_date.toISOString(),
  };
}

/**
 * Resolve earliest eligible free slot for the episode's next required step.
 */
export async function getFirstBookableSlotForEpisode(
  episodeId: string,
  options?: { providerScope?: FirstBookableProviderScope; authRole?: string }
): Promise<FirstBookableSlotResult> {
  const next = await nextRequiredStep(episodeId);
  if (isBlocked(next)) {
    return blockedPayload(next);
  }

  const pool = slotPoolForStep(next);
  const durationMinutes = next.duration_minutes;
  const windowStart = next.earliest_date.toISOString();
  const windowEnd = next.latest_date.toISOString();

  const db = getDbPool();
  const episodeProviderId = await getProviderIdForEpisode(db, episodeId);
  const wantAll =
    options?.providerScope === 'all' && canUseProviderScopeAll(options.authRole);
  const providerFilterUserId = wantAll ? null : episodeProviderId ?? null;

  let whereClause = `WHERE ats.state = 'free' AND ats.start_time > CURRENT_TIMESTAMP`;
  const params: unknown[] = [];
  let paramIndex = 1;

  whereClause += ` AND (ats.slot_purpose = $${paramIndex} OR ats.slot_purpose IS NULL OR ats.slot_purpose = 'flexible')`;
  params.push(pool);
  paramIndex++;

  whereClause += ` AND (ats.duration_minutes >= $${paramIndex} OR ats.duration_minutes IS NULL)`;
  params.push(durationMinutes);
  paramIndex++;

  whereClause += ` AND ats.start_time >= $${paramIndex}`;
  params.push(windowStart);
  paramIndex++;

  whereClause += ` AND ats.start_time <= $${paramIndex}`;
  params.push(windowEnd);
  paramIndex++;

  if (providerFilterUserId) {
    whereClause += ` AND ats.user_id = $${paramIndex}`;
    params.push(providerFilterUserId);
    paramIndex++;
  }

  const result = await db.query<{
    id: string;
    startTime: Date | string;
    durationMinutes: number | null;
    slotPurpose: string | null;
    state: string | null;
    dentistEmail: string | null;
    dentistName: string | null;
    dentistUserId: string;
  }>(
    `SELECT ats.id,
            ats.start_time as "startTime",
            ats.duration_minutes as "durationMinutes",
            ats.slot_purpose as "slotPurpose",
            ats.state,
            u.email as "dentistEmail",
            u.doktor_neve as "dentistName",
            u.id as "dentistUserId"
     FROM available_time_slots ats
     JOIN users u ON ats.user_id = u.id
     ${whereClause}
     ORDER BY ats.start_time ASC
     LIMIT 1`,
    params
  );

  const row = result.rows[0];
  if (!row || !canConsumeSlot(row.state)) {
    return {
      kind: 'none',
      nextStepWindow: windowFromStep(next),
      pool,
      durationMinutes,
      workPhaseCode: next.work_phase_code,
      providerFilterUserId,
    };
  }

  const start =
    row.startTime instanceof Date ? row.startTime.toISOString() : new Date(row.startTime as string).toISOString();

  return {
    kind: 'slot',
    slotId: row.id,
    startTime: start,
    durationMinutes: row.durationMinutes,
    slotPurpose: row.slotPurpose,
    dentistUserId: row.dentistUserId,
    dentistName: row.dentistName,
    dentistEmail: row.dentistEmail,
    nextStepWindow: windowFromStep(next),
    pool,
    durationMinutesRequired: durationMinutes,
    workPhaseCode: next.work_phase_code,
    providerFilterUserId,
  };
}

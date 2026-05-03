import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { WIP_STAGE_CODES } from '@/lib/wip-stage';
import {
  computeDoctorWorkloadScore,
  getLevelFromUtilization,
  type WorkloadLevel,
} from '@/lib/doctor-clinical-target';
import { buildWorkloadExclusionClause } from '@/lib/workload-exclusions';

export const dynamic = 'force-dynamic';

type Level = WorkloadLevel | 'unavailable';

export const GET = authedHandler(async (req) => {
  const horizonDays = Math.min(
    180,
    Math.max(7, parseInt(req.nextUrl.searchParams.get('horizonDays') || '30', 10))
  );
  const includeDetails = req.nextUrl.searchParams.get('includeDetails') !== 'false';

  const pool = getDbPool();
  const horizonEnd = new Date();
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays);

  const wipStagesIn = WIP_STAGE_CODES.map((c) => `'${c}'`).join(', ');

  const { clause: excludeClause, params: excludeParams } = buildWorkloadExclusionClause(1);

  const doctorsResult = await pool.query(
    `SELECT id, email, doktor_neve FROM users
     WHERE active = true AND role IN ('fogpótlástanász', 'admin')
     AND doktor_neve IS NOT NULL AND doktor_neve != ''
     AND ${excludeClause}
     ORDER BY doktor_neve ASC`,
    excludeParams
  );

  type DoctorRow = {
    userId: string;
    name: string;
    weeklyTargetMinutes: number;
    targetCapacityMinutes: number;
    bookedMinutes: number;
    heldMinutes: number;
    committedMinutes: number;
    availableMinutes: number;
    utilizationPct: number;
    calendarUtilizationPct: number | null;
    wipCount: number;
    worklistCount: number;
    overdueCount: number;
    level: Level;
    flags: string[];
  };
  const doctors: DoctorRow[] = [];

  for (const doc of doctorsResult.rows) {
    // Naptári fedezet és a slotok foglaltsági mérői – stádium szűrés NÉLKÜL.
    // Bármi, ami a doktor időbeosztásában `work`/`flexible` slot és benne van
    // a horizonban, beleszámít.
    const [slotStats, wipResult, worklistResult, overdueResult] = await Promise.all([
      pool.query(
        `SELECT
          COALESCE(SUM(COALESCE(ats.duration_minutes, 30)), 0)::int AS available_minutes,
          COALESCE(SUM(CASE
            WHEN a.id IS NOT NULL
              AND (a.appointment_status IS NULL OR a.appointment_status = 'completed')
              AND a.start_time > CURRENT_TIMESTAMP
              AND (a.hold_expires_at IS NULL OR a.hold_expires_at <= CURRENT_TIMESTAMP)
            THEN COALESCE(a.duration_minutes, 30)
            ELSE 0
          END), 0)::int AS booked_minutes,
          COALESCE(SUM(CASE
            WHEN a.id IS NOT NULL
              AND a.hold_expires_at IS NOT NULL
              AND a.hold_expires_at > CURRENT_TIMESTAMP
            THEN COALESCE(a.duration_minutes, 30)
            ELSE 0
          END), 0)::int AS held_minutes
         FROM available_time_slots ats
         LEFT JOIN appointments a ON a.time_slot_id = ats.id
         WHERE ats.user_id = $1
           AND ats.start_time >= CURRENT_TIMESTAMP
           AND ats.start_time <= $2
           AND ats.state IN ('free', 'booked', 'held')
           AND (ats.slot_purpose IS NULL OR ats.slot_purpose IN ('work', 'flexible'))`,
        [doc.id, horizonEnd]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS cnt
         FROM patient_episodes pe
         LEFT JOIN (
           SELECT DISTINCT ON (episode_id) episode_id, stage_code
           FROM stage_events ORDER BY episode_id, at DESC
         ) se ON pe.id = se.episode_id
         LEFT JOIN episode_care_team ect ON pe.id = ect.episode_id AND ect.is_primary = true
         WHERE pe.status = 'open'
           AND se.stage_code IN (${wipStagesIn})
           AND (pe.assigned_provider_id = $1 OR ect.user_id = $1)`,
        [doc.id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS cnt
         FROM episode_next_step_cache enc
         JOIN patient_episodes pe ON pe.id = enc.episode_id
         WHERE enc.provider_id = $1 AND enc.status = 'ready'`,
        [doc.id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS cnt
         FROM episode_next_step_cache enc
         JOIN patient_episodes pe ON pe.id = enc.episode_id
         WHERE enc.provider_id = $1 AND enc.overdue_days > 0`,
        [doc.id]
      ),
    ]);

    const availableMinutes: number = slotStats.rows[0]?.available_minutes ?? 0;
    const bookedMinutes: number = slotStats.rows[0]?.booked_minutes ?? 0;
    const heldMinutes: number = slotStats.rows[0]?.held_minutes ?? 0;
    const wipCount: number = wipResult.rows[0]?.cnt ?? 0;
    const worklistCount: number = worklistResult.rows[0]?.cnt ?? 0;
    const overdueCount: number = overdueResult.rows[0]?.cnt ?? 0;

    const name: string = doc.doktor_neve || doc.email;
    const score = computeDoctorWorkloadScore({ horizonDays, bookedMinutes, heldMinutes });

    const calendarUtilizationPct = availableMinutes > 0
      ? Math.round((score.committedMinutes / availableMinutes) * 100)
      : null;

    // „unavailable" csak akkor, ha ténylegesen nincs sem felkínált slot, sem foglalás.
    const isUnavailable = availableMinutes === 0 && score.committedMinutes === 0;
    const level: Level = isUnavailable ? 'unavailable' : getLevelFromUtilization(score.utilizationPct);

    const flags: string[] = [];
    if (score.utilizationPct >= 200) flags.push('over_double_target');
    if (availableMinutes === 0 && (wipCount + worklistCount) > 0) flags.push('no_calendar_with_pipeline');
    if (availableMinutes > 0 && availableMinutes < score.targetCapacityMinutes / 2) flags.push('low_calendar_offer');

    doctors.push({
      userId: doc.id,
      name,
      weeklyTargetMinutes: score.weeklyTargetMinutes,
      targetCapacityMinutes: score.targetCapacityMinutes,
      bookedMinutes,
      heldMinutes,
      committedMinutes: score.committedMinutes,
      availableMinutes,
      utilizationPct: score.utilizationPct,
      calendarUtilizationPct,
      wipCount,
      worklistCount,
      overdueCount,
      level,
      flags,
    });
  }

  return NextResponse.json({
    horizonDays,
    weeklyTargetMinutes: 120,
    generatedAt: new Date().toISOString(),
    doctors: includeDetails
      ? doctors
      : doctors.map((d) => ({
          userId: d.userId,
          name: d.name,
          utilizationPct: d.utilizationPct,
          level: d.level,
        })),
  });
});

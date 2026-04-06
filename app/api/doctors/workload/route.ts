import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { prostheticWorkloadStagesInSql } from '@/lib/wip-stage';
import { computeDoctorWorkloadScore } from '@/lib/doctor-clinical-target';

export const dynamic = 'force-dynamic';

type Level = 'low' | 'medium' | 'high' | 'critical' | 'unavailable';

function getLevel(score: number): Level {
  if (score < 0) return 'unavailable';
  if (score <= 40) return 'low';
  if (score <= 70) return 'medium';
  if (score <= 90) return 'high';
  return 'critical';
}

export const GET = authedHandler(async (req, { auth }) => {
  const horizonDays = Math.min(180, Math.max(7, parseInt(req.nextUrl.searchParams.get('horizonDays') || '30', 10)));
  const includeDetails = req.nextUrl.searchParams.get('includeDetails') !== 'false';

  const pool = getDbPool();
  const horizonEnd = new Date();
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays);

  const prostheticStagesIn = prostheticWorkloadStagesInSql();

  const EXCLUDED_NAME_PATTERNS = ['Déri', 'Hermann', 'Kádár', 'Kivovics', 'Pótlár'];
  const excludeClause = EXCLUDED_NAME_PATTERNS.map((_, i) => `doktor_neve NOT ILIKE $${i + 1}`).join(' AND ');
  const excludeParams = EXCLUDED_NAME_PATTERNS.map((n) => `%${n}%`);

  const doctorsResult = await pool.query(
    `SELECT id, email, doktor_neve FROM users
     WHERE active = true AND role IN ('fogpótlástanász', 'admin')
     AND doktor_neve IS NOT NULL AND doktor_neve != ''
     AND ${excludeClause}
     ORDER BY doktor_neve ASC`,
    excludeParams
  );

  const doctors: Array<{
    userId: string;
    name: string;
    busynessScore: number;
    level: Level;
    utilizationPct: number;
    heldPct: number;
    pipelinePct: number;
    bookedMinutes: number;
    availableMinutes: number;
    weeklyTargetMinutes: number;
    targetCapacityMinutes: number;
    heldMinutes: number;
    wipCount: number;
    worklistCount: number;
    overdueCount: number;
    flags: string[];
  }> = [];

  for (const doc of doctorsResult.rows) {
    const [slotStats, bookedStats, wipResult, worklistResult] = await Promise.all([
      pool.query(
        `SELECT
          COALESCE(SUM(COALESCE(ats.duration_minutes, 30)), 0)::int as available_minutes,
          COALESCE(SUM(CASE WHEN a.id IS NOT NULL AND (a.appointment_status IS NULL OR a.appointment_status = 'completed') AND a.start_time > CURRENT_TIMESTAMP
            AND (a.hold_expires_at IS NULL OR a.hold_expires_at <= CURRENT_TIMESTAMP)
            AND a.episode_id IS NOT NULL AND se_ep.stage_code IN (${prostheticStagesIn})
            THEN COALESCE(a.duration_minutes, 30) ELSE 0 END), 0)::int as booked_minutes,
          COALESCE(SUM(CASE WHEN a.id IS NOT NULL AND a.hold_expires_at IS NOT NULL AND a.hold_expires_at > CURRENT_TIMESTAMP
            AND a.episode_id IS NOT NULL AND se_ep.stage_code IN (${prostheticStagesIn})
            THEN COALESCE(a.duration_minutes, 30) ELSE 0 END), 0)::int as held_minutes
         FROM available_time_slots ats
         LEFT JOIN appointments a ON a.time_slot_id = ats.id
         LEFT JOIN (
           SELECT DISTINCT ON (episode_id) episode_id, stage_code
           FROM stage_events ORDER BY episode_id, at DESC
         ) se_ep ON se_ep.episode_id = a.episode_id
         WHERE ats.user_id = $1 AND ats.start_time >= CURRENT_TIMESTAMP AND ats.start_time <= $2
         AND (ats.state = 'free' OR ats.state = 'booked' OR ats.state = 'held')
         AND (ats.slot_purpose IS NULL OR ats.slot_purpose IN ('work', 'flexible'))`,
        [doc.id, horizonEnd]
      ),
      pool.query(
        `SELECT COALESCE(SUM(COALESCE(a.duration_minutes, 30)), 0)::int as booked
         FROM appointments a
         JOIN available_time_slots ats ON a.time_slot_id = ats.id
         LEFT JOIN (
           SELECT DISTINCT ON (episode_id) episode_id, stage_code
           FROM stage_events ORDER BY episode_id, at DESC
         ) se_ep ON se_ep.episode_id = a.episode_id
         WHERE ats.user_id = $1 AND a.start_time > CURRENT_TIMESTAMP AND a.start_time <= $2
         AND (a.appointment_status IS NULL OR a.appointment_status = 'completed')
         AND (a.hold_expires_at IS NULL OR a.hold_expires_at <= CURRENT_TIMESTAMP)
         AND a.episode_id IS NOT NULL AND se_ep.stage_code IN (${prostheticStagesIn})
         AND (ats.slot_purpose IS NULL OR ats.slot_purpose IN ('work', 'flexible'))`,
        [doc.id, horizonEnd]
      ),
      pool.query(
        `SELECT COUNT(*)::int as cnt FROM patient_episodes pe
         LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
         LEFT JOIN episode_care_team ect ON pe.id = ect.episode_id AND ect.is_primary = true
         WHERE pe.status = 'open' AND se.stage_code IN (${prostheticStagesIn})
         AND (pe.assigned_provider_id = $1 OR ect.user_id = $1)`,
        [doc.id]
      ),
      pool.query(
        `SELECT COUNT(*)::int as cnt
         FROM episode_next_step_cache enc
         JOIN patient_episodes pe ON pe.id = enc.episode_id
         LEFT JOIN (
           SELECT DISTINCT ON (episode_id) episode_id, stage_code
           FROM stage_events ORDER BY episode_id, at DESC
         ) se ON pe.id = se.episode_id
         WHERE enc.provider_id = $1 AND enc.status = 'ready' AND se.stage_code IN (${prostheticStagesIn})`,
        [doc.id]
      ),
    ]);

    const availableMinutes = slotStats.rows[0]?.available_minutes ?? 0;
    const bookedMinutes = bookedStats.rows[0]?.booked ?? slotStats.rows[0]?.booked_minutes ?? 0;
    const heldMinutes = slotStats.rows[0]?.held_minutes ?? 0;
    const wipCount = wipResult.rows[0]?.cnt ?? 0;
    const worklistCount = worklistResult.rows[0]?.cnt ?? 0;

    const name = doc.doktor_neve || doc.email;
    const {
      weeklyTargetMinutes,
      targetCapacityMinutes,
      utilization,
      holdPressure,
      pipelineNorm,
      busynessScore,
    } = computeDoctorWorkloadScore({
      doktorNeve: name,
      horizonDays,
      bookedMinutes,
      heldMinutes,
      wipCount,
      worklistCount,
      availableMinutes,
    });

    const overdueResult = await pool.query(
      `SELECT COUNT(*)::int as cnt
       FROM episode_next_step_cache enc
       JOIN patient_episodes pe ON pe.id = enc.episode_id
       LEFT JOIN (
         SELECT DISTINCT ON (episode_id) episode_id, stage_code
         FROM stage_events ORDER BY episode_id, at DESC
       ) se ON pe.id = se.episode_id
       WHERE enc.provider_id = $1 AND enc.overdue_days > 0 AND se.stage_code IN (${prostheticStagesIn})`,
      [doc.id]
    );
    const overdueCount = overdueResult.rows[0]?.cnt ?? 0;

    const flags: string[] = [];
    if (busynessScore >= 90) flags.push('near_critical_if_new_starts');
    if (availableMinutes === 0 && (wipCount + worklistCount) > 0) flags.push('unavailable');

    doctors.push({
      userId: doc.id,
      name,
      busynessScore,
      level: availableMinutes === 0 ? 'unavailable' : getLevel(busynessScore),
      utilizationPct: Math.round(utilization * 100),
      heldPct: Math.round(holdPressure * 100),
      pipelinePct: Math.round(pipelineNorm * 100),
      bookedMinutes,
      availableMinutes,
      weeklyTargetMinutes,
      targetCapacityMinutes,
      heldMinutes,
      wipCount,
      worklistCount,
      overdueCount,
      flags,
    });
  }

  return NextResponse.json({
    horizonDays,
    generatedAt: new Date().toISOString(),
    doctors: includeDetails ? doctors : doctors.map((d) => ({ userId: d.userId, name: d.name, busynessScore: d.busynessScore, level: d.level })),
  });
});

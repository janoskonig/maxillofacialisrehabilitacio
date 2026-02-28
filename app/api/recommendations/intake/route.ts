import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { WIP_STAGE_CODES } from '@/lib/wip-stage';
import type { IntakeRecommendationResponse } from '@/lib/forecast-types';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  const pool = getDbPool();
  const serverNowResult = await pool.query('SELECT now() as now');
  const serverNow = new Date(serverNowResult.rows[0].now);
  const fetchedAt = new Date();

  const horizonDays = 30;
  const horizonEnd = new Date();
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays);

  const EXCLUDED_NAME_PATTERNS = ['Déri', 'Hermann', 'Kádár', 'Kivovics', 'Pótlár'];
  const excludeClause = EXCLUDED_NAME_PATTERNS.map((_, i) => `doktor_neve NOT ILIKE $${i + 1}`).join(' AND ');
  const excludeParams = EXCLUDED_NAME_PATTERNS.map((n) => `%${n}%`);

  const doctorsResult = await pool.query(
    `SELECT id FROM users
     WHERE active = true AND role IN ('fogpótlástanász', 'admin')
     AND doktor_neve IS NOT NULL AND doktor_neve != ''
     AND ${excludeClause}
     ORDER BY doktor_neve ASC`,
    excludeParams
  );

  const doctorIds = doctorsResult.rows.map((d: any) => d.id);

  // ── Batch all per-doctor queries into 4 total queries ──
  const nextParamIdx = excludeParams.length + 1;
  const [slotStatsRows, bookedStatsRows, wipRows, worklistRows] = await Promise.all([
    pool.query(
      `SELECT ats.user_id,
              COALESCE(SUM(COALESCE(ats.duration_minutes, 30)), 0)::int as available_minutes,
              COALESCE(SUM(CASE WHEN a.id IS NOT NULL AND (a.appointment_status IS NULL OR a.appointment_status = 'completed') AND a.start_time > CURRENT_TIMESTAMP
                AND (a.hold_expires_at IS NULL OR a.hold_expires_at <= CURRENT_TIMESTAMP) THEN COALESCE(a.duration_minutes, 30) ELSE 0 END), 0)::int as booked_minutes,
              COALESCE(SUM(CASE WHEN a.id IS NOT NULL AND a.hold_expires_at IS NOT NULL AND a.hold_expires_at > CURRENT_TIMESTAMP THEN COALESCE(a.duration_minutes, 30) ELSE 0 END), 0)::int as held_minutes
       FROM available_time_slots ats
       LEFT JOIN appointments a ON a.time_slot_id = ats.id
       WHERE ats.user_id = ANY($1) AND ats.start_time >= CURRENT_TIMESTAMP AND ats.start_time <= $2
         AND (ats.state = 'free' OR ats.state = 'booked' OR ats.state = 'held')
       GROUP BY ats.user_id`,
      [doctorIds, horizonEnd]
    ),
    pool.query(
      `SELECT ats.user_id,
              COALESCE(SUM(COALESCE(a.duration_minutes, 30)), 0)::int as booked
       FROM appointments a
       JOIN available_time_slots ats ON a.time_slot_id = ats.id
       WHERE ats.user_id = ANY($1) AND a.start_time > CURRENT_TIMESTAMP AND a.start_time <= $2
         AND (a.appointment_status IS NULL OR a.appointment_status = 'completed')
         AND (a.hold_expires_at IS NULL OR a.hold_expires_at <= CURRENT_TIMESTAMP)
       GROUP BY ats.user_id`,
      [doctorIds, horizonEnd]
    ),
    pool.query(
      `SELECT COALESCE(pe.assigned_provider_id, ect.user_id) as user_id, COUNT(*)::int as cnt
       FROM patient_episodes pe
       LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
       LEFT JOIN episode_care_team ect ON pe.id = ect.episode_id AND ect.is_primary = true
       WHERE pe.status = 'open' AND (se.stage_code IS NULL OR se.stage_code IN (${WIP_STAGE_CODES.map((c) => `'${c}'`).join(',')}))
         AND (pe.assigned_provider_id = ANY($1) OR ect.user_id = ANY($1))
       GROUP BY COALESCE(pe.assigned_provider_id, ect.user_id)`,
      [doctorIds]
    ),
    pool.query(
      `SELECT provider_id as user_id, COUNT(*)::int as cnt
       FROM episode_next_step_cache
       WHERE provider_id = ANY($1) AND status = 'ready'
       GROUP BY provider_id`,
      [doctorIds]
    ),
  ]);

  // Build lookup maps
  const slotMap = new Map(slotStatsRows.rows.map((r: any) => [r.user_id, r]));
  const bookedMap = new Map(bookedStatsRows.rows.map((r: any) => [r.user_id, r]));
  const wipMap = new Map(wipRows.rows.map((r: any) => [r.user_id, r.cnt as number]));
  const worklistMap = new Map(worklistRows.rows.map((r: any) => [r.user_id, r.cnt as number]));

  let busynessScore = 0;
  let nearCriticalIfNewStarts = false;

  for (const doc of doctorsResult.rows) {
    const slot = slotMap.get(doc.id);
    const booked = bookedMap.get(doc.id);
    const availableMinutes = slot?.available_minutes ?? 0;
    const bookedMinutes = booked?.booked ?? slot?.booked_minutes ?? 0;
    const heldMinutes = slot?.held_minutes ?? 0;
    const wipCount = wipMap.get(doc.id) ?? 0;
    const worklistCount = worklistMap.get(doc.id) ?? 0;

    const utilization = availableMinutes > 0 ? bookedMinutes / availableMinutes : 0;
    const holdPressure = availableMinutes > 0 ? heldMinutes / availableMinutes : 0;
    const pipelineNorm = availableMinutes > 0 ? Math.min(1.5, (wipCount + worklistCount) * 30 / availableMinutes) : 0;
    const raw = 0.7 * utilization + 0.1 * holdPressure + 0.2 * pipelineNorm;
    const score = Math.round(100 * Math.min(raw, 1.5) / 1.5);

    if (score > busynessScore) busynessScore = score;
    if (score >= 90) nearCriticalIfNewStarts = true;
    if (availableMinutes === 0 && (wipCount + worklistCount) > 0) nearCriticalIfNewStarts = true;
  }

  const wipStageList = WIP_STAGE_CODES.map((c) => `'${c}'`).join(',');
  const [wipResult, forecastResult, stg0Result] = await Promise.all([
    pool.query(
      `SELECT pe.id FROM patient_episodes pe
       LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
       WHERE pe.status = 'open' AND (se.stage_code IS NULL OR se.stage_code IN (${wipStageList}))`
    ),
    pool.query(
      `SELECT MAX(efc.completion_end_p80) as "wipP80Max"
       FROM episode_forecast_cache efc
       JOIN patient_episodes pe ON pe.id = efc.episode_id
       LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
       WHERE pe.status = 'open' AND efc.status = 'ready'
       AND (se.stage_code IS NULL OR se.stage_code IN (${wipStageList}))`
    ),
    pool.query(
      `SELECT COUNT(*)::int as cnt FROM patient_episodes pe
       LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
       WHERE pe.status = 'open' AND se.stage_code = 'STAGE_0'`
    ),
  ]);

  const wipCount = wipResult.rows.length;
  const wipP80Max = forecastResult.rows[0]?.wipP80Max;
  const wipCompletionP80Max = wipP80Max ? new Date(wipP80Max).toISOString() : null;
  const wipP80DaysFromNow =
    wipCompletionP80Max != null
      ? Math.ceil((new Date(wipCompletionP80Max).getTime() - serverNow.getTime()) / (24 * 60 * 60 * 1000))
      : null;

  const reasons: string[] = [];
  let recommendation: 'GO' | 'CAUTION' | 'STOP' = 'GO';

  if (busynessScore >= 90 || nearCriticalIfNewStarts || (wipP80DaysFromNow != null && wipP80DaysFromNow > 28)) {
    recommendation = 'STOP';
    if (busynessScore >= 90) reasons.push(`BUSYNESS_${busynessScore}`);
    if (nearCriticalIfNewStarts) reasons.push('NEAR_CRITICAL_IF_NEW_STARTS');
    if (wipP80DaysFromNow != null && wipP80DaysFromNow > 28) reasons.push(`WIP_P80_END_+${wipP80DaysFromNow}D`);
  } else if (
    (busynessScore >= 75 && busynessScore <= 89) ||
    (wipP80DaysFromNow != null && wipP80DaysFromNow > 14 && wipP80DaysFromNow <= 28)
  ) {
    recommendation = 'CAUTION';
    if (busynessScore >= 75 && busynessScore <= 89) reasons.push(`BUSYNESS_${busynessScore}`);
    if (wipP80DaysFromNow != null && wipP80DaysFromNow > 14 && wipP80DaysFromNow <= 28) {
      reasons.push(`WIP_P80_END_+${wipP80DaysFromNow}D`);
    }
  } else {
    reasons.push('OK');
  }

  const response: IntakeRecommendationResponse = {
    recommendation,
    reasons,
    explain: {
      busynessScore,
      nearCriticalIfNewStarts,
      source: 'MAX_OVER_DOCTORS',
      wipCount,
      wipCompletionP80Max,
      wipP80DaysFromNow,
    },
    meta: {
      serverNow: serverNow.toISOString(),
      fetchedAt: fetchedAt.toISOString(),
      policyVersion: 1,
    },
  };

  return NextResponse.json(response);
});

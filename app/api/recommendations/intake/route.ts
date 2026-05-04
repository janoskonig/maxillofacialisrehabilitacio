import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { prostheticWorkloadStagesInSql } from '@/lib/wip-stage';
import type {
  IntakeRecommendationResponse,
  IntakeViewMode,
} from '@/lib/forecast-types';
import { computeDoctorWorkloadScore } from '@/lib/doctor-clinical-target';
import {
  WORKLOAD_EXCLUDED_NAME_PATTERNS,
  buildWorkloadExclusionClause,
} from '@/lib/workload-exclusions';

export const dynamic = 'force-dynamic';

// Az intake ajánlás a protetikai (STAGE_5) terhelésre néz.
// A score mértékegysége utilizáció % (foglalt+hold / heti penzum 30 napra
// vetítve), nincs felső korlát.
const INTAKE_STOP_BUSYNESS_PCT = 200; // 2× heti penzum fölött → STOP
const INTAKE_CAUTION_BUSYNESS_PCT = 150; // 1.5–2× heti penzum között → CAUTION

// Két nézet:
//  • PERSONAL → a bejelentkezett kezelő orvos saját kapacitására.
//  • TEAM     → a teljes fogpótlástanász csapatra (MAX_OVER_DOCTORS).
//    Beutaló orvosok és saját adat nélküli adminok ezt látják.

export const GET = authedHandler(async (_req, { auth }) => {
  const pool = getDbPool();
  const serverNowResult = await pool.query('SELECT now() as now');
  const serverNow = new Date(serverNowResult.rows[0].now);
  const fetchedAt = new Date();

  const horizonDays = 30;
  const horizonEnd = new Date();
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays);

  const prostheticStagesIn = prostheticWorkloadStagesInSql();

  // ── Nézet meghatározása a szerepkör + saját adat alapján ──────────────────
  let viewMode: IntakeViewMode | null = null;
  if (auth.role === 'fogpótlástanász' || auth.role === 'admin') {
    const exclusionPatterns = WORKLOAD_EXCLUDED_NAME_PATTERNS.map((n) => `%${n}%`);
    const eligibleResult = await pool.query(
      `SELECT id FROM users
       WHERE id = $1 AND active = true
         AND role IN ('fogpótlástanász', 'admin')
         AND doktor_neve IS NOT NULL AND doktor_neve != ''
         AND NOT (doktor_neve ILIKE ANY($2::text[]))
       LIMIT 1`,
      [auth.userId, exclusionPatterns]
    );
    if (eligibleResult.rows.length > 0) {
      viewMode = 'PERSONAL';
    } else if (auth.role === 'admin') {
      viewMode = 'TEAM'; // saját adat nélküli admin a csapatszintet látja
    }
  } else if (auth.role === 'beutalo_orvos') {
    viewMode = 'TEAM';
  }
  if (viewMode === null) {
    // Pl. technikus, vagy fogpótlástanász doktor-név nélkül → nem érintett.
    return NextResponse.json(null);
  }

  // ── Releváns orvosok azonosítása ──────────────────────────────────────────
  // PERSONAL: csak a bejelentkezett user.
  // TEAM:     a workload-ban résztvevő összes aktív doktor (kizárások után).
  let scopedDoctorIds: string[];
  if (viewMode === 'PERSONAL') {
    scopedDoctorIds = [auth.userId];
  } else {
    const { clause: excludeClause, params: excludeParams } = buildWorkloadExclusionClause(1);
    const doctorsResult = await pool.query(
      `SELECT id FROM users
       WHERE active = true AND role IN ('fogpótlástanász', 'admin')
         AND doktor_neve IS NOT NULL AND doktor_neve != ''
         AND ${excludeClause}
       ORDER BY doktor_neve ASC`,
      excludeParams
    );
    scopedDoctorIds = doctorsResult.rows.map((d: any) => d.id);
  }

  // ── Per-orvos kapacitás-, foglalás-, WIP-számok ──────────────────────────
  const [slotStatsRows, bookedStatsRows, wipRows, worklistRows] = await Promise.all([
    pool.query(
      `SELECT ats.user_id,
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
       WHERE ats.user_id = ANY($1) AND ats.start_time >= CURRENT_TIMESTAMP AND ats.start_time <= $2
         AND (ats.state = 'free' OR ats.state = 'booked' OR ats.state = 'held')
         AND (ats.slot_purpose IS NULL OR ats.slot_purpose IN ('work', 'flexible'))
       GROUP BY ats.user_id`,
      [scopedDoctorIds, horizonEnd]
    ),
    pool.query(
      `SELECT ats.user_id,
              COALESCE(SUM(COALESCE(a.duration_minutes, 30)), 0)::int as booked
       FROM appointments a
       JOIN available_time_slots ats ON a.time_slot_id = ats.id
       LEFT JOIN (
         SELECT DISTINCT ON (episode_id) episode_id, stage_code
         FROM stage_events ORDER BY episode_id, at DESC
       ) se_ep ON se_ep.episode_id = a.episode_id
       WHERE ats.user_id = ANY($1) AND a.start_time > CURRENT_TIMESTAMP AND a.start_time <= $2
         AND (a.appointment_status IS NULL OR a.appointment_status = 'completed')
         AND (a.hold_expires_at IS NULL OR a.hold_expires_at <= CURRENT_TIMESTAMP)
         AND a.episode_id IS NOT NULL AND se_ep.stage_code IN (${prostheticStagesIn})
         AND (ats.slot_purpose IS NULL OR ats.slot_purpose IN ('work', 'flexible'))
       GROUP BY ats.user_id`,
      [scopedDoctorIds, horizonEnd]
    ),
    pool.query(
      `SELECT COALESCE(pe.assigned_provider_id, ect.user_id) as user_id, COUNT(*)::int as cnt
       FROM patient_episodes pe
       LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
       LEFT JOIN episode_care_team ect ON pe.id = ect.episode_id AND ect.is_primary = true
       WHERE pe.status = 'open' AND se.stage_code IN (${prostheticStagesIn})
         AND (pe.assigned_provider_id = ANY($1) OR ect.user_id = ANY($1))
       GROUP BY COALESCE(pe.assigned_provider_id, ect.user_id)`,
      [scopedDoctorIds]
    ),
    pool.query(
      `SELECT enc.provider_id as user_id, COUNT(*)::int as cnt
       FROM episode_next_step_cache enc
       JOIN patient_episodes pe ON pe.id = enc.episode_id
       LEFT JOIN (
         SELECT DISTINCT ON (episode_id) episode_id, stage_code
         FROM stage_events ORDER BY episode_id, at DESC
       ) se ON pe.id = se.episode_id
       WHERE enc.provider_id = ANY($1) AND enc.status = 'ready' AND se.stage_code IN (${prostheticStagesIn})
       GROUP BY enc.provider_id`,
      [scopedDoctorIds]
    ),
  ]);

  const slotMap = new Map(slotStatsRows.rows.map((r: any) => [r.user_id, r]));
  const bookedMap = new Map(bookedStatsRows.rows.map((r: any) => [r.user_id, r]));
  const wipMap = new Map(wipRows.rows.map((r: any) => [r.user_id, r.cnt as number]));
  const worklistMap = new Map(worklistRows.rows.map((r: any) => [r.user_id, r.cnt as number]));

  let busynessScore = 0;
  let busiestDoctorId: string | null = null;
  let nearCriticalIfNewStarts = false;

  for (const docId of scopedDoctorIds) {
    const slot = slotMap.get(docId) as { available_minutes?: number; booked_minutes?: number; held_minutes?: number } | undefined;
    const booked = bookedMap.get(docId) as { booked?: number } | undefined;
    const availableMinutes = slot?.available_minutes ?? 0;
    const bookedMinutes = booked?.booked ?? slot?.booked_minutes ?? 0;
    const heldMinutes = slot?.held_minutes ?? 0;
    const wipCnt = wipMap.get(docId) ?? 0;
    const worklistCnt = worklistMap.get(docId) ?? 0;

    const { utilizationPct: score } = computeDoctorWorkloadScore({
      horizonDays,
      bookedMinutes,
      heldMinutes,
    });

    if (score > busynessScore) {
      busynessScore = score;
      busiestDoctorId = docId;
    }
    if (score >= INTAKE_STOP_BUSYNESS_PCT) nearCriticalIfNewStarts = true;
    if (availableMinutes === 0 && wipCnt + worklistCnt > 0) nearCriticalIfNewStarts = true;
  }

  // ── A legterheltebb orvos jövőbeli (booked + élő hold) foglalásai a
  //    drainage-dátumhoz, valamint a releváns WIP-forecast aggregátumok ──
  const busiestApptsPromise = busiestDoctorId
    ? pool.query(
        `SELECT a.start_time, COALESCE(a.duration_minutes, 30)::int as duration_minutes
         FROM appointments a
         JOIN available_time_slots ats ON a.time_slot_id = ats.id
         LEFT JOIN (
           SELECT DISTINCT ON (episode_id) episode_id, stage_code
           FROM stage_events ORDER BY episode_id, at DESC
         ) se_ep ON se_ep.episode_id = a.episode_id
         WHERE ats.user_id = $1 AND a.start_time > CURRENT_TIMESTAMP AND a.start_time <= $2
           AND a.episode_id IS NOT NULL AND se_ep.stage_code IN (${prostheticStagesIn})
           AND (ats.slot_purpose IS NULL OR ats.slot_purpose IN ('work', 'flexible'))
           AND (
             ((a.appointment_status IS NULL OR a.appointment_status = 'completed')
              AND (a.hold_expires_at IS NULL OR a.hold_expires_at <= CURRENT_TIMESTAMP))
             OR (a.hold_expires_at IS NOT NULL AND a.hold_expires_at > CURRENT_TIMESTAMP)
           )
         ORDER BY a.start_time ASC`,
        [busiestDoctorId, horizonEnd]
      )
    : Promise.resolve({ rows: [] as Array<{ start_time: Date; duration_minutes: number }> });

  // WIP-forecast: PERSONAL → csak a saját epizódok; TEAM → a workload-ban
  // résztvevő doktorok összes nyitott protetikai epizódja.
  const forecastPromise =
    viewMode === 'PERSONAL'
      ? pool.query(
          `SELECT MAX(efc.completion_end_p80) as "wipP80Max", COUNT(*)::int as "wipCount"
           FROM episode_forecast_cache efc
           JOIN patient_episodes pe ON pe.id = efc.episode_id
           LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
           LEFT JOIN episode_care_team ect ON pe.id = ect.episode_id AND ect.is_primary = true
           WHERE pe.status = 'open' AND efc.status = 'ready'
             AND se.stage_code IN (${prostheticStagesIn})
             AND (pe.assigned_provider_id = $1 OR ect.user_id = $1)`,
          [auth.userId]
        )
      : pool.query(
          `SELECT MAX(efc.completion_end_p80) as "wipP80Max", COUNT(*)::int as "wipCount"
           FROM episode_forecast_cache efc
           JOIN patient_episodes pe ON pe.id = efc.episode_id
           LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
           WHERE pe.status = 'open' AND efc.status = 'ready'
             AND se.stage_code IN (${prostheticStagesIn})`
        );

  const [busiestApptsResult, forecastResult] = await Promise.all([
    busiestApptsPromise,
    forecastPromise,
  ]);

  const wipCount: number = forecastResult.rows[0]?.wipCount ?? 0;
  const wipP80Max = forecastResult.rows[0]?.wipP80Max;
  const wipCompletionP80Max = wipP80Max ? new Date(wipP80Max).toISOString() : null;
  const wipP80DaysFromNow =
    wipCompletionP80Max != null
      ? Math.ceil(
          (new Date(wipCompletionP80Max).getTime() - serverNow.getTime()) /
            (24 * 60 * 60 * 1000)
        )
      : null;

  const reasons: string[] = [];
  let recommendation: 'GO' | 'CAUTION' | 'STOP' = 'GO';

  if (
    busynessScore >= INTAKE_STOP_BUSYNESS_PCT ||
    nearCriticalIfNewStarts ||
    (wipP80DaysFromNow != null && wipP80DaysFromNow > 28)
  ) {
    recommendation = 'STOP';
    if (busynessScore >= INTAKE_STOP_BUSYNESS_PCT) reasons.push(`BUSYNESS_${busynessScore}`);
    if (nearCriticalIfNewStarts) reasons.push('NEAR_CRITICAL_IF_NEW_STARTS');
    if (wipP80DaysFromNow != null && wipP80DaysFromNow > 28) {
      reasons.push(`WIP_P80_END_+${wipP80DaysFromNow}D`);
    }
  } else if (
    (busynessScore >= INTAKE_CAUTION_BUSYNESS_PCT && busynessScore < INTAKE_STOP_BUSYNESS_PCT) ||
    (wipP80DaysFromNow != null && wipP80DaysFromNow > 14 && wipP80DaysFromNow <= 28)
  ) {
    recommendation = 'CAUTION';
    if (busynessScore >= INTAKE_CAUTION_BUSYNESS_PCT && busynessScore < INTAKE_STOP_BUSYNESS_PCT) {
      reasons.push(`BUSYNESS_${busynessScore}`);
    }
    if (wipP80DaysFromNow != null && wipP80DaysFromNow > 14 && wipP80DaysFromNow <= 28) {
      reasons.push(`WIP_P80_END_+${wipP80DaysFromNow}D`);
    }
  } else {
    reasons.push('OK');
  }

  // ── „mikor fogadhatunk újra új beteget?" – hibrid heurisztika ──
  // 1) Foglaltság-kifutás: a legterheltebb releváns orvos jövőbeli foglalt
  //    perceiből a kumulált 50%-os küszöb dátuma (duration-súlyozott medián).
  // 2) WIP-kifutás: wipCompletionP80Max − 28 nap (mert > 28 napnál STOP-ot ad).
  // A nagyobb dátum a tényleges javaslat, legkorábban holnap.
  let nextIntakeDate: string | null = null;
  if (recommendation !== 'GO') {
    const candidates: number[] = [];

    const busiestAppts = busiestApptsResult.rows as Array<{
      start_time: Date | string;
      duration_minutes: number;
    }>;
    if (busiestAppts.length > 0) {
      const totalMinutes = busiestAppts.reduce((s, a) => s + (a.duration_minutes || 0), 0);
      if (totalMinutes > 0) {
        const half = totalMinutes / 2;
        let cum = 0;
        for (const a of busiestAppts) {
          cum += a.duration_minutes || 0;
          if (cum >= half) {
            candidates.push(new Date(a.start_time).getTime());
            break;
          }
        }
      }
    }

    if (wipCompletionP80Max) {
      const wipDrainMs =
        new Date(wipCompletionP80Max).getTime() - 28 * 24 * 60 * 60 * 1000;
      candidates.push(wipDrainMs);
    }

    if (candidates.length > 0) {
      const latest = Math.max(...candidates);
      const minDate = serverNow.getTime() + 24 * 60 * 60 * 1000; // legalább holnap
      nextIntakeDate = new Date(Math.max(latest, minDate)).toISOString();
    }
  }

  const response: IntakeRecommendationResponse = {
    recommendation,
    reasons,
    explain: {
      viewMode,
      busynessScore,
      nearCriticalIfNewStarts,
      wipCount,
      wipCompletionP80Max,
      wipP80DaysFromNow,
      nextIntakeDate,
    },
    meta: {
      serverNow: serverNow.toISOString(),
      fetchedAt: fetchedAt.toISOString(),
      policyVersion: 6,
    },
  };

  return NextResponse.json(response);
});

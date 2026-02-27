/**
 * Nightly capacity pool rebalance.
 * Retags free slots to meet weekly quotas. Only touches state='free'; freeze horizon 24h.
 */

import { getDbPool } from './db';

const FREEZE_HORIZON_HOURS = 24;
const HYSTERESIS_SLOTS = 2;

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function runRebalance(jobRunId?: string): Promise<{
  retagged: number;
  consult: number;
  work: number;
  control: number;
  flexible: number;
  errors: string[];
}> {
  const pool = getDbPool();
  const runId = jobRunId ?? `rebalance-${Date.now()}`;

  const now = new Date();
  const freezeHorizon = new Date(now.getTime() + FREEZE_HORIZON_HOURS * 60 * 60 * 1000);
  const horizonEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const weekStr = getWeekStart(now).toISOString().slice(0, 10);
  const configResult = await pool.query(
    `SELECT consult_min, consult_target, work_target, control_target, flex_target
     FROM capacity_pool_config WHERE week_start = $1`,
    [weekStr]
  );
  const config = configResult.rows[0] ?? {
    consult_min: 2,
    consult_target: 4,
    work_target: 20,
    control_target: 6,
    flex_target: 0,
  };

  const [demandResult, freeSlotsResult, countsResult] = await Promise.all([
    pool.query(
      `SELECT
        (SELECT COUNT(*)::int FROM patient_episodes pe
         LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
         WHERE pe.status = 'open' AND (se.stage_code IS NULL OR se.stage_code IN ('STAGE_1','STAGE_2','STAGE_3','STAGE_4','STAGE_5','STAGE_6'))) as wip,
        (SELECT COUNT(*)::int FROM patient_episodes pe
         LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
         WHERE pe.status = 'open' AND se.stage_code = 'STAGE_0') as consult,
        (SELECT COUNT(*)::int FROM episode_tasks WHERE task_type = 'recall_due' AND completed_at IS NULL AND due_at <= CURRENT_TIMESTAMP + INTERVAL '7 days') as recall`
    ),
    pool.query(
      `SELECT id, slot_purpose FROM available_time_slots
       WHERE state = 'free' AND start_time >= $1 AND start_time <= $2
       ORDER BY start_time ASC`,
      [freezeHorizon, horizonEnd]
    ),
    pool.query(
      `SELECT COALESCE(slot_purpose, 'flexible') as purpose, COUNT(*)::int as cnt
       FROM available_time_slots
       WHERE state = 'free' AND start_time >= $1 AND start_time <= $2
       GROUP BY slot_purpose`,
      [freezeHorizon, horizonEnd]
    ),
  ]);

  const demand = demandResult.rows[0] ?? { wip: 0, consult: 0, recall: 0 };
  const freeSlots = freeSlotsResult.rows;
  const currentCounts: Record<string, number> = { consult: 0, work: 0, control: 0, flexible: 0 };
  for (const row of countsResult.rows) {
    currentCounts[row.purpose] = row.cnt;
  }

  const goals = {
    consult: Math.max(config.consult_min, demand.consult > 0 ? config.consult_target : config.consult_min),
    work: demand.wip > 0 ? config.work_target : 0,
    control: demand.recall > 0 ? config.control_target : 0,
  };

  const flexSlots = freeSlots.filter((s: { slot_purpose: string | null }) => !s.slot_purpose || s.slot_purpose === 'flexible');
  const deficit = (t: number, c: number) => Math.max(0, t - c);

  const errors: string[] = [];
  let retagged = 0;

  const doRetag = async (slot: { id: string; slot_purpose: string | null }, newPurpose: string, reason: string) => {
    await pool.query(`UPDATE available_time_slots SET slot_purpose = $1 WHERE id = $2`, [newPurpose, slot.id]);
    await pool.query(
      `INSERT INTO slot_purpose_events (slot_id, old_purpose, new_purpose, reason, job_run_id) VALUES ($1, $2, $3, $4, $5)`,
      [slot.id, slot.slot_purpose, newPurpose, reason, runId]
    );
  };

  let flexIdx = 0;

  const cDef = deficit(goals.consult, currentCounts.consult);
  if (cDef >= HYSTERESIS_SLOTS) {
    for (let i = 0; i < cDef && flexIdx < flexSlots.length; i++, flexIdx++) {
      try {
        await doRetag(flexSlots[flexIdx], 'consult', `consult deficit ${cDef}`);
        retagged++;
      } catch (e) {
        errors.push(`consult ${flexSlots[flexIdx].id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const wDef = deficit(goals.work, currentCounts.work);
  if (wDef >= HYSTERESIS_SLOTS) {
    for (let i = 0; i < wDef && flexIdx < flexSlots.length; i++, flexIdx++) {
      try {
        await doRetag(flexSlots[flexIdx], 'work', `work deficit ${wDef}`);
        retagged++;
      } catch (e) {
        errors.push(`work ${flexSlots[flexIdx].id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const ctDef = deficit(goals.control, currentCounts.control);
  if (ctDef >= HYSTERESIS_SLOTS) {
    for (let i = 0; i < ctDef && flexIdx < flexSlots.length; i++, flexIdx++) {
      try {
        await doRetag(flexSlots[flexIdx], 'control', `control deficit ${ctDef}`);
        retagged++;
      } catch (e) {
        errors.push(`control ${flexSlots[flexIdx].id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const final = await pool.query(
    `SELECT COALESCE(slot_purpose, 'flexible') as purpose, COUNT(*)::int as cnt
     FROM available_time_slots
     WHERE state = 'free' AND start_time >= $1 AND start_time <= $2
     GROUP BY slot_purpose`,
    [freezeHorizon, horizonEnd]
  );
  const finalCounts = { consult: 0, work: 0, control: 0, flexible: 0 };
  for (const row of final.rows) {
    finalCounts[row.purpose as keyof typeof finalCounts] = row.cnt;
  }

  return {
    retagged,
    consult: finalCounts.consult,
    work: finalCounts.work,
    control: finalCounts.control,
    flexible: finalCounts.flexible,
    errors,
  };
}

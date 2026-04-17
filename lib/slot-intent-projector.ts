/**
 * Slot intent projector: projects remaining pathway steps as demand signals (slot_intents).
 * Uses advisory lock per episode, batch UPSERT, and pathway hash for drift detection.
 */

import { getDbPool } from './db';
import { computeStepWindow } from './step-window';
import { slotPoolForStep, type PathwayWorkPhaseTemplate } from './next-step-engine';
import { normalizePathwayWorkPhaseArray } from './pathway-work-phases-for-episode';

const BUDAPEST_TZ = 'Europe/Budapest';

function getBudapestHourMinute(d: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUDAPEST_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  return {
    hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0),
    minute: Number(parts.find((p) => p.type === 'minute')?.value ?? 0),
  };
}

/** Build a UTC Date that represents `localHour:localMinute` in Budapest on the given date. */
function budapestLocalToUTC(dateISO: string, localHour: number, localMinute: number): Date {
  for (const offset of [1, 2]) {
    const utcH = localHour - offset;
    const candidate = new Date(`${dateISO}T${String(utcH).padStart(2, '0')}:${String(localMinute).padStart(2, '0')}:00Z`);
    const check = getBudapestHourMinute(candidate);
    if (check.hour === localHour && check.minute === localMinute) return candidate;
  }
  return new Date(`${dateISO}T${String(localHour - 1).padStart(2, '0')}:${String(localMinute).padStart(2, '0')}:00Z`);
}

export interface ProjectionResult {
  projected: number;
  pathwayHash?: string;
  reason?: string;
}

export async function projectRemainingSteps(episodeId: string): Promise<ProjectionResult> {
  const pool = getDbPool();
  await pool.query('BEGIN');
  try {
    await pool.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [episodeId]);

    const [episodeRow, apptsRow] = await Promise.all([
      pool.query(`SELECT opened_at FROM patient_episodes WHERE id = $1 FOR SHARE`, [episodeId]),
      pool.query(
        `SELECT a.step_code, a.step_seq,
                COALESCE(a.start_time, ats.start_time) AS start_time,
                a.appointment_status
         FROM appointments a
         LEFT JOIN available_time_slots ats ON a.time_slot_id = ats.id
         WHERE a.episode_id = $1 AND a.step_code IS NOT NULL
           AND (a.appointment_status IS NULL OR a.appointment_status = 'completed')
         ORDER BY a.step_seq ASC`,
        [episodeId]
      ),
    ]);

    if (!episodeRow.rows[0]) {
      await pool.query('COMMIT');
      return { projected: 0, reason: 'NO_EPISODE' };
    }

    // Multi-pathway: merge steps from all episode_pathways, fall back to legacy care_pathway_id
    let steps: PathwayWorkPhaseTemplate[] = [];
    let pathwayHash = '';
    try {
      const multiPwRow = await pool.query(
        `SELECT cp.work_phases_json, cp.steps_json
         FROM episode_pathways ep
         JOIN care_pathways cp ON ep.care_pathway_id = cp.id
         WHERE ep.episode_id = $1 ORDER BY ep.ordinal`,
        [episodeId]
      );
      if (multiPwRow.rows.length > 0) {
        const allJson: unknown[] = [];
        for (const row of multiPwRow.rows) {
          const chunk =
            normalizePathwayWorkPhaseArray(row.work_phases_json) ??
            normalizePathwayWorkPhaseArray(row.steps_json);
          if (chunk) {
            steps.push(...chunk);
            allJson.push(chunk);
          }
        }
        const hashRow = await pool.query(
          `SELECT encode(digest($1::text, 'sha256'), 'hex') as h`,
          [JSON.stringify(allJson)]
        );
        pathwayHash = hashRow.rows[0]?.h ?? '';
      }
    } catch {
      // episode_pathways table might not exist
    }
    if (steps.length === 0) {
      const pathwayRow = await pool.query(
        `SELECT cp.work_phases_json, cp.steps_json,
                encode(digest(COALESCE(cp.work_phases_json::text, cp.steps_json::text, '[]'), 'sha256'), 'hex') as pathway_hash
         FROM patient_episodes pe
         JOIN care_pathways cp ON pe.care_pathway_id = cp.id
         WHERE pe.id = $1`,
        [episodeId]
      );
      if (!pathwayRow.rows[0]) {
        await pool.query('COMMIT');
        return { projected: 0, reason: 'NO_PATHWAY' };
      }
      const row = pathwayRow.rows[0];
      steps =
        normalizePathwayWorkPhaseArray(row.work_phases_json) ??
        normalizePathwayWorkPhaseArray(row.steps_json) ??
        [];
      pathwayHash = pathwayRow.rows[0].pathway_hash;
    }

    if (!steps || steps.length === 0) {
      await pool.query('COMMIT');
      return { projected: 0, reason: 'NO_PATHWAY' };
    }
    const openedAt = new Date(episodeRow.rows[0].opened_at);

    const pathwayByCode = new Map<string, PathwayWorkPhaseTemplate>();
    for (const s of steps) pathwayByCode.set(s.work_phase_code, s);

    // Appointment coverage: keyed by step_code (not step_seq) to avoid index mismatches
    const completedStepCodes = new Set<string>();
    const bookedStepCodes = new Set<string>();
    let lastHardAnchor = openedAt;
    for (const a of apptsRow.rows) {
      const startTime = a.start_time ? new Date(a.start_time) : null;
      if (a.appointment_status === 'completed') {
        completedStepCodes.add(a.step_code);
        if (startTime && startTime > lastHardAnchor) lastHardAnchor = startTime;
      } else {
        bookedStepCodes.add(a.step_code);
        if (startTime && startTime > lastHardAnchor) lastHardAnchor = startTime;
      }
    }

    // Episode steps: authoritative source for which steps exist, their order, and completion status
    interface EwpRow {
      work_phase_code: string;
      step_seq: number;
      status: string;
      completed_at: Date | null;
      default_days_offset?: number | null;
      duration_minutes?: number | null;
    }
    let episodeWorkPhaseRows: EwpRow[] | null = null;
    try {
      // Összevont (child) sorok kihagyása — ugyanarra az időpontra tartoznak a primary-hoz; különben az anchor-lánc
      // minden gyerekre külön lépdel, és az offsetek összeadódnának (next-step-engine / worklist már így szűr).
      let mergedIntoFilter = '';
      try {
        const col = await pool.query(
          `SELECT 1 FROM information_schema.columns
           WHERE table_name = 'episode_work_phases' AND column_name = 'merged_into_episode_work_phase_id' LIMIT 1`
        );
        if (col.rows.length > 0) mergedIntoFilter = ' AND merged_into_episode_work_phase_id IS NULL';
      } catch {
        /* ignore */
      }
      const esResult = await pool.query(
        `SELECT work_phase_code, COALESCE(seq, pathway_order_index) as step_seq, status, completed_at,
                default_days_offset, duration_minutes
         FROM episode_work_phases WHERE episode_id = $1${mergedIntoFilter}
         ORDER BY COALESCE(seq, pathway_order_index)`,
        [episodeId]
      );
      if (esResult.rows.length > 0) episodeWorkPhaseRows = esResult.rows as EwpRow[];
    } catch {
      /* table may not exist */
    }

    if (episodeWorkPhaseRows) {
      for (const es of episodeWorkPhaseRows) {
        if (es.status === 'completed' || es.status === 'skipped') {
          completedStepCodes.add(es.work_phase_code);
          if (es.completed_at) {
            const t = new Date(es.completed_at);
            if (t > lastHardAnchor) lastHardAnchor = t;
          }
        }
      }
    }

    // Expire stale intents: completed or already-booked step_codes, or pathway hash mismatch
    const coveredCodes = [...Array.from(completedStepCodes), ...Array.from(bookedStepCodes)];
    if (coveredCodes.length > 0 || pathwayHash) {
      await pool.query(
        `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP
         WHERE episode_id = $1
           AND state = 'open'
           AND (
             step_code = ANY($2::text[])
             OR (source_pathway_hash IS NOT NULL AND source_pathway_hash IS DISTINCT FROM $3)
           )`,
        [episodeId, coveredCodes, pathwayHash]
      );
    }

    interface Projection {
      stepCode: string; stepSeq: number; pool: string;
      durationMinutes: number; windowStart: Date; windowEnd: Date; expiresAt: Date;
      suggestedStart: Date | null; suggestedEnd: Date | null;
    }
    const projections: Projection[] = [];

    // Use episode_work_phases when available (authoritative list); fall back to pathway indices
    const stepsToProject: Array<{ stepCode: string; stepSeq: number; offset: number; durationMinutes: number; pool: string }> = [];

    if (episodeWorkPhaseRows) {
      for (const es of episodeWorkPhaseRows) {
        if (es.status !== 'pending' && es.status !== 'scheduled') continue;
        if (completedStepCodes.has(es.work_phase_code)) continue;
        if (bookedStepCodes.has(es.work_phase_code)) continue;
        const pw = pathwayByCode.get(es.work_phase_code);
        const ewpDur = es.duration_minutes != null ? Number(es.duration_minutes) : null;
        stepsToProject.push({
          stepCode: es.work_phase_code,
          stepSeq: es.step_seq,
          offset: (es.default_days_offset ?? pw?.default_days_offset) ?? 14,
          durationMinutes:
            ewpDur != null && ewpDur > 0 ? ewpDur : (pw?.duration_minutes ?? 30),
          pool: pw ? slotPoolForStep(pw) : 'work',
        });
      }
    } else {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (completedStepCodes.has(step.work_phase_code)) continue;
        if (bookedStepCodes.has(step.work_phase_code)) continue;
        stepsToProject.push({
          stepCode: step.work_phase_code,
          stepSeq: i,
          offset: step.default_days_offset ?? 14,
          durationMinutes: step.duration_minutes ?? 30,
          pool: slotPoolForStep(step),
        });
      }
    }

    // Determine the Budapest local time-of-day from the anchor (e.g. 12:30 Budapest)
    const anchorLocal = getBudapestHourMinute(lastHardAnchor);

    let anchor = lastHardAnchor;
    for (const sp of stepsToProject) {
      const { windowStart, windowEnd } = computeStepWindow(anchor, sp.offset);
      const expiresAt = new Date(windowEnd);
      expiresAt.setDate(expiresAt.getDate() + 30);

      // Compute target date (anchor + offset days), then place at the same Budapest local time
      const rawDate = new Date(anchor);
      rawDate.setDate(rawDate.getDate() + sp.offset);
      const dateISO = rawDate.toISOString().slice(0, 10);
      const suggestedStart = budapestLocalToUTC(dateISO, anchorLocal.hour, anchorLocal.minute);
      const suggestedEnd = new Date(suggestedStart.getTime() + sp.durationMinutes * 60 * 1000);

      projections.push({
        stepCode: sp.stepCode, stepSeq: sp.stepSeq, pool: sp.pool,
        durationMinutes: sp.durationMinutes,
        windowStart, windowEnd, expiresAt,
        suggestedStart, suggestedEnd,
      });

      // Chain anchor: next step anchors from this step's expected date
      anchor = suggestedStart;
    }

    // Batch UPSERT: reopens expired intents, does NOT touch converted or cancelled
    if (projections.length > 0) {
      const values: string[] = [];
      const params: unknown[] = [episodeId, pathwayHash];
      let paramIdx = 3;

      for (const p of projections) {
        values.push(
          `($1, $${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, 'open', $2, $${paramIdx+6}, $${paramIdx+7}, $${paramIdx+8})`
        );
        params.push(p.stepCode, p.stepSeq, p.pool, p.durationMinutes,
                     p.windowStart, p.windowEnd, p.expiresAt, p.suggestedStart, p.suggestedEnd);
        paramIdx += 9;
      }

      await pool.query(
        `INSERT INTO slot_intents
           (episode_id, step_code, step_seq, pool, duration_minutes,
            window_start, window_end, state, source_pathway_hash, expires_at, suggested_start, suggested_end)
         VALUES ${values.join(', ')}
         ON CONFLICT (episode_id, step_code, step_seq) DO UPDATE SET
           window_start = EXCLUDED.window_start,
           window_end = EXCLUDED.window_end,
           source_pathway_hash = EXCLUDED.source_pathway_hash,
           expires_at = EXCLUDED.expires_at,
           suggested_start = EXCLUDED.suggested_start,
           suggested_end = EXCLUDED.suggested_end,
           state = 'open',
           updated_at = CURRENT_TIMESTAMP
         WHERE slot_intents.state IN ('open', 'expired')`,
        params
      );
    }

    // Expire orphan open intents: step_codes no longer pending, or old step_seq mismatches from previous projections
    const projectedKeys = new Set(projections.map((p) => `${p.stepCode}:${p.stepSeq}`));
    const orphanExpire = await pool.query(
      `SELECT id, step_code, step_seq FROM slot_intents
       WHERE episode_id = $1 AND state = 'open'`,
      [episodeId]
    );
    const orphanIds = orphanExpire.rows
      .filter((r: { step_code: string; step_seq: number }) => !projectedKeys.has(`${r.step_code}:${r.step_seq}`))
      .map((r: { id: string }) => r.id);
    if (orphanIds.length > 0) {
      await pool.query(
        `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1::uuid[])`,
        [orphanIds]
      );
    }

    await pool.query('COMMIT');
    return { projected: projections.length, pathwayHash };
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

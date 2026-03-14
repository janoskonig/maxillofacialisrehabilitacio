/**
 * Slot intent projector: projects remaining pathway steps as demand signals (slot_intents).
 * Uses advisory lock per episode, batch UPSERT, and pathway hash for drift detection.
 */

import { getDbPool } from './db';
import { computeStepWindow } from './step-window';
import { slotPoolForStep, type PathwayStep } from './next-step-engine';

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
    let steps: PathwayStep[] = [];
    let pathwayHash = '';
    try {
      const multiPwRow = await pool.query(
        `SELECT cp.steps_json
         FROM episode_pathways ep
         JOIN care_pathways cp ON ep.care_pathway_id = cp.id
         WHERE ep.episode_id = $1 ORDER BY ep.ordinal`,
        [episodeId]
      );
      if (multiPwRow.rows.length > 0) {
        const allJson: unknown[] = [];
        for (const row of multiPwRow.rows) {
          if (Array.isArray(row.steps_json)) {
            steps.push(...(row.steps_json as PathwayStep[]));
            allJson.push(row.steps_json);
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
        `SELECT cp.steps_json, encode(digest(cp.steps_json::text, 'sha256'), 'hex') as pathway_hash
         FROM patient_episodes pe
         JOIN care_pathways cp ON pe.care_pathway_id = cp.id
         WHERE pe.id = $1`,
        [episodeId]
      );
      if (!pathwayRow.rows[0]) {
        await pool.query('COMMIT');
        return { projected: 0, reason: 'NO_PATHWAY' };
      }
      steps = pathwayRow.rows[0].steps_json as PathwayStep[];
      pathwayHash = pathwayRow.rows[0].pathway_hash;
    }

    if (!steps || steps.length === 0) {
      await pool.query('COMMIT');
      return { projected: 0, reason: 'NO_PATHWAY' };
    }
    const openedAt = new Date(episodeRow.rows[0].opened_at);

    const completedBySeq = new Map<number, Date>();
    const pendingSeqs = new Set<number>();
    /** Anchor date per step (completed or booked); used to pick latest anchor for projecting next steps. */
    const anchorBySeq = new Map<number, Date>();
    for (const a of apptsRow.rows) {
      const startTime = a.start_time ? new Date(a.start_time) : null;
      if (startTime) anchorBySeq.set(a.step_seq, startTime);
      if (a.appointment_status === 'completed') {
        completedBySeq.set(a.step_seq, startTime ?? new Date(0));
      } else {
        pendingSeqs.add(a.step_seq);
      }
    }

    const coveredSeqs = new Set([...Array.from(completedBySeq.keys()), ...Array.from(pendingSeqs)]);

    // Expire stale open intents: pathway hash mismatch, completed steps, or steps with pending appointments
    const completedSeqArr = Array.from(completedBySeq.keys());
    const pendingSeqArr = Array.from(pendingSeqs);
    await pool.query(
      `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE episode_id = $1
         AND state = 'open'
         AND (
           (source_pathway_hash IS NOT NULL AND source_pathway_hash IS DISTINCT FROM $2)
           OR step_seq = ANY($3::int[])
           OR step_seq = ANY($4::int[])
         )`,
      [episodeId, pathwayHash, completedSeqArr, pendingSeqArr]
    );

    // Last anchor: most recent appointment date (completed or booked) — next steps anchor from this
    let lastHardAnchor = openedAt;
    let lastHardAnchorSeq = -1;
    for (const [seq, startTime] of Array.from(anchorBySeq.entries())) {
      if (startTime > lastHardAnchor) {
        lastHardAnchor = startTime;
        lastHardAnchorSeq = seq;
      }
    }

    interface Projection {
      stepCode: string; stepSeq: number; pool: string;
      durationMinutes: number; windowStart: Date; windowEnd: Date; expiresAt: Date;
      suggestedStart: Date | null; suggestedEnd: Date | null;
    }
    const projections: Projection[] = [];

    for (let i = 0; i < steps.length; i++) {
      if (coveredSeqs.has(i)) continue;

      const step = steps[i];
      const offset = step.default_days_offset ?? 14;

      // Cumulative offset from last hard anchor for uncompleted intermediate steps
      let cumulativeOffset = 0;
      for (let j = lastHardAnchorSeq + 1; j < i; j++) {
        if (!completedBySeq.has(j)) {
          cumulativeOffset += steps[j].default_days_offset ?? 14;
        }
      }
      const stepAnchor = new Date(lastHardAnchor);
      stepAnchor.setDate(stepAnchor.getDate() + cumulativeOffset);

      const { windowStart, windowEnd } = computeStepWindow(stepAnchor, offset);
      const expiresAt = new Date(windowEnd);
      expiresAt.setDate(expiresAt.getDate() + 30);

      const durationMinutes = step.duration_minutes ?? 30;
      // Same time-of-day as last anchor, date = stepAnchor (so following Tuesdays if anchor was Tuesday)
      const suggestedStart = new Date(stepAnchor);
      suggestedStart.setHours(lastHardAnchor.getHours(), lastHardAnchor.getMinutes(), lastHardAnchor.getSeconds(), lastHardAnchor.getMilliseconds());
      const suggestedEnd = new Date(suggestedStart.getTime() + durationMinutes * 60 * 1000);

      projections.push({
        stepCode: step.step_code, stepSeq: i, pool: slotPoolForStep(step),
        durationMinutes,
        windowStart, windowEnd, expiresAt,
        suggestedStart, suggestedEnd,
      });
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

    await pool.query('COMMIT');
    return { projected: projections.length, pathwayHash };
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

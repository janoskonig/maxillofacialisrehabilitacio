/**
 * Slot intent projector: projects remaining pathway steps as demand signals (slot_intents).
 * Uses advisory lock per episode, batch UPSERT, and pathway hash for drift detection.
 */

import { getDbPool } from './db';
import { computeStepWindow } from './step-window';
import type { PathwayStep } from './next-step-engine';

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
        `SELECT step_code, step_seq, start_time, appointment_status
         FROM appointments
         WHERE episode_id = $1
           AND step_code IS NOT NULL
           AND (appointment_status IS NULL OR appointment_status = 'completed')
         ORDER BY step_seq ASC`,
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
    for (const a of apptsRow.rows) {
      if (a.appointment_status === 'completed') {
        completedBySeq.set(a.step_seq, new Date(a.start_time));
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

    // Find last hard anchor (most recent completed appointment)
    let lastHardAnchor = openedAt;
    let lastHardAnchorSeq = -1;
    for (const [seq, startTime] of Array.from(completedBySeq.entries())) {
      if (seq > lastHardAnchorSeq) {
        lastHardAnchor = startTime;
        lastHardAnchorSeq = seq;
      }
    }

    interface Projection {
      stepCode: string; stepSeq: number; pool: string;
      durationMinutes: number; windowStart: Date; windowEnd: Date; expiresAt: Date;
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

      projections.push({
        stepCode: step.step_code, stepSeq: i, pool: step.pool,
        durationMinutes: step.duration_minutes ?? 30,
        windowStart, windowEnd, expiresAt,
      });
    }

    // Batch UPSERT: reopens expired intents, does NOT touch converted or cancelled
    if (projections.length > 0) {
      const values: string[] = [];
      const params: unknown[] = [episodeId, pathwayHash];
      let paramIdx = 3;

      for (const p of projections) {
        values.push(
          `($1, $${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, 'open', $2, $${paramIdx+6})`
        );
        params.push(p.stepCode, p.stepSeq, p.pool, p.durationMinutes,
                     p.windowStart, p.windowEnd, p.expiresAt);
        paramIdx += 7;
      }

      await pool.query(
        `INSERT INTO slot_intents
           (episode_id, step_code, step_seq, pool, duration_minutes,
            window_start, window_end, state, source_pathway_hash, expires_at)
         VALUES ${values.join(', ')}
         ON CONFLICT (episode_id, step_code, step_seq) DO UPDATE SET
           window_start = EXCLUDED.window_start,
           window_end = EXCLUDED.window_end,
           source_pathway_hash = EXCLUDED.source_pathway_hash,
           expires_at = EXCLUDED.expires_at,
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

/**
 * Episode work-phase generation (extracted from POST /api/episodes/:id/work-phases/generate
 * so activation, the backfill script, and the API route share one implementation).
 *
 * Idempotent: skips pathways that already have generated phases and tooth treatments
 * already turned into steps. Runs in a single transaction.
 */

import type { Pool } from 'pg';
import { normalizePathwayWorkPhaseArray } from './pathway-work-phases-for-episode';

export type GenerateWorkPhasesResult =
  | { status: 'ok'; totalGenerated: number }
  | { status: 'not_found' }
  | { status: 'not_open' }
  | { status: 'no_pathway' };

/**
 * Generate episode_work_phases for an episode from its care pathway(s) + linked tooth
 * treatments. Returns a structured result instead of throwing HTTP errors so callers
 * (route, activation, backfill) can decide how to react.
 */
export async function generateEpisodeWorkPhases(
  pool: Pool,
  episodeId: string
): Promise<GenerateWorkPhasesResult> {
  const epRow = await pool.query(
    `SELECT pe.id, pe.patient_id, pe.care_pathway_id, pe.status
     FROM patient_episodes pe WHERE pe.id = $1`,
    [episodeId]
  );
  if (epRow.rows.length === 0) return { status: 'not_found' };

  const ep = epRow.rows[0];
  if (ep.status !== 'open') return { status: 'not_open' };

  let epPathways: Array<{ id: string; care_pathway_id: string }> = [];
  try {
    const epPathwayRows = await pool.query(
      `SELECT id, care_pathway_id FROM episode_pathways WHERE episode_id = $1 ORDER BY ordinal`,
      [episodeId]
    );
    epPathways = epPathwayRows.rows;
  } catch {
    // episode_pathways table might not exist yet
  }

  if (epPathways.length === 0 && ep.care_pathway_id) {
    try {
      const ins = await pool.query(
        `INSERT INTO episode_pathways (episode_id, care_pathway_id, ordinal)
         VALUES ($1, $2, 0)
         ON CONFLICT (episode_id, care_pathway_id) DO NOTHING
         RETURNING id, care_pathway_id`,
        [episodeId, ep.care_pathway_id]
      );
      if (ins.rows.length > 0) {
        epPathways = ins.rows;
      } else {
        const existing = await pool.query(
          `SELECT id, care_pathway_id FROM episode_pathways WHERE episode_id = $1 AND care_pathway_id = $2`,
          [episodeId, ep.care_pathway_id]
        );
        epPathways = existing.rows;
      }
    } catch {
      epPathways = [{ id: '__legacy__', care_pathway_id: ep.care_pathway_id }];
    }
  }

  if (epPathways.length === 0) return { status: 'no_pathway' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const maxSeqRow = await client.query(
      `SELECT COALESCE(MAX(seq), -1) as max_seq FROM episode_work_phases WHERE episode_id = $1`,
      [episodeId]
    );
    let nextSeq: number = (maxSeqRow.rows[0].max_seq ?? -1) + 1;
    let totalGenerated = 0;

    for (const epPw of epPathways) {
      const alreadyExists = await client.query(
        epPw.id === '__legacy__'
          ? `SELECT 1 FROM episode_work_phases WHERE episode_id = $1 AND source_episode_pathway_id IS NULL LIMIT 1`
          : `SELECT 1 FROM episode_work_phases WHERE source_episode_pathway_id = $1 LIMIT 1`,
        epPw.id === '__legacy__' ? [episodeId] : [epPw.id]
      );
      if (alreadyExists.rows.length > 0) continue;

      const pathwayRow = await client.query(
        `SELECT work_phases_json, steps_json FROM care_pathways WHERE id = $1`,
        [epPw.care_pathway_id]
      );
      const templates =
        normalizePathwayWorkPhaseArray(pathwayRow.rows[0]?.work_phases_json) ??
        normalizePathwayWorkPhaseArray(pathwayRow.rows[0]?.steps_json);

      if (!templates || templates.length === 0) continue;

      const insertValues: unknown[] = [];
      const insertPlaceholders: string[] = [];
      let pIdx = 1;

      for (let i = 0; i < templates.length; i++) {
        const ph = templates[i];
        const sourceId = epPw.id === '__legacy__' ? null : epPw.id;
        insertPlaceholders.push(
          `($${pIdx}, $${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4}, $${pIdx + 5}, $${pIdx + 6}, $${pIdx + 7})`
        );
        insertValues.push(
          episodeId,
          ph.work_phase_code,
          i,
          ph.pool ?? 'work',
          ph.duration_minutes ?? 30,
          ph.default_days_offset ?? 7,
          sourceId,
          nextSeq + i
        );
        pIdx += 8;
      }

      await client.query(
        `INSERT INTO episode_work_phases (episode_id, work_phase_code, pathway_order_index, pool, duration_minutes, default_days_offset, source_episode_pathway_id, seq)
         VALUES ${insertPlaceholders.join(', ')}`,
        insertValues
      );

      nextSeq += templates.length;
      totalGenerated += templates.length;
    }

    // Sync linked tooth treatments into steps (automatic: all episode_linked treatments become steps)
    const hasToothCol = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'episode_work_phases' AND column_name = 'tooth_treatment_id' LIMIT 1`
    );
    if (hasToothCol.rows.length > 0) {
      const missing = await client.query(
        `SELECT tt.id, tt.treatment_code, tt.tooth_number, ttc.label_hu as "label_hu"
         FROM tooth_treatments tt
         JOIN tooth_treatment_catalog ttc ON tt.treatment_code = ttc.code
         WHERE tt.episode_id = $1 AND tt.status = 'episode_linked'
           AND NOT EXISTS (SELECT 1 FROM episode_work_phases es WHERE es.episode_id = tt.episode_id AND es.tooth_treatment_id = tt.id)
         ORDER BY tt.tooth_number, ttc.sort_order`,
        [episodeId]
      );
      for (const row of missing.rows) {
        const workPhaseCode = `tooth_${row.treatment_code}`;
        const customLabel = `${row.label_hu} – ${row.tooth_number}`;
        const maxIdxRow = await client.query(
          `SELECT COALESCE(MAX(pathway_order_index), -1) as max_idx FROM episode_work_phases WHERE episode_id = $1`,
          [episodeId]
        );
        const nextIdx = (maxIdxRow.rows[0].max_idx ?? -1) + 1;
        await client.query(
          `INSERT INTO episode_work_phases (episode_id, work_phase_code, pathway_order_index, pool, duration_minutes, default_days_offset, seq, tooth_treatment_id, custom_label)
           VALUES ($1, $2, $3, 'work', 30, 7, $4, $5, $6)`,
          [episodeId, workPhaseCode, nextIdx, nextSeq, row.id, customLabel]
        );
        nextSeq += 1;
        totalGenerated += 1;
      }
    }

    await client.query('COMMIT');
    return { status: 'ok', totalGenerated };
  } catch (txError) {
    await client.query('ROLLBACK');
    throw txError;
  } finally {
    client.release();
  }
}

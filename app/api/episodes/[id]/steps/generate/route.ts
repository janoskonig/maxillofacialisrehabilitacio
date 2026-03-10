import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';
import { getFullStepQuery } from '@/lib/episode-step-select';

export const dynamic = 'force-dynamic';

/**
 * POST /api/episodes/:id/steps/generate — idempotent episode_steps generation.
 * Multi-pathway aware: generates steps from ALL episode_pathways (or falls back to legacy care_pathway_id).
 */
export const POST = authedHandler(async (req, { auth, params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  const epRow = await pool.query(
    `SELECT pe.id, pe.patient_id, pe.care_pathway_id, pe.status
     FROM patient_episodes pe WHERE pe.id = $1`,
    [episodeId]
  );
  if (epRow.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }

  const ep = epRow.rows[0];
  if (ep.status !== 'open') {
    return NextResponse.json({ error: 'Csak aktív epizódhoz generálható lépés' }, { status: 400 });
  }

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

  if (epPathways.length === 0) {
    return NextResponse.json(
      { error: 'Epizódhoz nincs hozzárendelve kezelési út (care_pathway). Először válasszon pathway-t.' },
      { status: 409 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const maxSeqRow = await client.query(
      `SELECT COALESCE(MAX(seq), -1) as max_seq FROM episode_steps WHERE episode_id = $1`,
      [episodeId]
    );
    let nextSeq: number = (maxSeqRow.rows[0].max_seq ?? -1) + 1;
    let totalGenerated = 0;

    for (const epPw of epPathways) {
      const alreadyExists = await client.query(
        epPw.id === '__legacy__'
          ? `SELECT 1 FROM episode_steps WHERE episode_id = $1 AND source_episode_pathway_id IS NULL LIMIT 1`
          : `SELECT 1 FROM episode_steps WHERE source_episode_pathway_id = $1 LIMIT 1`,
        epPw.id === '__legacy__' ? [episodeId] : [epPw.id]
      );
      if (alreadyExists.rows.length > 0) continue;

      const pathwayRow = await client.query(
        `SELECT steps_json FROM care_pathways WHERE id = $1`,
        [epPw.care_pathway_id]
      );
      const stepsJson = pathwayRow.rows[0]?.steps_json as Array<{
        step_code: string;
        pool?: string;
        duration_minutes?: number;
        default_days_offset?: number;
      }> | null;

      if (!Array.isArray(stepsJson) || stepsJson.length === 0) continue;

      const insertValues: unknown[] = [];
      const insertPlaceholders: string[] = [];
      let pIdx = 1;

      for (let i = 0; i < stepsJson.length; i++) {
        const step = stepsJson[i];
        const sourceId = epPw.id === '__legacy__' ? null : epPw.id;
        insertPlaceholders.push(
          `($${pIdx}, $${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4}, $${pIdx + 5}, $${pIdx + 6}, $${pIdx + 7})`
        );
        insertValues.push(
          episodeId,
          step.step_code,
          i,
          step.pool ?? 'work',
          step.duration_minutes ?? 30,
          step.default_days_offset ?? 7,
          sourceId,
          nextSeq + i
        );
        pIdx += 8;
      }

      await client.query(
        `INSERT INTO episode_steps (episode_id, step_code, pathway_order_index, pool, duration_minutes, default_days_offset, source_episode_pathway_id, seq)
         VALUES ${insertPlaceholders.join(', ')}`,
        insertValues
      );

      nextSeq += stepsJson.length;
      totalGenerated += stepsJson.length;
    }

    // Sync linked tooth treatments into steps (automatic: all episode_linked treatments become steps)
    const hasToothCol = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'episode_steps' AND column_name = 'tooth_treatment_id' LIMIT 1`
    );
    if (hasToothCol.rows.length > 0) {
      const missing = await client.query(
        `SELECT tt.id, tt.treatment_code, tt.tooth_number, ttc.label_hu as "label_hu"
         FROM tooth_treatments tt
         JOIN tooth_treatment_catalog ttc ON tt.treatment_code = ttc.code
         WHERE tt.episode_id = $1 AND tt.status = 'episode_linked'
           AND NOT EXISTS (SELECT 1 FROM episode_steps es WHERE es.episode_id = tt.episode_id AND es.tooth_treatment_id = tt.id)
         ORDER BY tt.tooth_number, ttc.sort_order`,
        [episodeId]
      );
      for (const row of missing.rows) {
        const stepCode = `tooth_${row.treatment_code}`;
        const customLabel = `${row.label_hu} – ${row.tooth_number}`;
        const maxIdxRow = await client.query(
          `SELECT COALESCE(MAX(pathway_order_index), -1) as max_idx FROM episode_steps WHERE episode_id = $1`,
          [episodeId]
        );
        const nextIdx = (maxIdxRow.rows[0].max_idx ?? -1) + 1;
        await client.query(
          `INSERT INTO episode_steps (episode_id, step_code, pathway_order_index, pool, duration_minutes, default_days_offset, seq, tooth_treatment_id, custom_label)
           VALUES ($1, $2, $3, 'work', 30, 7, $4, $5, $6)`,
          [episodeId, stepCode, nextIdx, nextSeq, row.id, customLabel]
        );
        nextSeq += 1;
        totalGenerated += 1;
      }
    }

    await client.query('COMMIT');

    const allSteps = await getFullStepQuery(pool, episodeId);

    return NextResponse.json({
      steps: allSteps.rows,
      generated: totalGenerated > 0,
      message: totalGenerated > 0 ? `${totalGenerated} lépés generálva` : 'Lépések már léteznek',
    }, { status: totalGenerated > 0 ? 201 : 200 });
  } catch (txError) {
    await client.query('ROLLBACK');
    throw txError;
  } finally {
    client.release();
  }
});

import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

const PATIENT_ID = 'a0eb15e8-003e-44ff-b4d4-18906b64d898';

/**
 * POST /api/admin/fix-episodes
 * One-time fix: merge spurious per-tooth episodes back into the original episode.
 * Admin-only. DELETE THIS ROUTE AFTER USE.
 */
export const POST = roleHandler(['admin'], async () => {
  const pool = getDbPool();
  const client = await pool.connect();
  const log: string[] = [];

  try {
    const allEpisodes = await client.query(
      `SELECT id, chief_complaint, status, opened_at, closed_at
       FROM patient_episodes WHERE patient_id = $1 ORDER BY opened_at ASC`,
      [PATIENT_ID]
    );
    log.push(`Found ${allEpisodes.rows.length} episodes`);

    const originalEpisode = allEpisodes.rows.find(
      (ep: Record<string, unknown>) => !(ep.chief_complaint as string).startsWith('Fog ')
    );
    if (!originalEpisode) {
      return NextResponse.json({ error: 'Original episode not found', log }, { status: 404 });
    }
    log.push(`Original: "${originalEpisode.chief_complaint}" (${originalEpisode.id}) [${originalEpisode.status}]`);

    const spuriousEpisodes = allEpisodes.rows.filter(
      (ep: Record<string, unknown>) =>
        (ep.chief_complaint as string).startsWith('Fog ') && ep.id !== originalEpisode.id
    );
    if (spuriousEpisodes.length === 0) {
      return NextResponse.json({ message: 'No spurious episodes found — already fixed?', log });
    }

    const spuriousIds = spuriousEpisodes.map((ep: Record<string, unknown>) => ep.id as string);
    log.push(`Spurious episodes: ${spuriousIds.length} → ${spuriousEpisodes.map((e: Record<string, unknown>) => e.chief_complaint).join(', ')}`);

    await client.query('BEGIN');

    // Re-link tooth_treatments
    const ttUpdate = await client.query(
      `UPDATE tooth_treatments SET episode_id = $1
       WHERE patient_id = $2 AND episode_id = ANY($3)`,
      [originalEpisode.id, PATIENT_ID, spuriousIds]
    );
    log.push(`Re-linked ${ttUpdate.rowCount} tooth treatments`);

    // Move episode_pathways (skip duplicates)
    for (const spId of spuriousIds) {
      const pathways = await client.query(
        `SELECT care_pathway_id, jaw FROM episode_pathways WHERE episode_id = $1`,
        [spId]
      );
      for (const pw of pathways.rows) {
        const exists = await client.query(
          `SELECT 1 FROM episode_pathways
           WHERE episode_id = $1 AND care_pathway_id = $2
             AND COALESCE(jaw, '_none_') = COALESCE($3, '_none_')`,
          [originalEpisode.id, pw.care_pathway_id, pw.jaw]
        );
        if (exists.rows.length === 0) {
          const ordRow = await client.query(
            `SELECT COALESCE(MAX(ordinal), -1) + 1 as next_ord
             FROM episode_pathways WHERE episode_id = $1`,
            [originalEpisode.id]
          );
          await client.query(
            `INSERT INTO episode_pathways (episode_id, care_pathway_id, ordinal, jaw)
             VALUES ($1, $2, $3, $4)`,
            [originalEpisode.id, pw.care_pathway_id, ordRow.rows[0].next_ord, pw.jaw]
          );
          log.push(`Moved pathway ${pw.care_pathway_id} (jaw=${pw.jaw})`);
        }
      }
    }

    // Move episode_steps
    const stepsUpdate = await client.query(
      `UPDATE episode_steps SET episode_id = $1 WHERE episode_id = ANY($2)`,
      [originalEpisode.id, spuriousIds]
    );
    log.push(`Moved ${stepsUpdate.rowCount} episode_steps`);

    // Re-sequence steps
    await client.query(
      `WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY seq, pathway_order_index) - 1 as new_seq
        FROM episode_steps WHERE episode_id = $1
      )
      UPDATE episode_steps SET seq = numbered.new_seq
      FROM numbered WHERE episode_steps.id = numbered.id`,
      [originalEpisode.id]
    );

    // Move stage_events
    const seUpdate = await client.query(
      `UPDATE stage_events SET episode_id = $1 WHERE episode_id = ANY($2)`,
      [originalEpisode.id, spuriousIds]
    );
    log.push(`Moved ${seUpdate.rowCount} stage_events`);

    // Delete spurious episode_pathways and episodes
    await client.query(
      `DELETE FROM episode_pathways WHERE episode_id = ANY($1)`,
      [spuriousIds]
    );
    const delResult = await client.query(
      `DELETE FROM patient_episodes WHERE id = ANY($1)`,
      [spuriousIds]
    );
    log.push(`Deleted ${delResult.rowCount} spurious episodes`);

    // Reopen original if closed
    if (originalEpisode.status !== 'open') {
      await client.query(
        `UPDATE patient_episodes SET status = 'open', closed_at = NULL WHERE id = $1`,
        [originalEpisode.id]
      );
      log.push('Reopened original episode');
    }

    // Update legacy care_pathway_id
    const firstPathway = await client.query(
      `SELECT care_pathway_id FROM episode_pathways WHERE episode_id = $1 ORDER BY ordinal LIMIT 1`,
      [originalEpisode.id]
    );
    if (firstPathway.rows.length > 0) {
      await client.query(
        `UPDATE patient_episodes SET care_pathway_id = $1 WHERE id = $2`,
        [firstPathway.rows[0].care_pathway_id, originalEpisode.id]
      );
    }

    await client.query('COMMIT');

    // Final verification
    const finalEpisodes = await client.query(
      `SELECT id, chief_complaint, status FROM patient_episodes
       WHERE patient_id = $1 ORDER BY opened_at`,
      [PATIENT_ID]
    );
    const finalTreatments = await client.query(
      `SELECT tooth_number, treatment_code, status, episode_id
       FROM tooth_treatments WHERE patient_id = $1 ORDER BY tooth_number`,
      [PATIENT_ID]
    );

    return NextResponse.json({
      message: 'Fix applied successfully',
      log,
      finalEpisodes: finalEpisodes.rows,
      finalTreatments: finalTreatments.rows,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    return NextResponse.json(
      { error: String(err), log },
      { status: 500 }
    );
  } finally {
    client.release();
  }
});

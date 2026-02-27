import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

const STEP_SELECT_BASE = `id, episode_id as "episodeId", step_code as "stepCode",
  pathway_order_index as "pathwayOrderIndex", pool, duration_minutes as "durationMinutes",
  default_days_offset as "defaultDaysOffset", status,
  appointment_id as "appointmentId", created_at as "createdAt",
  completed_at as "completedAt", source_episode_pathway_id as "sourceEpisodePathwayId",
  seq`;

async function getStepSelect(pool: ReturnType<typeof getDbPool>): Promise<string> {
  try {
    const colCheck = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'episode_steps' AND column_name = 'custom_label' LIMIT 1`
    );
    if (colCheck.rows.length > 0) return STEP_SELECT_BASE + `, custom_label as "customLabel"`;
  } catch { /* column doesn't exist */ }
  return STEP_SELECT_BASE;
}

/**
 * POST /api/episodes/:id/steps/generate — idempotent episode_steps generation.
 * Multi-pathway aware: generates steps from ALL episode_pathways (or falls back to legacy care_pathway_id).
 * If steps already exist for a pathway, skips that pathway (idempotent).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

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

    // Gather pathways: prefer episode_pathways, fall back to legacy care_pathway_id
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

    // Legacy fallback: if no episode_pathways rows but care_pathway_id is set, create one
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
        // If episode_pathways table doesn't exist, proceed with legacy single-pathway mode
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

      // Get current max seq for this episode
      const maxSeqRow = await client.query(
        `SELECT COALESCE(MAX(seq), -1) as max_seq FROM episode_steps WHERE episode_id = $1`,
        [episodeId]
      );
      let nextSeq: number = (maxSeqRow.rows[0].max_seq ?? -1) + 1;
      let totalGenerated = 0;

      for (const epPw of epPathways) {
        // Skip if steps already generated for this episode_pathway
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

      await client.query('COMMIT');

      const stepSelect = await getStepSelect(pool);
      const allSteps = await pool.query(
        `SELECT ${stepSelect} FROM episode_steps WHERE episode_id = $1 ORDER BY COALESCE(seq, pathway_order_index)`,
        [episodeId]
      );

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
  } catch (error) {
    console.error('Error in POST /episodes/:id/steps/generate:', error);
    return NextResponse.json(
      { error: 'Hiba történt a lépések generálásakor' },
      { status: 500 }
    );
  }
}

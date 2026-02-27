import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/episodes/:id/steps/generate — idempotent episode_steps generation from care_pathway.
 * If steps already exist, returns existing. If not, generates from pathway's steps_json.
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

    const existing = await pool.query(
      `SELECT id, episode_id as "episodeId", step_code as "stepCode",
              pathway_order_index as "pathwayOrderIndex", pool, duration_minutes as "durationMinutes",
              default_days_offset as "defaultDaysOffset", status,
              appointment_id as "appointmentId", created_at as "createdAt",
              completed_at as "completedAt"
       FROM episode_steps WHERE episode_id = $1 ORDER BY pathway_order_index`,
      [episodeId]
    );

    if (existing.rows.length > 0) {
      return NextResponse.json({
        steps: existing.rows,
        generated: false,
        message: 'Lépések már léteznek',
      });
    }

    if (!ep.care_pathway_id) {
      return NextResponse.json(
        { error: 'Epizódhoz nincs hozzárendelve kezelési út (care_pathway). Először válasszon pathway-t.' },
        { status: 409 }
      );
    }

    const pathwayRow = await pool.query(
      `SELECT steps_json FROM care_pathways WHERE id = $1`,
      [ep.care_pathway_id]
    );
    if (pathwayRow.rows.length === 0 || !pathwayRow.rows[0].steps_json) {
      return NextResponse.json(
        { error: 'Kezelési út nem tartalmaz lépéseket' },
        { status: 400 }
      );
    }

    const stepsJson = pathwayRow.rows[0].steps_json as Array<{
      step_code: string;
      pool?: string;
      duration_minutes?: number;
      default_days_offset?: number;
    }>;

    if (!Array.isArray(stepsJson) || stepsJson.length === 0) {
      return NextResponse.json(
        { error: 'Kezelési út nem tartalmaz lépéseket' },
        { status: 400 }
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const raceCheck = await client.query(
        `SELECT 1 FROM episode_steps WHERE episode_id = $1 LIMIT 1`,
        [episodeId]
      );
      if (raceCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        const allSteps = await pool.query(
          `SELECT id, episode_id as "episodeId", step_code as "stepCode",
                  pathway_order_index as "pathwayOrderIndex", pool, duration_minutes as "durationMinutes",
                  default_days_offset as "defaultDaysOffset", status,
                  appointment_id as "appointmentId", created_at as "createdAt",
                  completed_at as "completedAt"
           FROM episode_steps WHERE episode_id = $1 ORDER BY pathway_order_index`,
          [episodeId]
        );
        return NextResponse.json({ steps: allSteps.rows, generated: false });
      }

      const insertValues: unknown[] = [];
      const insertPlaceholders: string[] = [];
      let idx = 1;

      for (let i = 0; i < stepsJson.length; i++) {
        const step = stepsJson[i];
        insertPlaceholders.push(
          `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5})`
        );
        insertValues.push(
          episodeId,
          step.step_code,
          i,
          step.pool ?? 'work',
          step.duration_minutes ?? 30,
          step.default_days_offset ?? 7
        );
        idx += 6;
      }

      const insertResult = await client.query(
        `INSERT INTO episode_steps (episode_id, step_code, pathway_order_index, pool, duration_minutes, default_days_offset)
         VALUES ${insertPlaceholders.join(', ')}
         RETURNING id, episode_id as "episodeId", step_code as "stepCode",
                   pathway_order_index as "pathwayOrderIndex", pool, duration_minutes as "durationMinutes",
                   default_days_offset as "defaultDaysOffset", status,
                   appointment_id as "appointmentId", created_at as "createdAt",
                   completed_at as "completedAt"`,
        insertValues
      );

      await client.query('COMMIT');

      return NextResponse.json({
        steps: insertResult.rows,
        generated: true,
        message: `${insertResult.rows.length} lépés generálva`,
      }, { status: 201 });
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

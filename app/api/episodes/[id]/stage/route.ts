import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { logActivity } from '@/lib/activity';
import { clearSuggestion } from '@/lib/stage-suggestion-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/episodes/:id/stage — explicit stage transition (CAS with stageVersion).
 * This is the ONLY way to change an episode's stage. Never automatic.
 * Body: { stageCode, note?, expectedStageVersion? }
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
    if (auth.role !== 'admin' && auth.role !== 'sebészorvos' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultsága a stádium módosításához' }, { status: 403 });
    }

    const episodeId = params.id;
    const body = await request.json();
    const stageCode = (body.stageCode as string)?.trim?.();
    const note = (body.note as string)?.trim?.() || null;
    const expectedStageVersion = body.expectedStageVersion as number | undefined;

    if (!stageCode) {
      return NextResponse.json({ error: 'stageCode kötelező' }, { status: 400 });
    }

    const pool = getDbPool();

    const epRow = await pool.query(
      `SELECT pe.id, pe.patient_id, pe.reason, pe.status, pe.stage_version
       FROM patient_episodes pe WHERE pe.id = $1`,
      [episodeId]
    );
    if (epRow.rows.length === 0) {
      return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
    }

    const ep = epRow.rows[0];
    if (ep.status !== 'open') {
      return NextResponse.json(
        { error: 'Csak aktív (open) epizódhoz lehet stádiumot módosítani' },
        { status: 400 }
      );
    }

    if (expectedStageVersion !== undefined && ep.stage_version !== expectedStageVersion) {
      return NextResponse.json(
        {
          error: 'Optimistic lock conflict: stageVersion mismatch',
          currentStageVersion: ep.stage_version,
          expectedStageVersion,
        },
        { status: 409 }
      );
    }

    const catalogCheck = await pool.query(
      `SELECT 1 FROM stage_catalog WHERE code = $1 AND reason = $2`,
      [stageCode, ep.reason]
    );
    if (catalogCheck.rows.length === 0) {
      return NextResponse.json(
        { error: `Érvénytelen stádium kód (${stageCode}) az adott etiológiához (${ep.reason})` },
        { status: 400 }
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const updateResult = await client.query(
        `UPDATE patient_episodes
         SET stage_version = stage_version + 1
         WHERE id = $1 AND stage_version = $2
         RETURNING stage_version`,
        [episodeId, ep.stage_version]
      );

      if (updateResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Optimistic lock conflict (concurrent update)' },
          { status: 409 }
        );
      }

      const newStageVersion = updateResult.rows[0].stage_version;

      const insertResult = await client.query(
        `INSERT INTO stage_events (patient_id, episode_id, stage_code, at, note, created_by)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5)
         RETURNING id, patient_id as "patientId", episode_id as "episodeId",
                   stage_code as "stageCode", at, note, created_by as "createdBy",
                   created_at as "createdAt"`,
        [ep.patient_id, episodeId, stageCode, note, auth.email]
      );

      await client.query('COMMIT');

      try {
        await clearSuggestion(episodeId);
      } catch (e) {
        console.error('Failed to clear suggestion after stage change:', e);
      }

      if (stageCode === 'STAGE_6') {
        try {
          const { ensureRecallTasksForEpisode } = await import('@/lib/recall-tasks');
          await ensureRecallTasksForEpisode(episodeId);
        } catch (e) {
          console.error('Failed to create recall tasks:', e);
        }
      }

      const row = insertResult.rows[0];

      await logActivity(
        request,
        auth.email,
        'patient_stage_changed',
        JSON.stringify({ episodeId, stageCode, stageVersion: newStageVersion })
      );

      return NextResponse.json({
        stageEvent: {
          id: row.id,
          patientId: row.patientId,
          episodeId: row.episodeId,
          stageCode: row.stageCode,
          at: (row.at as Date)?.toISOString?.() ?? String(row.at),
          note: row.note,
          createdBy: row.createdBy,
          createdAt: (row.createdAt as Date)?.toISOString?.() ?? null,
        },
        stageVersion: newStageVersion,
      }, { status: 201 });
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error in POST /episodes/:id/stage:', error);
    return NextResponse.json(
      { error: 'Hiba történt a stádium módosításakor' },
      { status: 500 }
    );
  }
}

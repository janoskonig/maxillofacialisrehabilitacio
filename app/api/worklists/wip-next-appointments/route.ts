import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { nextRequiredStep, isBlocked } from '@/lib/next-step-engine';

export const dynamic = 'force-dynamic';

/**
 * GET /api/worklists/wip-next-appointments
 * Returns WIP episodes with their next required step (from next-step engine or cache).
 * Uses episode_next_step_cache when available; falls back to next_required_step(episode).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const pool = getDbPool();

    // WIP episodes: status=open, stage in STAGE_1..STAGE_6 (not STAGE_0 or STAGE_7)
    const episodesResult = await pool.query(
      `SELECT DISTINCT pe.id as "episodeId", pe.patient_id as "patientId", pe.assigned_provider_id as "assignedProviderId"
       FROM patient_episodes pe
       LEFT JOIN (
         SELECT DISTINCT ON (episode_id) episode_id, stage_code
         FROM stage_events ORDER BY episode_id, at DESC
       ) se ON pe.id = se.episode_id
       WHERE pe.status = 'open'
       AND (se.stage_code IS NULL OR se.stage_code IN ('STAGE_1','STAGE_2','STAGE_3','STAGE_4','STAGE_5','STAGE_6'))
       ORDER BY pe.opened_at ASC`
    );

    const items: Array<{
      episodeId: string;
      patientId: string;
      currentStage: string;
      nextStep: string;
      overdueByDays: number;
      windowStart: string | null;
      windowEnd: string | null;
      durationMinutes: number;
      pool: string;
      priorityScore: number;
      noShowRisk: number;
      status?: 'ready' | 'blocked';
      blockedReason?: string;
    }> = [];

    for (const row of episodesResult.rows) {
      const result = await nextRequiredStep(row.episodeId);

      if (isBlocked(result)) {
        const stageRow = await pool.query(
          `SELECT stage_code FROM stage_events WHERE episode_id = $1 ORDER BY at DESC LIMIT 1`,
          [row.episodeId]
        );
        items.push({
          episodeId: row.episodeId,
          patientId: row.patientId,
          currentStage: stageRow.rows[0]?.stage_code ?? 'STAGE_0',
          nextStep: '-',
          overdueByDays: 0,
          windowStart: null,
          windowEnd: null,
          durationMinutes: 0,
          pool: 'work',
          priorityScore: 0,
          noShowRisk: 0,
          status: 'blocked',
          blockedReason: result.reason,
        });
        continue;
      }

      const now = new Date();
      const windowEnd = new Date(result.latest_date);
      const overdueByDays = windowEnd < now ? Math.ceil((now.getTime() - windowEnd.getTime()) / (24 * 60 * 60 * 1000)) : 0;

      const priorityScore = Math.min(100, 50 + overdueByDays * 5);

      const patientNoShowResult = await pool.query(
        `SELECT COUNT(*)::int as cnt FROM appointments a
         WHERE a.patient_id = $1 AND a.appointment_status = 'no_show'
         AND a.created_at > CURRENT_TIMESTAMP - INTERVAL '12 months'`,
        [row.patientId]
      );
      const noShowCount = patientNoShowResult.rows[0]?.cnt ?? 0;
      const noShowRisk = Math.min(0.95, 0.05 + noShowCount * 0.15);

      const stageResult = await pool.query(
        `SELECT stage_code FROM stage_events WHERE episode_id = $1 ORDER BY at DESC LIMIT 1`,
        [row.episodeId]
      );
      const currentStage = stageResult.rows[0]?.stage_code ?? 'STAGE_0';

      items.push({
        episodeId: row.episodeId,
        patientId: row.patientId,
        currentStage,
        nextStep: result.step_code,
        overdueByDays,
        windowStart: result.earliest_date.toISOString(),
        windowEnd: result.latest_date.toISOString(),
        durationMinutes: result.duration_minutes,
        pool: result.pool,
        priorityScore,
        noShowRisk,
      });
    }

    items.sort((a, b) => b.priorityScore - a.priorityScore);

    return NextResponse.json({ items });
  } catch (error) {
    console.error('Error fetching WIP worklist:', error);
    return NextResponse.json(
      { error: 'Hiba történt a munkalista lekérdezésekor' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

/**
 * Epizódok stádiumokkal (stage_events + patient_episodes, ha van; különben patient_stages).
 * GET /api/patients/[id]/stages/episodes
 */
export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;

  const patientCheck = await pool.query('SELECT id FROM patients WHERE id = $1', [patientId]);

  if (patientCheck.rows.length === 0) {
    return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
  }

  const hasStageEvents = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stage_events'`,
  );

  if (hasStageEvents.rows.length > 0) {
    const episodesResult = await pool.query(
      `SELECT 
        se.episode_id as "episodeId",
        MIN(se.at) as "startDate",
        MAX(se.at) as "endDate",
        COUNT(*)::int as "stageCount"
      FROM stage_events se
      WHERE se.patient_id = $1
      GROUP BY se.episode_id
      ORDER BY MIN(se.at) DESC`,
      [patientId],
    );

    // Egyetlen lekérdezés epizódonkénti N+1 helyett: minden stádium egyszerre,
    // majd memóriában csoportosítva episode_id szerint.
    const allStagesResult = await pool.query(
      `SELECT id, stage_code as "stageCode", at, note, episode_id as "episodeId"
       FROM stage_events
       WHERE patient_id = $1
       ORDER BY at ASC`,
      [patientId],
    );

    const stagesByEpisode = new Map<string, Array<Record<string, unknown>>>();
    for (const row of allStagesResult.rows) {
      const list = stagesByEpisode.get(row.episodeId) ?? [];
      list.push({
        id: row.id,
        stageCode: row.stageCode,
        stage: row.stageCode,
        stageDate: (row.at as Date).toISOString(),
        at: (row.at as Date).toISOString(),
        notes: row.note,
        note: row.note,
      });
      stagesByEpisode.set(row.episodeId, list);
    }

    const episodes = episodesResult.rows.map((episode) => ({
      episodeId: episode.episodeId,
      startDate: (episode.startDate as Date).toISOString(),
      endDate: (episode.endDate as Date)?.toISOString(),
      stageCount: episode.stageCount,
      stages: stagesByEpisode.get(episode.episodeId) ?? [],
    }));

    return NextResponse.json({ episodes });
  }

  const episodesResult = await pool.query(
    `SELECT 
      episode_id as "episodeId",
      MIN(stage_date) as "startDate",
      MAX(stage_date) as "endDate",
      COUNT(*) as "stageCount"
    FROM patient_stages
    WHERE patient_id = $1
    GROUP BY episode_id
    ORDER BY MIN(stage_date) DESC`,
    [patientId],
  );

  const allStagesResult = await pool.query(
    `SELECT id, stage, stage_date as "stageDate", notes, episode_id as "episodeId"
     FROM patient_stages
     WHERE patient_id = $1
     ORDER BY stage_date ASC`,
    [patientId],
  );

  const stagesByEpisode = new Map<string, Array<Record<string, unknown>>>();
  for (const row of allStagesResult.rows) {
    const list = stagesByEpisode.get(row.episodeId) ?? [];
    list.push({
      id: row.id,
      stage: row.stage,
      stageDate: row.stageDate.toISOString(),
      notes: row.notes,
    });
    stagesByEpisode.set(row.episodeId, list);
  }

  const episodes = episodesResult.rows.map((episode) => ({
    episodeId: episode.episodeId,
    startDate: episode.startDate.toISOString(),
    endDate: episode.endDate?.toISOString(),
    stageCount: parseInt(episode.stageCount, 10),
    stages: stagesByEpisode.get(episode.episodeId) ?? [],
  }));

  return NextResponse.json({ episodes });
});

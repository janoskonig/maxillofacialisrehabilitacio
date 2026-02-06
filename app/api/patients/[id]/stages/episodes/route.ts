import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

/**
 * Get all episodes for a patient
 * GET /api/patients/[id]/stages/episodes
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    const patientId = params.id;

    // Check if patient exists
    const patientCheck = await pool.query(
      'SELECT id FROM patients WHERE id = $1',
      [patientId]
    );

    if (patientCheck.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    // Get all episodes with their stages
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
      [patientId]
    );

    // Get stages for each episode
    const episodes = await Promise.all(
      episodesResult.rows.map(async (episode) => {
        const stagesResult = await pool.query(
          `SELECT 
            id,
            stage,
            stage_date as "stageDate",
            notes
          FROM patient_stages
          WHERE patient_id = $1 AND episode_id = $2
          ORDER BY stage_date ASC`,
          [patientId, episode.episodeId]
        );

        return {
          episodeId: episode.episodeId,
          startDate: episode.startDate.toISOString(),
          endDate: episode.endDate?.toISOString(),
          stageCount: parseInt(episode.stageCount),
          stages: stagesResult.rows.map((row) => ({
            id: row.id,
            stage: row.stage,
            stageDate: row.stageDate.toISOString(),
            notes: row.notes,
          })),
        };
      })
    );

    return NextResponse.json({ episodes });
  } catch (error) {
    console.error('Error fetching episodes:', error);
    return NextResponse.json(
      { error: 'Hiba történt az epizódok lekérdezésekor' },
      { status: 500 }
    );
  }
}

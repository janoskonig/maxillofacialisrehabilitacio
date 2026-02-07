import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { getCurrentEpisodeAndStage } from '@/lib/ohip14-stage';

/**
 * Get patient's current stage (patient portal).
 * Új modell: stage_events → stageCode + episodeId; régi: patient_current_stage → stage.
 * OHIP és egyéb portál logika a stageCode / stage alapján dönt.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const patientId = await verifyPatientPortalSession(request);

    if (!patientId) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    const { episodeId, stageCode, stage, useNewModel } = await getCurrentEpisodeAndStage(pool, patientId);

    if (!episodeId && !stage) {
      return NextResponse.json({
        currentStage: null,
      });
    }

    let stageDate: string | null = null;
    let notes: string | null = null;

    if (useNewModel && episodeId) {
      const row = await pool.query(
        `SELECT at, note FROM stage_events WHERE patient_id = $1 AND episode_id = $2 ORDER BY at DESC LIMIT 1`,
        [patientId, episodeId]
      );
      if (row.rows.length > 0) {
        stageDate = (row.rows[0].at as Date)?.toISOString?.() ?? null;
        notes = row.rows[0].note ?? null;
      }
    } else {
      const row = await pool.query(
        `SELECT stage_date as "stageDate", notes FROM patient_current_stage WHERE patient_id = $1`,
        [patientId]
      );
      if (row.rows.length > 0) {
        stageDate = (row.rows[0].stageDate as Date)?.toISOString?.() ?? null;
        notes = row.rows[0].notes ?? null;
      }
    }

    const currentStage = {
      patientId,
      episodeId,
      stage: stage ?? null,
      stageCode: stageCode ?? null,
      useNewModel,
      stageDate,
      notes,
    };

    return NextResponse.json({ currentStage });
  } catch (error) {
    console.error('Error fetching current stage:', error);
    return NextResponse.json(
      { error: 'Hiba történt a jelenlegi stádium lekérdezésekor' },
      { status: 500 }
    );
  }
}

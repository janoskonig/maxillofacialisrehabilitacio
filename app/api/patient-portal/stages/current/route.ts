import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';

/**
 * Get patient's current stage (patient portal)
 * GET /api/patient-portal/stages/current
 */
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

    // Get current stage
    const result = await pool.query(
      `SELECT 
        patient_id as "patientId",
        episode_id as "episodeId",
        stage,
        stage_date as "stageDate",
        notes
      FROM patient_current_stage
      WHERE patient_id = $1`,
      [patientId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({
        currentStage: null,
      });
    }

    const currentStage = {
      patientId: result.rows[0].patientId,
      episodeId: result.rows[0].episodeId,
      stage: result.rows[0].stage,
      stageDate: result.rows[0].stageDate?.toISOString(),
      notes: result.rows[0].notes,
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

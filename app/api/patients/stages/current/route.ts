import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

/**
 * Get current stages for all patients (for filtering)
 * GET /api/patients/stages/current
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    const searchParams = request.nextUrl.searchParams;
    const stage = searchParams.get('stage'); // Optional filter by stage

    let query = `
      SELECT 
        pcs.patient_id as "patientId",
        p.nev as "patientName",
        pcs.episode_id as "episodeId",
        pcs.stage,
        pcs.stage_date as "stageDate",
        pcs.notes
      FROM patient_current_stage pcs
      JOIN patients p ON p.id = pcs.patient_id
    `;

    const queryParams: string[] = [];

    if (stage) {
      query += ` WHERE pcs.stage = $1`;
      queryParams.push(stage);
    }

    query += ` ORDER BY pcs.stage_date DESC LIMIT 1000`;

    const result = await pool.query(query, queryParams);

    const currentStages = result.rows.map((row) => ({
      patientId: row.patientId,
      patientName: row.patientName,
      episodeId: row.episodeId,
      stage: row.stage,
      stageDate: row.stageDate.toISOString(),
      notes: row.notes,
    }));

    return NextResponse.json({ currentStages });
  } catch (error) {
    console.error('Error fetching current stages:', error);
    return NextResponse.json(
      { error: 'Hiba történt a jelenlegi stádiumok lekérdezésekor' },
      { status: 500 }
    );
  }
}

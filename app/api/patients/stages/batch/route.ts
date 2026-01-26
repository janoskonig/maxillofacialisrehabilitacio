import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

/**
 * Batch lekérdezés a stádiumokhoz beteg ID-k alapján
 * Optimalizálás: egyetlen lekérdezésben visszaadja az összes beteg jelenlegi stádiumát
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { patientIds } = body;

    if (!Array.isArray(patientIds) || patientIds.length === 0) {
      return NextResponse.json({ stages: {} }, { status: 200 });
    }

    const pool = getDbPool();

    // Lekérdezzük az összes beteg jelenlegi stádiumát a patient_current_stage view-ből
    const query = `
      SELECT 
        pcs.patient_id as "patientId",
        pcs.episode_id as "episodeId",
        pcs.stage,
        pcs.stage_date as "stageDate",
        pcs.notes
      FROM patient_current_stage pcs
      WHERE pcs.patient_id = ANY($1::uuid[])
    `;

    const result = await pool.query(query, [patientIds]);

    // Csoportosítás beteg ID szerint
    const stagesMap: Record<string, any> = {};

    result.rows.forEach((row: any) => {
      const patientId = row.patientId;
      stagesMap[patientId] = {
        stage: row.stage,
        stageDate: row.stageDate?.toISOString(),
        notes: row.notes,
        episodeId: row.episodeId,
      };
    });

    return NextResponse.json({ stages: stagesMap }, { status: 200 });
  } catch (error) {
    console.error('Error fetching batch stages:', error);
    return NextResponse.json(
      { error: 'Hiba történt a stádiumok lekérdezésekor' },
      { status: 500 }
    );
  }
}

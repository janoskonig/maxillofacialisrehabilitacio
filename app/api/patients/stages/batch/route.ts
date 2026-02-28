import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { logger } from '@/lib/logger';

/**
 * Batch lekérdezés a stádiumokhoz beteg ID-k alapján.
 * Új modell: stage_events + stage_catalog (stage_code + label_hu).
 * Régi modell: patient_current_stage (patient_stages).
 */
export const dynamic = 'force-dynamic';

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
    const stagesMap: Record<string, { stage: string; stageDate?: string; notes?: string; stageLabel?: string; episodeId?: string }> = {};

    const hasStageEvents = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stage_events'`
    );

    if (hasStageEvents.rows.length > 0) {
      const newModelQuery = `
        SELECT DISTINCT ON (se.patient_id)
          se.patient_id as "patientId",
          se.stage_code as "stageCode",
          se.at as "stageDate",
          se.note as "notes",
          se.episode_id as "episodeId",
          sc.label_hu as "stageLabel"
        FROM stage_events se
        JOIN patient_episodes e ON e.id = se.episode_id
        JOIN stage_catalog sc ON sc.code = se.stage_code AND sc.reason = e.reason
        WHERE se.patient_id = ANY($1::uuid[])
        ORDER BY se.patient_id, se.at DESC
      `;
      const newResult = await pool.query(newModelQuery, [patientIds]);
      newResult.rows.forEach((row: Record<string, unknown>) => {
        const patientId = row.patientId as string;
        stagesMap[patientId] = {
          stage: (row.stageCode as string) ?? '',
          stageDate: (row.stageDate as Date)?.toISOString?.() ?? undefined,
          notes: (row.notes as string) ?? undefined,
          stageLabel: (row.stageLabel as string) ?? undefined,
          episodeId: (row.episodeId as string) ?? undefined,
        };
      });
    }

    const missingIds = patientIds.filter((id: string) => !stagesMap[id]);
    if (missingIds.length > 0) {
      const legacyQuery = `
        SELECT 
          pcs.patient_id as "patientId",
          pcs.episode_id as "episodeId",
          pcs.stage,
          pcs.stage_date as "stageDate",
          pcs.notes
        FROM patient_current_stage pcs
        WHERE pcs.patient_id = ANY($1::uuid[])
      `;
      const legacyResult = await pool.query(legacyQuery, [missingIds]);
      legacyResult.rows.forEach((row: Record<string, unknown>) => {
        const patientId = row.patientId as string;
        if (!stagesMap[patientId]) {
          stagesMap[patientId] = {
            stage: (row.stage as string) ?? '',
            stageDate: (row.stageDate as Date)?.toISOString?.() ?? undefined,
            notes: (row.notes as string) ?? undefined,
            episodeId: (row.episodeId as string) ?? undefined,
          };
        }
      });
    }

    return NextResponse.json({ stages: stagesMap }, { status: 200 });
  } catch (error) {
    logger.error('Error fetching batch stages:', error);
    return NextResponse.json(
      { error: 'Hiba történt a stádiumok lekérdezésekor' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  const pool = getDbPool();
  const searchParams = req.nextUrl.searchParams;
  const stage = searchParams.get('stage');

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
});

import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { getFullStepQuery } from '@/lib/episode-step-select';

export const dynamic = 'force-dynamic';

/**
 * POST /api/episodes/:id/steps/from-tooth-treatment
 * Add a linked tooth treatment as a step in the episode's pathway.
 * Body: { toothTreatmentId: string }
 */
export const POST = roleHandler(['admin', 'sebészorvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const body = await req.json();
  const { toothTreatmentId } = body;

  if (!toothTreatmentId || typeof toothTreatmentId !== 'string') {
    return NextResponse.json({ error: 'toothTreatmentId kötelező' }, { status: 400 });
  }

  const pool = getDbPool();

  const epRow = await pool.query(
    `SELECT id, status FROM patient_episodes WHERE id = $1`,
    [episodeId]
  );
  if (epRow.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }
  if (epRow.rows[0].status !== 'open') {
    return NextResponse.json({ error: 'Csak aktív epizódhoz adható lépés' }, { status: 400 });
  }

  const ttRow = await pool.query(
    `SELECT tt.id, tt.episode_id, tt.treatment_code, tt.tooth_number, tt.status,
            ttc.label_hu as "labelHu"
     FROM tooth_treatments tt
     JOIN tooth_treatment_catalog ttc ON tt.treatment_code = ttc.code
     WHERE tt.id = $1`,
    [toothTreatmentId]
  );

  if (ttRow.rows.length === 0) {
    return NextResponse.json({ error: 'Fogkezelés nem található' }, { status: 404 });
  }

  const tt = ttRow.rows[0];

  if (tt.episode_id !== episodeId) {
    return NextResponse.json({ error: 'A fogkezelés nem ehhez az epizódhoz tartozik' }, { status: 400 });
  }
  if (tt.status !== 'episode_linked') {
    return NextResponse.json({ error: 'Csak epizódhoz kapcsolt fogkezelés adható a lépéssorhoz' }, { status: 400 });
  }

  const alreadyExists = await pool.query(
    `SELECT 1 FROM episode_steps WHERE episode_id = $1 AND tooth_treatment_id = $2`,
    [episodeId, toothTreatmentId]
  );
  if (alreadyExists.rows.length > 0) {
    return NextResponse.json({ error: 'Ez a fogkezelés már a lépéssorban van' }, { status: 409 });
  }

  const maxSeqRow = await pool.query(
    `SELECT COALESCE(MAX(seq), -1) as max_seq FROM episode_steps WHERE episode_id = $1`,
    [episodeId]
  );
  const nextSeq = (maxSeqRow.rows[0].max_seq ?? -1) + 1;

  const maxIdxRow = await pool.query(
    `SELECT COALESCE(MAX(pathway_order_index), -1) as max_idx FROM episode_steps WHERE episode_id = $1`,
    [episodeId]
  );
  const nextIdx = (maxIdxRow.rows[0].max_idx ?? -1) + 1;

  const stepCode = `tooth_${tt.treatment_code}`;
  const customLabel = `${tt.labelHu} – ${tt.tooth_number}`;

  await pool.query(
    `INSERT INTO episode_steps (episode_id, step_code, pathway_order_index, pool, duration_minutes, default_days_offset, seq, tooth_treatment_id, custom_label)
     VALUES ($1, $2, $3, 'work', 30, 7, $4, $5, $6)`,
    [episodeId, stepCode, nextIdx, nextSeq, toothTreatmentId, customLabel]
  );

  try {
    await emitSchedulingEvent('episode', episodeId, 'step_added');
  } catch { /* non-blocking */ }

  const allSteps = await getFullStepQuery(pool, episodeId);

  return NextResponse.json({ steps: allSteps.rows }, { status: 201 });
});

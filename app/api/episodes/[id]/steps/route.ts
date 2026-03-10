import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { logger } from '@/lib/logger';
import { getFullStepQuery } from '@/lib/episode-step-select';

export const dynamic = 'force-dynamic';

let _hasCustomLabel: boolean | null = null;
async function hasCustomLabelColumn(pool: ReturnType<typeof getDbPool>): Promise<boolean> {
  if (_hasCustomLabel !== null) return _hasCustomLabel;
  try {
    const colCheck = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'episode_steps' AND column_name = 'custom_label' LIMIT 1`
    );
    _hasCustomLabel = colCheck.rows.length > 0;
  } catch {
    _hasCustomLabel = false;
  }
  return _hasCustomLabel;
}

/**
 * POST /api/episodes/:id/steps — add an individual step (from catalog or ad-hoc).
 * Body: { stepCode?, pool?, durationMinutes?, defaultDaysOffset?, label? }
 */
export const POST = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const body = await req.json();
  const {
    stepCode: rawStepCode,
    pool: rawPool,
    durationMinutes: rawDuration,
    defaultDaysOffset: rawOffset,
    label,
  } = body;

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

  const validPools = ['consult', 'work', 'control'];
  const stepPool = typeof rawPool === 'string' && validPools.includes(rawPool) ? rawPool : 'work';
  const durationMinutes = typeof rawDuration === 'number' && rawDuration > 0 ? rawDuration : 30;
  const defaultDaysOffset = typeof rawOffset === 'number' && rawOffset >= 0 ? rawOffset : 7;

  let stepCode: string;
  let customLabel: string | null = null;

  if (typeof rawStepCode === 'string' && rawStepCode.trim().length > 0) {
    stepCode = rawStepCode.trim();
    const catalogRow = await pool.query(
      `SELECT step_code FROM step_catalog WHERE step_code = $1 AND is_active = true`,
      [stepCode]
    );
    if (catalogRow.rows.length === 0 && typeof label === 'string' && label.trim().length > 0) {
      customLabel = label.trim();
    }
  } else {
    const prefix = `adhoc_${Date.now().toString(36)}`;
    stepCode = prefix;
    if (typeof label === 'string' && label.trim().length > 0) {
      customLabel = label.trim();
    } else {
      return NextResponse.json({ error: 'Ad-hoc lépéshez label kötelező' }, { status: 400 });
    }
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

  const hasCol = await hasCustomLabelColumn(pool);
  if (hasCol) {
    await pool.query(
      `INSERT INTO episode_steps (episode_id, step_code, pathway_order_index, pool, duration_minutes, default_days_offset, seq, custom_label, source_episode_pathway_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
      [episodeId, stepCode, nextIdx, stepPool, durationMinutes, defaultDaysOffset, nextSeq, customLabel]
    );
  } else {
    await pool.query(
      `INSERT INTO episode_steps (episode_id, step_code, pathway_order_index, pool, duration_minutes, default_days_offset, seq, source_episode_pathway_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)`,
      [episodeId, stepCode, nextIdx, stepPool, durationMinutes, defaultDaysOffset, nextSeq]
    );
  }

  try {
    await emitSchedulingEvent('episode', episodeId, 'step_added');
  } catch { /* non-blocking */ }

  const allSteps = await getFullStepQuery(pool, episodeId);
  const addedStep = allSteps.rows[allSteps.rows.length - 1];

  return NextResponse.json({ step: addedStep }, { status: 201 });
});

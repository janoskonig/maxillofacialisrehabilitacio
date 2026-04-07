import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { getFullWorkPhaseQuery } from '@/lib/episode-work-phase-select';

export const dynamic = 'force-dynamic';

/**
 * POST /api/episodes/:id/work-phases — add a work phase (from catalog or ad-hoc).
 * Body: { workPhaseCode?, stepCode? (legacy), pool?, durationMinutes?, defaultDaysOffset?, label? }
 */
export const POST = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const body = await req.json();
  const {
    workPhaseCode: rawWp,
    stepCode: legacyCode,
    pool: rawPool,
    durationMinutes: rawDuration,
    defaultDaysOffset: rawOffset,
    label,
  } = body;

  const rawWorkPhaseCode = typeof rawWp === 'string' ? rawWp : typeof legacyCode === 'string' ? legacyCode : '';

  const pool = getDbPool();

  const epRow = await pool.query(`SELECT id, status FROM patient_episodes WHERE id = $1`, [episodeId]);
  if (epRow.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }
  if (epRow.rows[0].status !== 'open') {
    return NextResponse.json({ error: 'Csak aktív epizódhoz adható munkafázis' }, { status: 400 });
  }

  const validPools = ['consult', 'work', 'control'];
  const phasePool = typeof rawPool === 'string' && validPools.includes(rawPool) ? rawPool : 'work';
  const durationMinutes = typeof rawDuration === 'number' && rawDuration > 0 ? rawDuration : 30;
  const defaultDaysOffset = typeof rawOffset === 'number' && rawOffset >= 0 ? rawOffset : 7;

  let workPhaseCode: string;
  let customLabel: string | null = null;

  if (rawWorkPhaseCode.trim().length > 0) {
    workPhaseCode = rawWorkPhaseCode.trim();
    const catalogRow = await pool.query(
      `SELECT work_phase_code FROM work_phase_catalog WHERE work_phase_code = $1 AND is_active = true`,
      [workPhaseCode]
    );
    if (catalogRow.rows.length === 0 && typeof label === 'string' && label.trim().length > 0) {
      customLabel = label.trim();
    }
  } else {
    const prefix = `adhoc_${Date.now().toString(36)}`;
    workPhaseCode = prefix;
    if (typeof label === 'string' && label.trim().length > 0) {
      customLabel = label.trim();
    } else {
      return NextResponse.json({ error: 'Ad-hoc munkafázishoz label kötelező' }, { status: 400 });
    }
  }

  const maxSeqRow = await pool.query(
    `SELECT COALESCE(MAX(seq), -1) as max_seq FROM episode_work_phases WHERE episode_id = $1`,
    [episodeId]
  );
  const nextSeq = (maxSeqRow.rows[0].max_seq ?? -1) + 1;

  const maxIdxRow = await pool.query(
    `SELECT COALESCE(MAX(pathway_order_index), -1) as max_idx FROM episode_work_phases WHERE episode_id = $1`,
    [episodeId]
  );
  const nextIdx = (maxIdxRow.rows[0].max_idx ?? -1) + 1;

  await pool.query(
    `INSERT INTO episode_work_phases (episode_id, work_phase_code, pathway_order_index, pool, duration_minutes, default_days_offset, seq, custom_label, source_episode_pathway_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
    [episodeId, workPhaseCode, nextIdx, phasePool, durationMinutes, defaultDaysOffset, nextSeq, customLabel]
  );

  try {
    await emitSchedulingEvent('episode', episodeId, 'step_added');
  } catch {
    /* non-blocking */
  }

  const allPhases = await getFullWorkPhaseQuery(pool, episodeId);
  const added = allPhases.rows[allPhases.rows.length - 1];

  return NextResponse.json({ workPhase: added }, { status: 201 });
});

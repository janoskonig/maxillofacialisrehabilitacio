import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { emitSchedulingEvent } from '@/lib/scheduling-events';

export const dynamic = 'force-dynamic';

const STEP_SELECT_BASE = `id, episode_id as "episodeId", step_code as "stepCode",
  pathway_order_index as "pathwayOrderIndex", pool, duration_minutes as "durationMinutes",
  default_days_offset as "defaultDaysOffset", status,
  appointment_id as "appointmentId", created_at as "createdAt",
  completed_at as "completedAt", source_episode_pathway_id as "sourceEpisodePathwayId",
  seq`;

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
 * - If stepCode exists in step_catalog, uses catalog metadata.
 * - If stepCode is absent or not in catalog, creates an ad-hoc step with custom_label = label.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const allowedRoles = ['admin', 'sebészorvos', 'fogpótlástanász'];
    if (!allowedRoles.includes(auth.role ?? '')) {
      return NextResponse.json({ error: 'Nincs jogosultsága' }, { status: 403 });
    }

    const episodeId = params.id;
    const body = await request.json();
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
    const stepSelect = hasCol ? STEP_SELECT_BASE + `, custom_label as "customLabel"` : STEP_SELECT_BASE;
    const result = hasCol
      ? await pool.query(
          `INSERT INTO episode_steps (episode_id, step_code, pathway_order_index, pool, duration_minutes, default_days_offset, seq, custom_label, source_episode_pathway_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
           RETURNING ${stepSelect}`,
          [episodeId, stepCode, nextIdx, stepPool, durationMinutes, defaultDaysOffset, nextSeq, customLabel]
        )
      : await pool.query(
          `INSERT INTO episode_steps (episode_id, step_code, pathway_order_index, pool, duration_minutes, default_days_offset, seq, source_episode_pathway_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
           RETURNING ${stepSelect}`,
          [episodeId, stepCode, nextIdx, stepPool, durationMinutes, defaultDaysOffset, nextSeq]
        );

    try {
      await emitSchedulingEvent('episode', episodeId, 'step_added');
    } catch { /* non-blocking */ }

    return NextResponse.json({ step: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error('Error in POST /episodes/:id/steps:', error);
    return NextResponse.json(
      { error: 'Hiba történt a lépés hozzáadásakor' },
      { status: 500 }
    );
  }
}

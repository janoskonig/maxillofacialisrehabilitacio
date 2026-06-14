import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { getMergedFilterFragment } from '@/lib/schema-probe';
import {
  validateTreatmentPlan,
  isPlanApprovable,
  type PlanStepInput,
} from '@/lib/treatment-plan-validation';
import { emitSchedulingEvent } from '@/lib/scheduling-events';

export const dynamic = 'force-dynamic';

const WRITE_ROLES = ['admin', 'beutalo_orvos', 'fogpótlástanász'] as const;

/** Load the episode's work phases (merged children excluded) in scheduling order. */
async function loadPlanSteps(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string
): Promise<PlanStepInput[]> {
  const mergedFilter = await getMergedFilterFragment(pool, 'episode_work_phases');
  const r = await pool.query(
    `SELECT work_phase_code, pool, duration_minutes, status, custom_label
     FROM episode_work_phases ewp
     WHERE ewp.episode_id = $1 ${mergedFilter}
     ORDER BY COALESCE(seq, pathway_order_index), pathway_order_index`,
    [episodeId]
  );
  return r.rows.map((row: Record<string, unknown>) => ({
    workPhaseCode: String(row.work_phase_code),
    pool: (row.pool as string | null) ?? null,
    durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
    status: String(row.status),
    label: (row.custom_label as string | null) ?? null,
  }));
}

async function getApproval(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string
): Promise<{ approvedAt: string | null; approvedBy: string | null } | null> {
  const r = await pool.query(
    `SELECT plan_approved_at, plan_approved_by FROM patient_episodes WHERE id = $1`,
    [episodeId]
  );
  if (r.rows.length === 0) return null;
  return {
    approvedAt: r.rows[0].plan_approved_at ? new Date(r.rows[0].plan_approved_at).toISOString() : null,
    approvedBy: r.rows[0].plan_approved_by ?? null,
  };
}

/**
 * GET /api/episodes/:id/plan-validation
 * → { issues, approvable, approvedAt, approvedBy }
 */
export const GET = roleHandler([...WRITE_ROLES], async (_req, { params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  const approval = await getApproval(pool, episodeId);
  if (!approval) return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });

  const steps = await loadPlanSteps(pool, episodeId);
  const issues = validateTreatmentPlan(steps);

  return NextResponse.json({
    issues,
    approvable: isPlanApprovable(issues),
    approvedAt: approval.approvedAt,
    approvedBy: approval.approvedBy,
  });
});

/**
 * POST /api/episodes/:id/plan-validation — approve the plan ("ready to book").
 * Re-validates server-side; refuses if any error-level issue remains.
 */
export const POST = roleHandler([...WRITE_ROLES], async (_req, { auth, params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  const epRow = await pool.query(`SELECT status FROM patient_episodes WHERE id = $1`, [episodeId]);
  if (epRow.rows.length === 0) return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });

  const steps = await loadPlanSteps(pool, episodeId);
  const issues = validateTreatmentPlan(steps);
  if (!isPlanApprovable(issues)) {
    return NextResponse.json(
      { error: 'A terv hibákat tartalmaz, nem hagyható jóvá', issues },
      { status: 409 }
    );
  }

  await pool.query(
    `UPDATE patient_episodes SET plan_approved_at = NOW(), plan_approved_by = $2 WHERE id = $1`,
    [episodeId, auth.userId]
  );
  await emitSchedulingEvent('episode', episodeId, 'plan_approved').catch(() => {});

  const approval = await getApproval(pool, episodeId);
  return NextResponse.json({ ok: true, issues, approvable: true, ...approval });
});

/**
 * DELETE /api/episodes/:id/plan-validation — revoke approval (plan edited again).
 */
export const DELETE = roleHandler([...WRITE_ROLES], async (_req, { params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  const epRow = await pool.query(`SELECT status FROM patient_episodes WHERE id = $1`, [episodeId]);
  if (epRow.rows.length === 0) return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });

  await pool.query(
    `UPDATE patient_episodes SET plan_approved_at = NULL, plan_approved_by = NULL WHERE id = $1`,
    [episodeId]
  );
  return NextResponse.json({ ok: true });
});

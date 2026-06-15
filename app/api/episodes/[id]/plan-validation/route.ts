import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { getMergedFilterFragment } from '@/lib/schema-probe';
import {
  validateTreatmentPlan,
  isPlanApprovable,
  type PlanStepInput,
} from '@/lib/treatment-plan-validation';
import { detectSequenceViolations, type SequenceStepInput } from '@/lib/plan-sequence-check';
import { sqlBookedFutureAppointmentsWithEffectiveStep } from '@/lib/episode-plan-read-model';
import { emitSchedulingEvent } from '@/lib/scheduling-events';

export const dynamic = 'force-dynamic';

const WRITE_ROLES = ['admin', 'beutalo_orvos', 'fogpótlástanász'] as const;

/** Load the episode's work phases (merged children excluded) in scheduling order. */
async function loadPlanSteps(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string
): Promise<PlanStepInput[]> {
  // Az alias a lenti query-ben `ewp` — a fragmentnek is ezt kell hivatkoznia,
  // különben `42P01 invalid reference to FROM-clause entry for table
  // "episode_work_phases"` (a teljes táblanév aliasolás után nem hivatkozható).
  const mergedFilter = await getMergedFilterFragment(pool, 'ewp');
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

/** Earliest future booked start per work_phase_code for the episode. */
async function loadBookedStarts(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const res = await pool.query(sqlBookedFutureAppointmentsWithEffectiveStep(), [[episodeId]]);
    for (const row of res.rows as Array<{ step_code: string | null; effective_start: Date | string }>) {
      if (!row.step_code) continue;
      const iso = new Date(row.effective_start).toISOString();
      const existing = map.get(row.step_code);
      if (!existing || iso < existing) map.set(row.step_code, iso);
    }
  } catch {
    /* tolerate — sequence check is advisory */
  }
  return map;
}

/**
 * GET /api/episodes/:id/plan-validation
 * → { issues, approvable, approvedAt, approvedBy, sequenceViolations }
 *
 * `sequenceViolations` (Gap A): a már LEFOGLALT időpontok, amelyek a terv
 * sorrendje elé csúsztak (pl. egy korábbi fázis sikertelenség miatt
 * visszanyílt). A rendszer ezeket nem mozgatja némán — jelzi, hogy újrafoglalás
 * kell.
 */
export const GET = roleHandler([...WRITE_ROLES], async (_req, { params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  const approval = await getApproval(pool, episodeId);
  if (!approval) return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });

  const [steps, bookedStarts] = await Promise.all([
    loadPlanSteps(pool, episodeId),
    loadBookedStarts(pool, episodeId),
  ]);
  const issues = validateTreatmentPlan(steps);

  // steps already ordered by COALESCE(seq, pathway_order_index) → array index = plan order.
  const sequenceSteps: SequenceStepInput[] = steps.map((s, idx) => ({
    workPhaseCode: s.workPhaseCode,
    label: s.label,
    orderIndex: idx,
    status: s.status,
    bookedStart: bookedStarts.get(s.workPhaseCode) ?? null,
  }));
  const sequenceViolations = detectSequenceViolations(sequenceSteps);

  return NextResponse.json({
    issues,
    approvable: isPlanApprovable(issues),
    approvedAt: approval.approvedAt,
    approvedBy: approval.approvedBy,
    sequenceViolations,
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

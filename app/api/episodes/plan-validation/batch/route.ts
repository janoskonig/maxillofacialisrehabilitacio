import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { getMergedFilterFragment } from '@/lib/schema-probe';
import {
  validateTreatmentPlan,
  summarizePlanReadiness,
  type PlanStepInput,
  type PlanReadinessStatus,
} from '@/lib/treatment-plan-validation';
import { detectSequenceViolations, type SequenceStepInput } from '@/lib/plan-sequence-check';
import { sqlBookedFutureAppointmentsWithEffectiveStep } from '@/lib/episode-plan-read-model';

export const dynamic = 'force-dynamic';

const MAX_EPISODES = 200;

interface BatchEntry {
  status: PlanReadinessStatus;
  errorCount: number;
  warningCount: number;
  approved: boolean;
  /** Gap A: hány lefoglalt időpont csúszott a terv sorrendje elé (újrafoglalandó). */
  sequenceViolations: number;
}

/**
 * POST /api/episodes/plan-validation/batch
 * Body: { episodeIds: string[] }
 * → { [episodeId]: { status, errorCount, warningCount, approved } }
 *
 * Powers the plan-readiness badges on the Gantt and worklist (WP6a) — one round-trip
 * for many episodes instead of per-row calls to /api/episodes/:id/plan-validation.
 */
export const POST = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req) => {
  const body = await req.json().catch(() => ({}));
  const rawIds: unknown[] = Array.isArray(body?.episodeIds) ? body.episodeIds : [];
  const episodeIds: string[] = Array.from(
    new Set(rawIds.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0))
  ).slice(0, MAX_EPISODES);

  if (episodeIds.length === 0) return NextResponse.json({});

  const pool = getDbPool();
  const mergedFilter = await getMergedFilterFragment(pool, 'episode_work_phases');

  const [stepRows, approvalRows, bookedRows] = await Promise.all([
    pool.query(
      `SELECT episode_id, work_phase_code, pool, duration_minutes, status, custom_label
       FROM episode_work_phases ewp
       WHERE episode_id = ANY($1) ${mergedFilter}
       ORDER BY episode_id, COALESCE(seq, pathway_order_index), pathway_order_index`,
      [episodeIds]
    ),
    pool.query(`SELECT id, plan_approved_at FROM patient_episodes WHERE id = ANY($1)`, [episodeIds]),
    pool
      .query(sqlBookedFutureAppointmentsWithEffectiveStep(), [episodeIds])
      .catch(() => ({ rows: [] as Array<Record<string, unknown>> })),
  ]);

  const stepsByEpisode = new Map<string, PlanStepInput[]>();
  for (const row of stepRows.rows as Record<string, unknown>[]) {
    const epId = String(row.episode_id);
    const list = stepsByEpisode.get(epId) ?? [];
    list.push({
      workPhaseCode: String(row.work_phase_code),
      pool: (row.pool as string | null) ?? null,
      durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
      status: String(row.status),
      label: (row.custom_label as string | null) ?? null,
    });
    stepsByEpisode.set(epId, list);
  }

  const approvedByEpisode = new Map<string, boolean>();
  for (const row of approvalRows.rows as Record<string, unknown>[]) {
    approvedByEpisode.set(String(row.id), row.plan_approved_at != null);
  }

  // Earliest future booked start per (episode, work_phase_code).
  const bookedByEpisode = new Map<string, Map<string, string>>();
  for (const row of bookedRows.rows as Array<Record<string, unknown>>) {
    const epId = row.episode_id != null ? String(row.episode_id) : null;
    const code = row.step_code != null ? String(row.step_code) : null;
    if (!epId || !code || row.effective_start == null) continue;
    const iso = new Date(row.effective_start as string).toISOString();
    const m = bookedByEpisode.get(epId) ?? new Map<string, string>();
    const existing = m.get(code);
    if (!existing || iso < existing) m.set(code, iso);
    bookedByEpisode.set(epId, m);
  }

  const result: Record<string, BatchEntry> = {};
  for (const id of episodeIds) {
    const steps = stepsByEpisode.get(id) ?? [];
    const issues = validateTreatmentPlan(steps);
    const approved = approvedByEpisode.get(id) ?? false;

    // Gap A: out-of-sequence booked appointments (steps already in plan order).
    const booked = bookedByEpisode.get(id);
    const sequenceSteps: SequenceStepInput[] = steps.map((s, idx) => ({
      workPhaseCode: s.workPhaseCode,
      label: s.label,
      orderIndex: idx,
      status: s.status,
      bookedStart: booked?.get(s.workPhaseCode) ?? null,
    }));
    const sequenceViolations = detectSequenceViolations(sequenceSteps).length;

    result[id] = {
      status: summarizePlanReadiness(issues, approved),
      errorCount: issues.filter((i) => i.level === 'error').length,
      warningCount: issues.filter((i) => i.level === 'warning').length,
      approved,
      sequenceViolations,
    };
  }

  return NextResponse.json(result);
});

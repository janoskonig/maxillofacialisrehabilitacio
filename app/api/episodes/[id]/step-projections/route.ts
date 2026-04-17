import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { allPendingSteps, isBlockedAll } from '@/lib/next-step-engine';

export const dynamic = 'force-dynamic';

export interface ProjectedStep {
  stepCode: string;
  label: string;
  seq: number;
  pool: string;
  durationMinutes: number;
  status: 'completed' | 'scheduled' | 'pending' | 'skipped';
  actualDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  waitFromNowDays: number | null;
  customLabel?: string | null;
  /** Human-readable labels of steps merged into this primary row (same appointment). */
  mergedPartLabels?: string[];
}

export interface StepProjectionsResponse {
  steps: ProjectedStep[];
  summary: {
    completedCount: number;
    remainingCount: number;
    estimatedCompletionEarliest: string | null;
    estimatedCompletionLatest: string | null;
    nextStepWaitDays: number | null;
  };
  blocked?: boolean;
  blockedReason?: string;
}

/**
 * GET /api/episodes/:id/step-projections
 * Returns all steps (completed + pending) with projected scheduling windows.
 */
export const GET = authedHandler(async (req, { auth, params }) => {
  const episodeId = params.id;
  const pool = getDbPool();
  const now = new Date();

  const epCheck = await pool.query(
    `SELECT id, status FROM patient_episodes WHERE id = $1`,
    [episodeId]
  );
  if (epCheck.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }

  let mergedFilter = '';
  try {
    const epCols = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'episode_work_phases' AND column_name = 'merged_into_episode_work_phase_id'`
    );
    if (epCols.rows.length > 0) {
      mergedFilter = 'AND ewp.merged_into_episode_work_phase_id IS NULL';
    }
  } catch {
    /* ignore */
  }

  const episodeStepsResult = await pool.query(
    `SELECT ewp.id as ewp_id, ewp.work_phase_code, ewp.seq, ewp.pathway_order_index, ewp.pool,
            ewp.duration_minutes, ewp.status, ewp.completed_at, ewp.custom_label,
            sc.label_hu,
            a.start_time as appointment_start
     FROM episode_work_phases ewp
     LEFT JOIN work_phase_catalog sc ON ewp.work_phase_code = sc.work_phase_code AND sc.is_active = true
     LEFT JOIN appointments a ON ewp.appointment_id = a.id
     WHERE ewp.episode_id = $1 ${mergedFilter}
     ORDER BY COALESCE(ewp.seq, ewp.pathway_order_index)`,
    [episodeId]
  );

  type MergedAgg = { labels: string[] };
  const mergedByPrimary = new Map<string, MergedAgg>();
  if (mergedFilter) {
    const mergedRows = await pool.query(
      `SELECT c.merged_into_episode_work_phase_id as primary_id,
              c.work_phase_code, c.custom_label, sc.label_hu,
              ttc.label_hu as treatment_label_hu
       FROM episode_work_phases c
       LEFT JOIN work_phase_catalog sc ON c.work_phase_code = sc.work_phase_code AND sc.is_active = true
       LEFT JOIN tooth_treatments tt ON c.tooth_treatment_id = tt.id
       LEFT JOIN tooth_treatment_catalog ttc ON tt.treatment_code = ttc.code
       WHERE c.episode_id = $1 AND c.merged_into_episode_work_phase_id IS NOT NULL`,
      [episodeId]
    );
    for (const m of mergedRows.rows as Array<{
      primary_id: string;
      work_phase_code: string;
      custom_label: string | null;
      label_hu: string | null;
      treatment_label_hu: string | null;
    }>) {
      const label =
        m.custom_label
        || m.treatment_label_hu
        || m.label_hu
        || String(m.work_phase_code).replace(/_/g, ' ');
      const agg = mergedByPrimary.get(m.primary_id) ?? { labels: [] };
      agg.labels.push(label);
      mergedByPrimary.set(m.primary_id, agg);
    }
  }

  const pendingResult = await allPendingSteps(episodeId);

  if (isBlockedAll(pendingResult)) {
    return NextResponse.json({
      steps: [],
      summary: {
        completedCount: 0,
        remainingCount: 0,
        estimatedCompletionEarliest: null,
        estimatedCompletionLatest: null,
        nextStepWaitDays: null,
      },
      blocked: true,
      blockedReason: pendingResult.reason,
    } satisfies StepProjectionsResponse);
  }

  const steps: ProjectedStep[] = [];
  let completedCount = 0;
  let remainingCount = 0;
  let firstPendingWaitDays: number | null = null;
  let lastWindowStart: string | null = null;
  let lastWindowEnd: string | null = null;

  if (episodeStepsResult.rows.length > 0) {
    let pendingProjectionIdx = 0;
    for (const row of episodeStepsResult.rows) {
      const status = row.status as 'completed' | 'scheduled' | 'pending' | 'skipped';
      const label = row.custom_label || row.label_hu || row.work_phase_code.replace(/_/g, ' ');
      let projection: (typeof pendingResult)[number] | null = null;
      if (status === 'pending' || status === 'scheduled') {
        projection = pendingResult[pendingProjectionIdx] ?? null;
        pendingProjectionIdx += 1;
      }

      let actualDate: string | null = null;
      let windowStart: string | null = null;
      let windowEnd: string | null = null;
      let waitFromNowDays: number | null = null;

      if (status === 'completed') {
        actualDate = row.completed_at?.toISOString() ?? row.appointment_start?.toISOString() ?? null;
        completedCount++;
      } else if (status === 'scheduled') {
        actualDate = row.appointment_start?.toISOString() ?? null;
        if (actualDate) {
          const apptDate = new Date(actualDate);
          waitFromNowDays = Math.max(0, Math.ceil((apptDate.getTime() - now.getTime()) / 86400000));
        }
        remainingCount++;
      } else if (status === 'pending') {
        if (projection) {
          windowStart = projection.earliest_date.toISOString();
          windowEnd = projection.latest_date.toISOString();
          waitFromNowDays = Math.max(0, Math.ceil((projection.earliest_date.getTime() - now.getTime()) / 86400000));
          lastWindowStart = windowStart;
          lastWindowEnd = windowEnd;
        }
        remainingCount++;
      } else if (status === 'skipped') {
        // skipped steps don't affect timeline
      }

      if ((status === 'pending' || status === 'scheduled') && firstPendingWaitDays === null) {
        firstPendingWaitDays = waitFromNowDays;
      }

      const primaryId = row.ewp_id != null ? String(row.ewp_id) : '';
      const mergedAgg = primaryId ? mergedByPrimary.get(primaryId) : undefined;
      const durationMinutes = Number(row.duration_minutes) > 0 ? Number(row.duration_minutes) : 30;

      const stepPayload: ProjectedStep = {
        stepCode: row.work_phase_code,
        label,
        seq: row.seq ?? row.pathway_order_index,
        pool: row.pool,
        durationMinutes,
        status,
        actualDate,
        windowStart,
        windowEnd,
        waitFromNowDays,
        customLabel: row.custom_label,
      };
      if (mergedAgg && mergedAgg.labels.length > 0) {
        stepPayload.mergedPartLabels = mergedAgg.labels;
      }
      steps.push(stepPayload);
    }
  } else {
    for (const p of pendingResult) {
      const windowStart = p.earliest_date.toISOString();
      const windowEnd = p.latest_date.toISOString();
      const waitFromNowDays = Math.max(0, Math.ceil((p.earliest_date.getTime() - now.getTime()) / 86400000));

      if (firstPendingWaitDays === null) firstPendingWaitDays = waitFromNowDays;
      lastWindowStart = windowStart;
      lastWindowEnd = windowEnd;
      remainingCount++;

      steps.push({
        stepCode: p.work_phase_code,
        label: p.label ?? p.work_phase_code.replace(/_/g, ' '),
        seq: p.stepSeq,
        pool: p.pool,
        durationMinutes: p.duration_minutes,
        status: 'pending',
        actualDate: null,
        windowStart,
        windowEnd,
        waitFromNowDays,
      });
    }
  }

  const response: StepProjectionsResponse = {
    steps,
    summary: {
      completedCount,
      remainingCount,
      estimatedCompletionEarliest: lastWindowStart,
      estimatedCompletionLatest: lastWindowEnd,
      nextStepWaitDays: firstPendingWaitDays,
    },
  };

  return NextResponse.json(response);
});

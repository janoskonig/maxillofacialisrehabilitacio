import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { allPendingSteps, isBlockedAll } from '@/lib/next-step-engine';
import { handleApiError } from '@/lib/api-error-handler';

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
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

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

    // Fetch completed/skipped/scheduled steps from episode_steps
    const episodeStepsResult = await pool.query(
      `SELECT es.step_code, es.seq, es.pathway_order_index, es.pool,
              es.duration_minutes, es.status, es.completed_at, es.custom_label,
              sc.label_hu,
              a.start_time as appointment_start
       FROM episode_steps es
       LEFT JOIN step_catalog sc ON es.step_code = sc.step_code AND sc.is_active = true
       LEFT JOIN appointments a ON es.appointment_id = a.id
       WHERE es.episode_id = $1
       ORDER BY COALESCE(es.seq, es.pathway_order_index)`,
      [episodeId]
    );

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

    const pendingByCode = new Map<string, (typeof pendingResult)[number]>();
    for (const p of pendingResult) {
      pendingByCode.set(p.step_code, p);
    }

    const steps: ProjectedStep[] = [];
    let completedCount = 0;
    let remainingCount = 0;
    let firstPendingWaitDays: number | null = null;
    let lastWindowStart: string | null = null;
    let lastWindowEnd: string | null = null;

    if (episodeStepsResult.rows.length > 0) {
      // Use episode_steps as source of truth
      for (const row of episodeStepsResult.rows) {
        const status = row.status as 'completed' | 'scheduled' | 'pending' | 'skipped';
        const label = row.custom_label || row.label_hu || row.step_code.replace(/_/g, ' ');
        const projection = pendingByCode.get(row.step_code);

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

        steps.push({
          stepCode: row.step_code,
          label,
          seq: row.seq ?? row.pathway_order_index,
          pool: row.pool,
          durationMinutes: row.duration_minutes,
          status,
          actualDate,
          windowStart,
          windowEnd,
          waitFromNowDays,
          customLabel: row.custom_label,
        });
      }
    } else {
      // No episode_steps: build from pending projections only
      for (const p of pendingResult) {
        const windowStart = p.earliest_date.toISOString();
        const windowEnd = p.latest_date.toISOString();
        const waitFromNowDays = Math.max(0, Math.ceil((p.earliest_date.getTime() - now.getTime()) / 86400000));

        if (firstPendingWaitDays === null) firstPendingWaitDays = waitFromNowDays;
        lastWindowStart = windowStart;
        lastWindowEnd = windowEnd;
        remainingCount++;

        steps.push({
          stepCode: p.step_code,
          label: p.label ?? p.step_code.replace(/_/g, ' '),
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
  } catch (error) {
    return handleApiError(error, 'Hiba történt a lépés-projekciók lekérdezésekor');
  }
}

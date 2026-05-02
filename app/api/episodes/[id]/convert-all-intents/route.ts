import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { convertIntentToAppointment } from '@/lib/convert-slot-intent';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';
import { getPathwayWorkPhasesForEpisode } from '@/lib/pathway-work-phases-for-episode';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_PATHWAY_GAP_DAYS = 14;

/**
 * POST /api/episodes/:id/convert-all-intents
 * Convert all open slot_intents for the episode to appointments (batch).
 * If no open intents exist, runs slot-intent projection first so pending pathway steps get intents.
 * Does not run one-hard-next check so multiple future work appointments can be created.
 *
 * Chain-anchor semantics (W: bulk-convert robustness):
 *
 *   minimumStartTime = previousScheduledSlot.start + pathwayMinGap
 *
 * The previous implementation derived chainMinStartTime from the delta between
 * two PROJECTOR-generated suggested_start values. That worked when the
 * projector chain matched reality, but accumulated artificial drift whenever
 * an earlier already-booked phase had pushed `lastHardAnchor` forward — every
 * new intent's `suggested_start` was then computed off that future anchor,
 * yielding a delta that bore no relation to the actual pathway gap. The
 * symptom: bulk-convert refused to use a free May slot for Anatómiai lenyomat
 * because the projector said its "ideal" date was September.
 *
 * The new rule mirrors the user's explicit prescription:
 *
 *   nextMinimumStartTime = previousScheduledSlot.start + pathwayMinGap
 *                        // NOT previousIdealStartTime + pathwayMinGap
 *
 * `pathwayMinGap` precedence (matches worklist + projector exactly so the UI
 * "Ablak (terv szerint)" oszlop and the bulk-convert booking agree on what
 * counts as the minimum spacing):
 *
 *   1. episode_work_phases.default_days_offset  (per-step override on a
 *      specific patient's episode — what the operator edits when they want a
 *      longer/shorter gap on THIS treatment without touching the template)
 *   2. care_pathways.work_phases_json.default_days_offset  (sablon-szintű
 *      default; admin > Kezelési útvonalak)
 *   3. DEFAULT_PATHWAY_GAP_DAYS  (hard fallback when neither source supplies
 *      a value)
 *
 * The first intent in the batch has no previous scheduled slot, so its only
 * floor is `now` (handled inside convertIntentToAppointment when
 * chainMinStartTime is undefined).
 *
 * Response: { converted, appointmentIds, skipped: Array<{ intentId, reason }> }
 */
export const POST = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  // Always run the projector so expired/stale intents are re-opened and new steps get intents.
  // The projector is idempotent (UPSERT) and skips converted/cancelled intents.
  await projectRemainingSteps(episodeId);

  // The episode-level per-step override (`episode_work_phases.default_days_offset`)
  // is OPTIONAL on legacy DBs — probe information_schema once and degrade gracefully
  // when the column is missing. The LEFT JOIN is also the canonical place to read
  // any future episode-level overrides without re-shaping callers.
  let ewpOffsetSelect = ', NULL::int AS episode_offset';
  let ewpJoinSql = '';
  try {
    const colCheck = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'episode_work_phases'
         AND column_name = 'default_days_offset'
       LIMIT 1`
    );
    if (colCheck.rows.length > 0) {
      ewpOffsetSelect = ', ewp.default_days_offset AS episode_offset';
      ewpJoinSql =
        `LEFT JOIN episode_work_phases ewp
            ON ewp.episode_id = si.episode_id
           AND ewp.work_phase_code = si.step_code`;
    }
  } catch {
    /* tolerate missing information_schema access — fall back to template only */
  }

  const [intentsResult, pathwayPhases] = await Promise.all([
    pool.query(
      `SELECT si.id, si.step_code${ewpOffsetSelect}
       FROM slot_intents si
       ${ewpJoinSql}
       WHERE si.episode_id = $1 AND si.state = 'open'
       ORDER BY si.step_seq ASC`,
      [episodeId]
    ),
    getPathwayWorkPhasesForEpisode(pool, episodeId),
  ]);

  const intents = intentsResult.rows as Array<{
    id: string;
    step_code?: string;
    /**
     * Per-step override read from `episode_work_phases.default_days_offset`.
     * NULL if either the column does not exist (legacy DB) or no episode-scoped
     * override was set for this step. We mirror the precedence used by the
     * worklist (`lib/next-step-engine.ts`) and the projector
     * (`lib/slot-intent-projector.ts`): episode override wins, then the
     * pathway template, then a hard 14-day default.
     */
    episode_offset?: number | null;
  }>;

  if (intents.length === 0) {
    return NextResponse.json(
      { converted: 0, appointmentIds: [], skipped: [] },
      { status: 200 }
    );
  }

  // pathwayMinGap (days) per step_code. Falls back to DEFAULT_PATHWAY_GAP_DAYS
  // when the pathway template lacks an entry for the step (legacy data drift).
  const gapByStep = new Map<string, number>();
  if (pathwayPhases) {
    for (const ph of pathwayPhases) {
      if (typeof ph.default_days_offset === 'number' && ph.default_days_offset >= 0) {
        gapByStep.set(ph.work_phase_code, ph.default_days_offset);
      }
    }
  }

  const appointmentIds: string[] = [];
  const skipped: Array<{ intentId: string; reason: string; code?: string; stepCode?: string }> = [];

  let prevActualStart: Date | null = null;

  for (const row of intents) {
    let chainMinStartTime: Date | undefined;
    if (prevActualStart) {
      const stepCode = row.step_code ?? '';
      // Precedence (mirror of worklist + projector):
      //   1. episode_work_phases.default_days_offset (per-step override)
      //   2. pathway template default_days_offset (sablon-szintű)
      //   3. DEFAULT_PATHWAY_GAP_DAYS hard fallback
      const episodeOverrideDays =
        typeof row.episode_offset === 'number' && row.episode_offset >= 0
          ? row.episode_offset
          : null;
      const gapDays =
        episodeOverrideDays
        ?? gapByStep.get(stepCode)
        ?? DEFAULT_PATHWAY_GAP_DAYS;
      chainMinStartTime = new Date(prevActualStart.getTime() + gapDays * MS_PER_DAY);
    }

    const result = await convertIntentToAppointment(pool, row.id, auth, {
      skipOneHardNext: true,
      ...(chainMinStartTime ? { chainMinStartTime } : {}),
    });

    if (result.ok) {
      appointmentIds.push(result.appointmentId);
      // Anchor the NEXT intent's minimum off the actual booked slot, not off
      // any projector-derived ideal. This is the heart of the user's fix.
      prevActualStart = result.startTime;
    } else {
      skipped.push({
        intentId: row.id,
        reason: result.error,
        code: result.code,
        stepCode: row.step_code,
      });
      // Virtually advance the anchor so subsequent steps still respect the
      // CUMULATIVE pathway gap. Without this, if Harapásregisztráció is
      // skipped (e.g. "Nincs szabad slot"), Fogpróba could otherwise be
      // placed only `Fogpróba.gap` after Anat — sliding it BEFORE the
      // skipped Harapás slot in the calendar, which is clinically nonsense.
      // We use the SKIPPED step's own gap because that's the minimum
      // distance we'd have required from the previous successful anchor
      // to this step had it succeeded. The next iteration will add ITS
      // own gap on top.
      if (prevActualStart && chainMinStartTime) {
        prevActualStart = chainMinStartTime;
      }
    }
  }

  return NextResponse.json({
    converted: appointmentIds.length,
    appointmentIds,
    skipped,
  });
});

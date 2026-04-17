import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { getStepLabelMap } from '@/lib/step-labels';
import {
  normalizePathwayWorkPhaseArray,
  pathwayTemplatesFromCarePathwayRow,
} from '@/lib/pathway-work-phases-for-episode';
import { isReadPlanItemsEnabled } from '@/lib/plan-items-flags';
import { loadPlanItemLinksByLegacyEwp } from '@/lib/episode-plan-read-model';

export const dynamic = 'force-dynamic';

export type TimelineStepStatus = 'completed' | 'booked' | 'in_progress' | 'no_show' | 'projected' | 'overdue';

interface TimelineStep {
  stepCode: string;
  stepSeq: number;
  label: string;
  pool: string;
  durationMinutes: number;
  status: TimelineStepStatus;
  windowStart: string | null;
  windowEnd: string | null;
  appointmentId: string | null;
  appointmentStart: string | null;
  appointmentStatus: string | null;
  intentId: string | null;
  intentState: string | null;
  /** Populated when READ_PLAN_ITEMS and a pathway-linked plan item exists for this work phase. */
  planItemId?: string | null;
}

interface TimelineEpisode {
  episodeId: string;
  patientId: string;
  patientName: string;
  reason: string;
  status: string;
  openedAt: string;
  carePathwayName: string | null;
  assignedProviderName: string | null;
  treatmentTypeLabel: string | null;
  steps: TimelineStep[];
  etaHeuristic: string | null;
}

const PROTETIKAI_STAGE_CODES = ['STAGE_5', 'STAGE_6', 'STAGE_7'] as const;

export const GET = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth }) => {
  const searchParams = req.nextUrl.searchParams;
  const episodeStatus = searchParams.get('status') ?? 'open';
  const providerId = searchParams.get('providerId');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);

  const pool = getDbPool();
  const now = new Date();
  const readPlanItems = isReadPlanItemsEnabled();
  const apptPlanItemFilter = readPlanItems ? 'AND a.plan_item_id IS NULL' : '';

  const whereParts: string[] = [
    `(pe.care_pathway_id IS NOT NULL OR EXISTS (SELECT 1 FROM episode_pathways ep2 WHERE ep2.episode_id = pe.id))`,
  ];
  const params: unknown[] = [];
  let pi = 1;

  if (episodeStatus !== 'all') {
    whereParts.push(`pe.status = $${pi}`);
    params.push(episodeStatus);
    pi++;
  }
  if (providerId) {
    whereParts.push(`pe.assigned_provider_id = $${pi}`);
    params.push(providerId);
    pi++;
  }

  params.push(limit, offset);
  const episodesResult = await pool.query(
    `SELECT pe.id as episode_id, pe.patient_id, pe.reason, pe.status, pe.opened_at,
            p.nev as patient_name,
            cp.name as care_pathway_name, cp.work_phases_json, cp.steps_json,
            u.doktor_neve as assigned_provider_name,
            tt.label_hu as treatment_type_label
     FROM patient_episodes pe
     JOIN patients p ON pe.patient_id = p.id
     LEFT JOIN care_pathways cp ON pe.care_pathway_id = cp.id
     LEFT JOIN users u ON pe.assigned_provider_id = u.id
     LEFT JOIN treatment_types tt ON pe.treatment_type_id = tt.id
     WHERE ${whereParts.join(' AND ')}
     ORDER BY pe.opened_at DESC
     LIMIT $${pi} OFFSET $${pi + 1}`,
    params
  );

  if (episodesResult.rows.length === 0) {
    return NextResponse.json({
      episodes: [],
      meta: { serverNow: now.toISOString(), fetchedAt: now.toISOString(), timezone: 'Europe/Budapest', ordering: 'eta_asc' },
    });
  }

  const episodeIds = episodesResult.rows.map((r: { episode_id: string }) => r.episode_id);

  const multiPathwayStepsMap = new Map<
    string,
    NonNullable<ReturnType<typeof normalizePathwayWorkPhaseArray>>
  >();
  const multiPathwayNamesMap = new Map<string, string>();
  const rowHasPathwayPhases = (r: { work_phases_json?: unknown; steps_json?: unknown }) => {
    const n = pathwayTemplatesFromCarePathwayRow(r);
    return !!(n && n.length > 0);
  };
  const needsMultiPathway = episodesResult.rows.filter((r) => !rowHasPathwayPhases(r));
  if (needsMultiPathway.length > 0) {
    const needsIds = needsMultiPathway.map((r: { episode_id: string }) => r.episode_id);
    const mpResult = await pool.query(
      `SELECT ep.episode_id, cp.name, cp.work_phases_json, cp.steps_json
       FROM episode_pathways ep
       JOIN care_pathways cp ON ep.care_pathway_id = cp.id
       WHERE ep.episode_id = ANY($1)
       ORDER BY ep.episode_id, ep.ordinal`,
      [needsIds]
    );
    for (const row of mpResult.rows) {
      const epId = row.episode_id as string;
      const templates = pathwayTemplatesFromCarePathwayRow(row);
      if (!templates?.length) continue;
      const existing = multiPathwayStepsMap.get(epId) ?? [];
      existing.push(...templates);
      multiPathwayStepsMap.set(epId, existing);
      if (!multiPathwayNamesMap.has(epId)) {
        multiPathwayNamesMap.set(epId, row.name);
      } else {
        multiPathwayNamesMap.set(epId, multiPathwayNamesMap.get(epId) + ' + ' + row.name);
      }
    }
  }

  const [apptsResult, intentsResult, stagesResult, episodeStepsResult, stepLabelMap] = await Promise.all([
    pool.query(
      `SELECT a.id, a.episode_id, a.step_code,
              COALESCE(a.step_seq, si.step_seq) as step_seq,
              a.start_time, a.appointment_status
       FROM appointments a
       LEFT JOIN slot_intents si ON a.slot_intent_id = si.id
       WHERE a.episode_id = ANY($1)
         AND a.step_code IS NOT NULL
         AND a.appointment_status IS DISTINCT FROM 'cancelled_by_doctor'
         AND a.appointment_status IS DISTINCT FROM 'cancelled_by_patient'
         ${apptPlanItemFilter}
       ORDER BY COALESCE(a.step_seq, si.step_seq) ASC NULLS LAST`,
      [episodeIds]
    ),
    pool.query(
      `SELECT id, episode_id, step_code, step_seq, window_start, window_end, state
       FROM slot_intents
       WHERE episode_id = ANY($1)
         AND state IN ('open', 'expired', 'converted')
       ORDER BY step_seq ASC`,
      [episodeIds]
    ),
    pool.query(
      `SELECT DISTINCT ON (episode_id) episode_id, stage_code
       FROM stage_events
       WHERE episode_id = ANY($1)
       ORDER BY episode_id, at DESC`,
      [episodeIds]
    ),
    pool.query(
      `SELECT ewp.id as episode_work_phase_id, ewp.episode_id, ewp.work_phase_code as step_code,
              COALESCE(ewp.seq, ewp.pathway_order_index) as step_seq,
              ewp.pool, ewp.duration_minutes, ewp.custom_label
       FROM episode_work_phases ewp
       WHERE ewp.episode_id = ANY($1)
         AND (ewp.merged_into_episode_work_phase_id IS NULL)
       ORDER BY ewp.episode_id, COALESCE(ewp.seq, ewp.pathway_order_index)`,
      [episodeIds]
    ),
    getStepLabelMap(),
  ]);

  const planLinksByLegacyEwp = readPlanItems
    ? await loadPlanItemLinksByLegacyEwp(pool, episodeIds)
    : new Map();

  const stageByEpisode = new Map<string, string>();
  for (const row of stagesResult.rows as { episode_id: string; stage_code: string }[]) {
    stageByEpisode.set(row.episode_id, row.stage_code);
  }

  const apptsByEpisode = new Map<string, typeof apptsResult.rows>();
  for (const a of apptsResult.rows) {
    const arr = apptsByEpisode.get(a.episode_id) ?? [];
    arr.push(a);
    apptsByEpisode.set(a.episode_id, arr);
  }
  const intentsByEpisode = new Map<string, typeof intentsResult.rows>();
  for (const i of intentsResult.rows) {
    const arr = intentsByEpisode.get(i.episode_id) ?? [];
    arr.push(i);
    intentsByEpisode.set(i.episode_id, arr);
  }

  const stepsByEpisode = new Map<string, typeof episodeStepsResult.rows>();
  for (const row of episodeStepsResult.rows) {
    const arr = stepsByEpisode.get(row.episode_id) ?? [];
    arr.push(row);
    stepsByEpisode.set(row.episode_id, arr);
  }

  interface StepSource {
    stepCode: string;
    stepSeq: number;
    label: string;
    pool: string;
    durationMinutes: number;
    episodeWorkPhaseId: string;
  }

  const episodes: TimelineEpisode[] = [];
  for (const ep of episodesResult.rows) {
    const resolvedPathwayName = ep.care_pathway_name ?? multiPathwayNamesMap.get(ep.episode_id) ?? null;

    const esRows = stepsByEpisode.get(ep.episode_id);
    let stepSources: StepSource[];

    if (esRows && esRows.length > 0) {
      stepSources = esRows.map((r: Record<string, unknown>) => ({
        stepCode: r.step_code as string,
        stepSeq: Number(r.step_seq),
        label: (r.custom_label as string) || stepLabelMap.get(r.step_code as string) || (r.step_code as string),
        pool: r.pool as string,
        durationMinutes: (r.duration_minutes as number) ?? 30,
        episodeWorkPhaseId: r.episode_work_phase_id as string,
      }));
    } else {
      const pathwaySteps =
        multiPathwayStepsMap.get(ep.episode_id) ??
        pathwayTemplatesFromCarePathwayRow(ep) ??
        [];
      if (pathwaySteps.length === 0) continue;
      stepSources = pathwaySteps.map((ps, idx) => ({
        stepCode: ps.work_phase_code,
        stepSeq: idx,
        label: ps.label ?? stepLabelMap.get(ps.work_phase_code) ?? ps.work_phase_code,
        pool: ps.pool,
        durationMinutes: ps.duration_minutes ?? 30,
        episodeWorkPhaseId: '',
      }));
    }

    const steps: TimelineStep[] = [];
    const appts = apptsByEpisode.get(ep.episode_id) ?? [];
    const intents = intentsByEpisode.get(ep.episode_id) ?? [];
    const currentStage = stageByEpisode.get(ep.episode_id) ?? null;
    const isProtetikai = currentStage != null && (PROTETIKAI_STAGE_CODES as readonly string[]).includes(currentStage);

    const apptBySeq = new Map<number, (typeof appts)[0]>();
    const apptByCodeOnly = new Map<string, (typeof appts)[0]>();
    for (const a of appts) {
      if (a.step_seq != null) {
        apptBySeq.set(a.step_seq, a);
      } else if (a.step_code) {
        if (!apptByCodeOnly.has(a.step_code)) apptByCodeOnly.set(a.step_code, a);
      }
    }
    const intentBySeq = new Map<number, (typeof intents)[0]>();
    for (const i of intents) {
      if (i.step_seq != null) intentBySeq.set(i.step_seq, i);
    }

    let etaHeuristic: string | null = null;

    type ApptRow = (typeof appts)[number];

    for (const src of stepSources) {
      const planLink =
        readPlanItems && src.episodeWorkPhaseId
          ? planLinksByLegacyEwp.get(src.episodeWorkPhaseId)
          : undefined;

      let appt: ApptRow | null = null;
      let planItemId: string | null = null;

      if (planLink !== undefined) {
        planItemId = planLink.planItemId;
        if (planLink.appointmentId) {
          appt = {
            id: planLink.appointmentId,
            episode_id: planLink.episodeId,
            step_code: src.stepCode,
            step_seq: src.stepSeq,
            start_time: planLink.startTime,
            appointment_status: planLink.appointmentStatus,
          } as ApptRow;
        }
      } else {
        appt = apptBySeq.get(src.stepSeq) ?? null;
        if (!appt && apptByCodeOnly.has(src.stepCode)) {
          appt = apptByCodeOnly.get(src.stepCode)!;
          apptByCodeOnly.delete(src.stepCode);
        }
      }
      const intent = intentBySeq.get(src.stepSeq);

      let status: TimelineStepStatus;
      let windowStart: string | null = null;
      let windowEnd: string | null = null;

      if (appt) {
        const apptStatus = appt.appointment_status;
        if (apptStatus === 'completed') {
          status = 'completed';
        } else if (apptStatus === 'no_show') {
          status = 'no_show';
        } else {
          const apptStart = new Date(appt.start_time);
          status = apptStart > now ? 'booked' : 'in_progress';
          windowStart = appt.start_time;
          if (apptStart > now) {
            etaHeuristic = appt.start_time;
          }
        }
      } else if (intent && intent.state === 'open' && isProtetikai) {
        const wEnd = intent.window_end ? new Date(intent.window_end) : null;
        if (wEnd && wEnd < now) {
          status = 'overdue';
        } else {
          status = 'projected';
        }
        windowStart = intent.window_start;
        windowEnd = intent.window_end;
        if (intent.window_end) {
          etaHeuristic = intent.window_end;
        }
      } else if (intent && intent.state === 'open' && !isProtetikai) {
        const wEnd = intent.window_end ? new Date(intent.window_end) : null;
        status = wEnd && wEnd < now ? 'overdue' : 'projected';
        windowStart = null;
        windowEnd = null;
      } else {
        status = 'projected';
      }

      steps.push({
        stepCode: src.stepCode,
        stepSeq: src.stepSeq,
        label: src.label,
        pool: src.pool,
        durationMinutes: src.durationMinutes,
        status,
        windowStart,
        windowEnd,
        appointmentId: appt?.id ?? null,
        appointmentStart: appt?.start_time ?? null,
        appointmentStatus: appt?.appointment_status ?? null,
        intentId: intent?.id ?? null,
        intentState: intent?.state ?? null,
        ...(readPlanItems ? { planItemId } : {}),
      });
    }

    episodes.push({
      episodeId: ep.episode_id,
      patientId: ep.patient_id,
      patientName: ep.patient_name,
      reason: ep.reason,
      status: ep.status,
      openedAt: ep.opened_at,
      carePathwayName: resolvedPathwayName,
      assignedProviderName: ep.assigned_provider_name,
      treatmentTypeLabel: ep.treatment_type_label,
      steps,
      etaHeuristic,
    });
  }

  episodes.sort((a, b) => {
    if (!a.etaHeuristic && !b.etaHeuristic) return 0;
    if (!a.etaHeuristic) return 1;
    if (!b.etaHeuristic) return -1;
    return new Date(a.etaHeuristic).getTime() - new Date(b.etaHeuristic).getTime();
  });

  return NextResponse.json({
    episodes,
    meta: {
      serverNow: now.toISOString(),
      fetchedAt: now.toISOString(),
      timezone: 'Europe/Budapest',
      ordering: 'eta_asc',
      readPlanItemsEnabled: readPlanItems,
    },
  });
});

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

export type TimelineStepStatus = 'completed' | 'booked' | 'planned';

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
  assignedProviderId: string | null;
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
  const searchRaw = searchParams.get('search')?.trim() ?? '';
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
  if (searchRaw) {
    whereParts.push(`p.nev ILIKE $${pi}`);
    params.push(`%${searchRaw}%`);
    pi++;
  }

  params.push(limit, offset);
  const episodesResult = await pool.query(
    `SELECT pe.id as episode_id, pe.patient_id, pe.reason, pe.status, pe.opened_at,
            pe.assigned_provider_id,
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
      meta: {
        serverNow: now.toISOString(),
        fetchedAt: now.toISOString(),
        timezone: 'Europe/Budapest',
        ordering: 'eta_asc',
        readPlanItemsEnabled: readPlanItems,
        counts: { totalEpisodes: 0, actionNeededIn7d: 0 },
      },
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

  // Egy kliensen sorban: elkerüljük az 5 egyidejű pool.query-t (max pool≈5 → más route-tal
  // „timeout exceeded when trying to connect”). A címke-térkép cache-elt, előre töltjük.
  const stepLabelMap = await getStepLabelMap();
  const episodeIdsParam = [episodeIds];
  const client = await pool.connect();
  let apptsResult;
  let intentsResult;
  let stagesResult;
  let episodeStepsResult;
  try {
    apptsResult = await client.query(
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
       ORDER BY COALESCE(a.step_seq, si.step_seq) ASC NULLS LAST,
                a.start_time ASC NULLS LAST`,
      episodeIdsParam
    );
    intentsResult = await client.query(
      `SELECT id, episode_id, step_code, step_seq, window_start, window_end, state
       FROM slot_intents
       WHERE episode_id = ANY($1)
         AND state IN ('open', 'expired', 'converted')
       ORDER BY step_seq ASC`,
      episodeIdsParam
    );
    stagesResult = await client.query(
      `SELECT DISTINCT ON (episode_id) episode_id, stage_code
       FROM stage_events
       WHERE episode_id = ANY($1)
       ORDER BY episode_id, at DESC`,
      episodeIdsParam
    );
    episodeStepsResult = await client.query(
      `SELECT ewp.id as episode_work_phase_id, ewp.episode_id, ewp.work_phase_code as step_code,
              COALESCE(ewp.seq, ewp.pathway_order_index) as step_seq,
              ewp.pool, ewp.duration_minutes, ewp.custom_label
       FROM episode_work_phases ewp
       WHERE ewp.episode_id = ANY($1)
         AND (ewp.merged_into_episode_work_phase_id IS NULL)
       ORDER BY ewp.episode_id, COALESCE(ewp.seq, ewp.pathway_order_index)`,
      episodeIdsParam
    );
  } finally {
    client.release();
  }

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

    // FIFO queue per step_code a `step_seq IS NULL` appointmentekhez:
    // ha az epizódban több (pl. ismételt KONTROLL) lépés van ugyanazzal a
    // code-dal és a foglalás snapshot-ja nem rögzítette a `step_seq`-et,
    // korábban csak az ELSŐ appointment matchel-t a stepre, a többi
    // eldobódott. A queue-val a `start_time ASC`-rendezésben sorrendben
    // fogyasztják a step-ek (FIFO).
    const apptBySeq = new Map<number, (typeof appts)[0]>();
    const apptByCodeOnlyQueue = new Map<string, (typeof appts)[0][]>();
    for (const a of appts) {
      if (a.step_seq != null) {
        apptBySeq.set(a.step_seq, a);
      } else if (a.step_code) {
        const queue = apptByCodeOnlyQueue.get(a.step_code) ?? [];
        queue.push(a);
        apptByCodeOnlyQueue.set(a.step_code, queue);
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
        if (!appt) {
          // FIFO consume: a legkorábbi (start_time ASC) no-step_seq
          // appointmentet rendeljük a következő ilyen step-hez. Az így
          // elfogyasztott appointmenteket a következő iteráció már nem
          // látja, így multi-step esetén minden no-seq foglalás külön
          // sorhoz kerül.
          const queue = apptByCodeOnlyQueue.get(src.stepCode);
          if (queue && queue.length > 0) {
            appt = queue.shift() ?? null;
            if (queue.length === 0) {
              apptByCodeOnlyQueue.delete(src.stepCode);
            }
          }
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
          status = 'planned';
        } else {
          status = 'booked';
          windowStart = appt.start_time;
          const apptStart = new Date(appt.start_time);
          if (apptStart > now) {
            etaHeuristic = appt.start_time;
          }
        }
      } else if (intent && intent.state === 'open' && isProtetikai) {
        status = 'planned';
        windowStart = intent.window_start;
        windowEnd = intent.window_end;
        if (intent.window_end) {
          etaHeuristic = intent.window_end;
        }
      } else if (intent && intent.state === 'open' && !isProtetikai) {
        status = 'planned';
        windowStart = null;
        windowEnd = null;
      } else {
        status = 'planned';
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
      assignedProviderId: ep.assigned_provider_id ?? null,
      assignedProviderName: ep.assigned_provider_name,
      treatmentTypeLabel: ep.treatment_type_label,
      steps,
      etaHeuristic,
    });
  }

  const nowMs = now.getTime();
  const horizonMs = nowMs + 7 * 24 * 60 * 60 * 1000;
  let actionNeededIn7d = 0;
  for (const ep of episodes) {
    let needsAttention7d = false;
    for (const s of ep.steps) {
      const refStart = s.appointmentStart || s.windowStart;
      if (s.status === 'booked') {
        if (refStart) {
          const t = new Date(refStart).getTime();
          if (!Number.isNaN(t) && t >= nowMs && t <= horizonMs) needsAttention7d = true;
        }
      }
      if (s.status === 'planned') {
        const ws = s.windowStart ? new Date(s.windowStart).getTime() : NaN;
        const we = s.windowEnd ? new Date(s.windowEnd).getTime() : NaN;
        if (!Number.isNaN(we) && we < nowMs) {
          needsAttention7d = true;
        }
        if (!Number.isNaN(ws) && !Number.isNaN(we)) {
          if (we >= nowMs && ws <= horizonMs) needsAttention7d = true;
        } else if (!Number.isNaN(ws) && ws >= nowMs && ws <= horizonMs) {
          needsAttention7d = true;
        } else if (!Number.isNaN(we) && we >= nowMs && we <= horizonMs) {
          needsAttention7d = true;
        }
      }
    }
    if (needsAttention7d) actionNeededIn7d++;
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
      counts: {
        totalEpisodes: episodes.length,
        actionNeededIn7d,
      },
    },
  });
});

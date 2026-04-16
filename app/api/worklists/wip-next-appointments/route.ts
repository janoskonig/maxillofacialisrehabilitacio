import { NextRequest, NextResponse } from 'next/server';
import { getDbPool, queryWithRetry } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import {
  allPendingStepsWithData,
  isBlockedAll,
  type EpisodeBatchData,
  type EpisodeWorkPhaseRow,
  type PathwayWorkPhaseTemplate,
} from '@/lib/next-step-engine';
import { normalizePathwayWorkPhaseArray } from '@/lib/pathway-work-phases-for-episode';
import { extractSuggestedTreatmentTypeCodes } from '@/lib/treatment-type-normalize';
import { WIP_STAGE_CODES } from '@/lib/wip-stage';
import {
  computeInputsHashBatch,
  refreshEpisodeForecastCache,
} from '@/lib/episode-forecast';
import type { WorklistItemBackend } from '@/lib/worklist-types';
import { isReadPlanItemsEnabled } from '@/lib/plan-items-flags';
import {
  sqlAppointmentStepCodesActive,
  sqlAppointmentStepCodesCompleted,
  sqlBookedFutureAppointmentsWithEffectiveStep,
} from '@/lib/episode-plan-read-model';
import { chainBookingRequiredFromCounts } from '@/lib/chain-booking-status';
import { enrichWorklistBookableWindows } from '@/lib/worklist-bookable-windows';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  return queryWithRetry(async () => {
  const pool = getDbPool();

  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get('patientId');

  const serverNow = new Date();
  const serverNowISO = serverNow.toISOString();

  const queryParams: string[] = [];
  let paramIndex = 1;
  const extraConditions: string[] = [];
  if (patientId) {
    extraConditions.push(`pe.patient_id = $${paramIndex}`);
    queryParams.push(patientId);
    paramIndex++;
  }
  // All authenticated users can see all worklist items
  const extraWhere = extraConditions.length ? ' AND ' + extraConditions.join(' AND ') : '';

  const wipStageList = WIP_STAGE_CODES.map((c) => `'${c}'`).join(',');
  const episodesResult = await pool.query(
    `SELECT DISTINCT pe.id as "episodeId", pe.patient_id as "patientId", pe.assigned_provider_id as "assignedProviderId",
            p.nev as "patientName", pe.opened_at as "openedAt"
     FROM patient_episodes pe
     JOIN patients p ON pe.patient_id = p.id
     LEFT JOIN (
       SELECT DISTINCT ON (episode_id) episode_id, stage_code
       FROM stage_events ORDER BY episode_id, at DESC
     ) se ON pe.id = se.episode_id
     WHERE pe.status = 'open'
     AND (se.stage_code IS NULL OR se.stage_code IN (${wipStageList}))
     ${extraWhere}
     ORDER BY pe.opened_at ASC`,
    queryParams
  );

  if (episodesResult.rows.length === 0) {
    return NextResponse.json({ items: [], serverNowISO, chainBookingRequiredByEpisodeId: {} });
  }

  // ── Batch pre-fetch: ~11 parallel queries instead of N×(6-13) sequential ──
  const allEpisodeIds = episodesResult.rows.map((r: any) => r.episodeId);
  const allPatientIds = Array.from(new Set(episodesResult.rows.map((r: any) => r.patientId))) as string[];
  const readPlanItems = isReadPlanItemsEnabled();

  let episodeWorkPhasesMergedFilter = '';
  let episodeWorkPhasesOptionalCols = '';
  try {
    const epCols = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'episode_work_phases' AND column_name IN ('merged_into_episode_work_phase_id', 'default_days_offset', 'custom_label')`
    );
    const names = new Set(epCols.rows.map((r: { column_name: string }) => r.column_name));
    if (names.has('merged_into_episode_work_phase_id')) {
      episodeWorkPhasesMergedFilter = 'AND merged_into_episode_work_phase_id IS NULL';
    }
    if (names.has('default_days_offset')) episodeWorkPhasesOptionalCols += ', default_days_offset';
    if (names.has('custom_label')) episodeWorkPhasesOptionalCols += ', custom_label';
  } catch {
    /* columns may not exist */
  }

  const [
    stageRows,
    noShowRows,
    blockRows,
    completedStatsRows,
    episodeWorkPhaseRows,
    multiPathwayRows,
    legacyPathwayRows,
    episodeTreatmentRows,
    patientDataRows,
    treatmentTypesRows,
    episodeOpenedRows,
    completedApptStepRows,
    activeApptStepRows,
    openWorkIntentCountRows,
    pendingPhaseCountRows,
  ] = await Promise.all([
    pool.query(
      `SELECT DISTINCT ON (episode_id) episode_id, stage_code
       FROM stage_events WHERE episode_id = ANY($1)
       ORDER BY episode_id, at DESC`,
      [allEpisodeIds]
    ),
    pool.query(
      `SELECT patient_id, COUNT(*)::int as cnt
       FROM appointments
       WHERE patient_id = ANY($1) AND appointment_status = 'no_show'
         AND created_at > CURRENT_TIMESTAMP - INTERVAL '12 months'
       GROUP BY patient_id`,
      [allPatientIds]
    ),
    pool.query(
      `SELECT episode_id, key, expires_at
       FROM episode_blocks
       WHERE episode_id = ANY($1) AND active = true AND expires_at > CURRENT_TIMESTAMP`,
      [allEpisodeIds]
    ),
    pool.query(
      `SELECT a.episode_id,
              COUNT(*)::int as completed_count,
              MAX(COALESCE(a.start_time, a.created_at)) as last_completed_at
       FROM appointments a
       WHERE a.episode_id = ANY($1) AND a.appointment_status = 'completed'
       GROUP BY a.episode_id`,
      [allEpisodeIds]
    ),
    pool.query(
      `SELECT id, episode_id, work_phase_code, pathway_order_index, seq, status, completed_at, pool, duration_minutes${episodeWorkPhasesOptionalCols}
       FROM episode_work_phases WHERE episode_id = ANY($1) ${episodeWorkPhasesMergedFilter}
       ORDER BY episode_id, COALESCE(seq, pathway_order_index), pathway_order_index`,
      [allEpisodeIds]
    ),
    pool.query(
      `SELECT ep.episode_id, cp.work_phases_json, cp.steps_json
       FROM episode_pathways ep
       JOIN care_pathways cp ON ep.care_pathway_id = cp.id
       WHERE ep.episode_id = ANY($1)
       ORDER BY ep.episode_id, ep.ordinal`,
      [allEpisodeIds]
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT pe.id as episode_id, cp.work_phases_json, cp.steps_json
       FROM patient_episodes pe
       JOIN care_pathways cp ON pe.care_pathway_id = cp.id
       WHERE pe.id = ANY($1)`,
      [allEpisodeIds]
    ),
    pool.query(
      `SELECT pe.id as episode_id, pe.treatment_type_id, cp.treatment_type_id as pathway_treatment_type_id
       FROM patient_episodes pe
       LEFT JOIN care_pathways cp ON pe.care_pathway_id = cp.id
       WHERE pe.id = ANY($1)`,
      [allEpisodeIds]
    ),
    pool.query(
      `SELECT p.id, t.kezelesi_terv_felso as "kezelesiTervFelso", t.kezelesi_terv_also as "kezelesiTervAlso"
       FROM patients p
       LEFT JOIN patient_treatment_plans t ON t.patient_id = p.id
       WHERE p.id = ANY($1)`,
      [allPatientIds]
    ),
    pool.query(`SELECT id, code, label_hu FROM treatment_types`),
    pool.query(
      `SELECT id, opened_at FROM patient_episodes WHERE id = ANY($1)`,
      [allEpisodeIds]
    ),
    pool.query(sqlAppointmentStepCodesCompleted(readPlanItems), [allEpisodeIds]),
    pool.query(sqlAppointmentStepCodesActive(readPlanItems), [allEpisodeIds]),
    pool.query(
      `SELECT episode_id,
              COUNT(*) FILTER (WHERE state = 'open' AND pool = 'work')::int AS cnt
       FROM slot_intents
       WHERE episode_id = ANY($1)
       GROUP BY episode_id`,
      [allEpisodeIds]
    ),
    pool.query(
      `SELECT episode_id, COUNT(*)::int AS cnt
       FROM episode_work_phases
       WHERE episode_id = ANY($1)
         AND status IN ('pending', 'scheduled')
         ${episodeWorkPhasesMergedFilter}
       GROUP BY episode_id`,
      [allEpisodeIds]
    ),
  ]);

  let planItemByEwpId = new Map<string, string>();
  if (readPlanItems && episodeWorkPhaseRows.rows.length > 0) {
    const ewpIds = Array.from(
      new Set(
        (episodeWorkPhaseRows.rows as { id?: string }[])
          .map((r) => r.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );
    if (ewpIds.length > 0) {
      const pip = await pool.query(
        `SELECT id, legacy_episode_work_phase_id AS "legacyEwpId"
         FROM episode_plan_items
         WHERE legacy_episode_work_phase_id = ANY($1::uuid[]) AND archived_at IS NULL`,
        [ewpIds]
      );
      for (const row of pip.rows as { id: string; legacyEwpId: string }[]) {
        planItemByEwpId.set(row.legacyEwpId, row.id);
      }
    }
  }

  // ── Build lookup Maps ──
  const stageMap = new Map<string, string>(
    stageRows.rows.map((r: any) => [r.episode_id, r.stage_code])
  );
  const noShowMap = new Map<string, number>(
    noShowRows.rows.map((r: any) => [r.patient_id, r.cnt])
  );

  // Blocks grouped by episode
  const blocksMap = new Map<string, Array<{ key: string; expires_at: Date }>>();
  for (const r of blockRows.rows) {
    const arr = blocksMap.get(r.episode_id) ?? [];
    arr.push({ key: r.key, expires_at: r.expires_at });
    blocksMap.set(r.episode_id, arr);
  }

  // Completed stats by episode
  const completedStatsMap = new Map<string, { completedCount: number; lastCompletedAt: Date | null }>(
    completedStatsRows.rows.map((r: any) => [
      r.episode_id,
      { completedCount: r.completed_count, lastCompletedAt: r.last_completed_at ? new Date(r.last_completed_at) : null },
    ])
  );

  const episodeWorkPhasesMap = new Map<string, (EpisodeWorkPhaseRow & { id?: string })[]>();
  for (const r of episodeWorkPhaseRows.rows) {
    const arr = episodeWorkPhasesMap.get(r.episode_id) ?? [];
    arr.push(r as EpisodeWorkPhaseRow & { id?: string });
    episodeWorkPhasesMap.set(r.episode_id, arr);
  }

  const multiPathwayMap = new Map<string, PathwayWorkPhaseTemplate[]>();
  for (const r of (multiPathwayRows as any).rows) {
    const existing = multiPathwayMap.get(r.episode_id) ?? [];
    const chunk =
      normalizePathwayWorkPhaseArray(r.work_phases_json) ?? normalizePathwayWorkPhaseArray(r.steps_json);
    if (chunk) existing.push(...chunk);
    multiPathwayMap.set(r.episode_id, existing);
  }
  const legacyPathwayMap = new Map<string, PathwayWorkPhaseTemplate[]>();
  for (const r of legacyPathwayRows.rows as any[]) {
    const templates =
      normalizePathwayWorkPhaseArray(r.work_phases_json) ?? normalizePathwayWorkPhaseArray(r.steps_json);
    if (templates && templates.length > 0) legacyPathwayMap.set(r.episode_id, templates);
  }
  function getPathwayWorkPhasesForEpisodeBatch(episodeId: string): PathwayWorkPhaseTemplate[] | null {
    const multi = multiPathwayMap.get(episodeId);
    if (multi && multi.length > 0) return multi;
    const legacy = legacyPathwayMap.get(episodeId);
    return legacy && legacy.length > 0 ? legacy : null;
  }

  // Episode treatment type IDs
  const episodeTreatmentMap = new Map<string, { treatmentTypeId: string | null; pathwayTreatmentTypeId: string | null }>(
    episodeTreatmentRows.rows.map((r: any) => [r.episode_id, {
      treatmentTypeId: r.treatment_type_id,
      pathwayTreatmentTypeId: r.pathway_treatment_type_id,
    }])
  );

  // Patient data
  const patientDataMap = new Map<string, { kezelesiTervFelso: any; kezelesiTervAlso: any }>(
    patientDataRows.rows.map((r: any) => [r.id, {
      kezelesiTervFelso: r.kezelesiTervFelso,
      kezelesiTervAlso: r.kezelesiTervAlso,
    }])
  );

  // Treatment types by ID and by code
  const ttById = new Map<string, { code: string; label_hu: string }>(
    treatmentTypesRows.rows.map((r: any) => [r.id, { code: r.code, label_hu: r.label_hu }])
  );
  const ttByCode = new Map<string, { id: string; label_hu: string }>(
    treatmentTypesRows.rows.map((r: any) => [r.code, { id: r.id, label_hu: r.label_hu }])
  );

  // Episode opened_at
  const openedAtMap = new Map<string, Date>(
    episodeOpenedRows.rows.map((r: any) => [r.id, r.opened_at ? new Date(r.opened_at) : new Date()])
  );

  const openWorkIntentByEpisode = new Map<string, number>(
    openWorkIntentCountRows.rows.map((r: { episode_id: string; cnt: number }) => [r.episode_id, r.cnt])
  );
  const pendingPhaseByEpisode = new Map<string, number>(
    pendingPhaseCountRows.rows.map((r: { episode_id: string; cnt: number }) => [r.episode_id, r.cnt])
  );
  const chainBookingRequiredByEpisodeId: Record<string, boolean> = {};
  for (const id of allEpisodeIds) {
    chainBookingRequiredByEpisodeId[id] = chainBookingRequiredFromCounts(
      openWorkIntentByEpisode.get(id) ?? 0,
      pendingPhaseByEpisode.get(id) ?? 0
    );
  }

  // Completed appointment step_codes per episode — used to filter out already-done steps
  const completedApptStepsByEpisode = new Map<string, Set<string>>();
  for (const r of completedApptStepRows.rows) {
    let s = completedApptStepsByEpisode.get(r.episode_id);
    if (!s) { s = new Set(); completedApptStepsByEpisode.set(r.episode_id, s); }
    s.add(r.step_code);
  }

  // Active (non-cancelled) appointment step_codes per episode — prevents re-showing already-booked steps
  const activeApptStepsByEpisode = new Map<string, Set<string>>();
  for (const r of activeApptStepRows.rows) {
    let s = activeApptStepsByEpisode.get(r.episode_id);
    if (!s) { s = new Set(); activeApptStepsByEpisode.set(r.episode_id, s); }
    s.add(r.step_code);
  }

  // ── Process episodes using batch data (no per-episode DB queries) ──
  const items: WorklistItemBackend[] = [];

  for (let epIdx = 0; epIdx < episodesResult.rows.length; epIdx++) {
    const row = episodesResult.rows[epIdx];
    const episodeId = row.episodeId;

    const batchData: EpisodeBatchData = {
      blocks: blocksMap.get(episodeId) ?? [],
      pathwayWorkPhases: getPathwayWorkPhasesForEpisodeBatch(episodeId),
      completedStats: completedStatsMap.get(episodeId) ?? { completedCount: 0, lastCompletedAt: null },
      episodeWorkPhases: episodeWorkPhasesMap.get(episodeId) ?? null,
      openedAt: openedAtMap.get(episodeId) ?? new Date(),
      currentStage: stageMap.get(episodeId) ?? null,
      bookedStepCodes: activeApptStepsByEpisode.get(episodeId),
    };

    const result = allPendingStepsWithData(episodeId, batchData);

    if (isBlockedAll(result)) {
      const currentStage = stageMap.get(episodeId) ?? 'STAGE_0';
      let suggestedTreatmentTypeCode: string | null = null;
      let suggestedTreatmentTypeLabel: string | null = null;
      if (result.code === 'NO_CARE_PATHWAY') {
        const pData = patientDataMap.get(row.patientId);
        const suggested = extractSuggestedTreatmentTypeCodes(
          pData?.kezelesiTervFelso,
          pData?.kezelesiTervAlso
        );
        if (suggested.length > 0) {
          suggestedTreatmentTypeCode = suggested[0];
          const ttRow = ttByCode.get(suggestedTreatmentTypeCode);
          suggestedTreatmentTypeLabel = ttRow?.label_hu ?? suggestedTreatmentTypeCode;
        }
      }
      items.push({
        episodeId,
        patientId: row.patientId,
        patientName: row.patientName ?? null,
        currentStage,
        nextStep: '-',
        stepCode: undefined,
        overdueByDays: 0,
        windowStart: null,
        windowEnd: null,
        durationMinutes: 0,
        pool: 'work',
        priorityScore: 0,
        noShowRisk: 0,
        status: 'blocked',
        blockedReason: result.reason,
        episodeOrder: epIdx,
        ...(result.code && { blockedCode: result.code }),
        ...(suggestedTreatmentTypeCode && { suggestedTreatmentTypeCode }),
        ...(suggestedTreatmentTypeLabel && { suggestedTreatmentTypeLabel }),
      });
      continue;
    }

    if (result.length === 0) continue;

    const currentStage = stageMap.get(episodeId) ?? 'STAGE_0';
    const noShowCount = noShowMap.get(row.patientId) ?? 0;
    const noShowRisk = Math.min(0.95, 0.05 + noShowCount * 0.15);

    let treatmentTypeCode: string | undefined;
    let treatmentTypeLabel: string | undefined;
    let treatmentTypeSource: 'episode' | 'pathway' | 'patient' | undefined;
    if (currentStage === 'STAGE_5') {
      const epTt = episodeTreatmentMap.get(episodeId);
      const pData = patientDataMap.get(row.patientId);

      if (epTt?.treatmentTypeId) {
        const tt = ttById.get(epTt.treatmentTypeId);
        if (tt) {
          treatmentTypeCode = tt.code;
          treatmentTypeLabel = tt.label_hu;
          treatmentTypeSource = 'episode';
        }
      }
      if (!treatmentTypeCode && epTt?.pathwayTreatmentTypeId) {
        const tt = ttById.get(epTt.pathwayTreatmentTypeId);
        if (tt) {
          treatmentTypeCode = tt.code;
          treatmentTypeLabel = tt.label_hu;
          treatmentTypeSource = 'pathway';
        }
      }
      if (!treatmentTypeCode && pData) {
        const codes = extractSuggestedTreatmentTypeCodes(
          pData.kezelesiTervFelso,
          pData.kezelesiTervAlso
        );
        if (codes.length > 0) {
          const tt = ttByCode.get(codes[0]);
          if (tt) {
            treatmentTypeCode = codes[0];
            treatmentTypeLabel = tt.label_hu;
            treatmentTypeSource = 'patient';
          }
        }
      }
    }

    for (const step of result) {
      const now = new Date();
      const windowEnd = new Date(step.latest_date);
      const overdueByDays = windowEnd < now ? Math.ceil((now.getTime() - windowEnd.getTime()) / (24 * 60 * 60 * 1000)) : 0;
      const priorityScore = Math.min(100, 50 + overdueByDays * 5);

      const phasesForEpisode = episodeWorkPhasesMap.get(episodeId) ?? [];
      const stepRow = phasesForEpisode.find(
        (r: { work_phase_code: string; status: string }) =>
          r.work_phase_code === step.work_phase_code && (r.status === 'pending' || r.status === 'scheduled')
      );
      const episodeStepId = stepRow && 'id' in stepRow ? (stepRow as { id: string }).id : null;

      const item: WorklistItemBackend = {
        episodeId,
        patientId: row.patientId,
        patientName: row.patientName ?? null,
        currentStage,
        nextStep: step.label ?? step.work_phase_code,
        stepLabel: step.label,
        stepCode: step.work_phase_code,
        overdueByDays,
        windowStart: step.earliest_date.toISOString(),
        windowEnd: step.latest_date.toISOString(),
        durationMinutes: step.duration_minutes,
        pool: step.pool,
        priorityScore,
        noShowRisk,
        stepSeq: step.stepSeq,
        requiresPrecommit: !step.isFirstPending,
        episodeOrder: epIdx,
        stepStatus: step.stepStatus,
        ...(episodeStepId && { episodeStepId }),
        ...(row.assignedProviderId && { assignedProviderId: row.assignedProviderId }),
      };

      if (treatmentTypeCode || treatmentTypeLabel || treatmentTypeSource) {
        item.treatmentTypeCode = treatmentTypeCode;
        item.treatmentTypeLabel = treatmentTypeLabel;
        item.treatmentTypeSource = treatmentTypeSource;
      }

      if (readPlanItems && episodeStepId) {
        const pid = planItemByEwpId.get(episodeStepId);
        if (pid) item.planItemId = pid;
      }

      items.push(item);
    }
  }

  // Completed steps are now returned with stepStatus='completed' and shown in the UI timeline —
  // no longer filtered out here.

  // ── Booked appointments enrichment ──
  const readyItems = items.filter((i) => i.status !== 'blocked');
  if (readyItems.length > 0) {
    const episodeIds = Array.from(new Set(readyItems.map((i) => i.episodeId)));
    const bookedResult = await pool.query(sqlBookedFutureAppointmentsWithEffectiveStep(), [episodeIds]);
    type BookedEntry = { id: string; startTime: string; providerEmail: string | null };
    const exactMap = new Map<string, BookedEntry>();
    const stepSeqMap = new Map<string, BookedEntry>();
    const episodeMap = new Map<string, BookedEntry>();
    for (const row of bookedResult.rows) {
      const start = new Date(row.effective_start).toISOString();
      const entry: BookedEntry = { id: row.id, startTime: start, providerEmail: row.dentist_email };
      if (row.step_code) {
        const exactKey = `${row.episode_id}:${row.step_code}`;
        const existing = exactMap.get(exactKey);
        if (!existing || start < existing.startTime) {
          exactMap.set(exactKey, entry);
        }
      }
      if (row.step_seq != null) {
        const seqKey = `${row.episode_id}:${row.step_seq}`;
        const existing = stepSeqMap.get(seqKey);
        if (!existing || start < existing.startTime) {
          stepSeqMap.set(seqKey, entry);
        }
      }
      const epExisting = episodeMap.get(row.episode_id);
      if (!epExisting || start < epExisting.startTime) {
        episodeMap.set(row.episode_id, entry);
      }
    }
    for (const item of readyItems) {
      const exactKey = item.stepCode ? `${item.episodeId}:${item.stepCode}` : null;
      const seqKey = item.stepSeq != null ? `${item.episodeId}:${item.stepSeq}` : null;
      const booked = (exactKey && exactMap.get(exactKey))
        || (seqKey && stepSeqMap.get(seqKey))
        || ((item.stepSeq === 0 || item.stepSeq === undefined) && episodeMap.get(item.episodeId))
        || null;
      if (booked) {
        item.bookedAppointmentId = booked.id;
        item.bookedAppointmentStartTime = booked.startTime;
        item.bookedAppointmentProviderEmail = booked.providerEmail;
      }
    }
  }

  await enrichWorklistBookableWindows(pool, items, serverNow);

  // ── Forecast enrichment ──
  const forecastEpisodeIds = items.filter((i) => i.status !== 'blocked').map((i) => i.episodeId);
  const forecastMap: Record<string, { p50: string | null; p80: string | null; rem50: number; rem80: number }> = {};

  if (forecastEpisodeIds.length > 0) {
    const cacheRows = await pool.query(
      `SELECT episode_id, completion_end_p50, completion_end_p80, remaining_visits_p50, remaining_visits_p80, status, inputs_hash
       FROM episode_forecast_cache WHERE episode_id = ANY($1)`,
      [forecastEpisodeIds]
    );
    type ForecastCacheRow = {
      episode_id: string;
      completion_end_p50: Date | string | null;
      completion_end_p80: Date | string | null;
      remaining_visits_p50: number | null;
      remaining_visits_p80: number | null;
      status: string;
      inputs_hash: string | null;
    };
    const cacheByEpisode = new Map<string, ForecastCacheRow>(
      (cacheRows.rows as ForecastCacheRow[]).map((r) => [r.episode_id, r])
    );
    const hashMap = await computeInputsHashBatch(forecastEpisodeIds);

    const toRecompute: string[] = [];
    for (const id of forecastEpisodeIds) {
      const cached = cacheByEpisode.get(id);
      const currentHash = hashMap.get(id);
      if (cached && cached.inputs_hash === currentHash && cached.status === 'ready') {
        const p50 = cached.completion_end_p50;
        const p80 = cached.completion_end_p80;
        forecastMap[id] = {
          p50: p50 != null ? new Date(p50).toISOString() : null,
          p80: p80 != null ? new Date(p80).toISOString() : null,
          rem50: cached.remaining_visits_p50 ?? 0,
          rem80: cached.remaining_visits_p80 ?? 0,
        };
      } else {
        toRecompute.push(id);
      }
    }

    const FORECAST_CONCURRENCY = 2;
    for (let i = 0; i < toRecompute.length; i += FORECAST_CONCURRENCY) {
      const batch = toRecompute.slice(i, i + FORECAST_CONCURRENCY);
      await Promise.all(batch.map((id) => refreshEpisodeForecastCache(id).catch(() => {})));
    }

    if (toRecompute.length > 0) {
      const freshCache = await pool.query(
        `SELECT episode_id, completion_end_p50, completion_end_p80, remaining_visits_p50, remaining_visits_p80, status
         FROM episode_forecast_cache WHERE episode_id = ANY($1)`,
        [toRecompute]
      );
      for (const r of freshCache.rows) {
        if (r.status === 'ready') {
          const p50 = r.completion_end_p50;
          const p80 = r.completion_end_p80;
          forecastMap[r.episode_id] = {
            p50: p50 != null ? new Date(p50).toISOString() : null,
            p80: p80 != null ? new Date(p80).toISOString() : null,
            rem50: r.remaining_visits_p50 ?? 0,
            rem80: r.remaining_visits_p80 ?? 0,
          };
        }
      }
    }

    for (const item of items) {
      if (item.status !== 'blocked' && item.episodeId) {
        const f = forecastMap[item.episodeId];
        if (f) {
          item.forecastCompletionEndP50ISO = f.p50 ?? undefined;
          item.forecastCompletionEndP80ISO = f.p80 ?? undefined;
          item.forecastRemainingP50 = f.rem50;
          item.forecastRemainingP80 = f.rem80;
        }
      }
    }
  }

  items.sort((a, b) => {
    const epA = a.episodeOrder ?? 0;
    const epB = b.episodeOrder ?? 0;
    if (epA !== epB) return epA - epB;
    const seqA = a.stepSeq ?? 0;
    const seqB = b.stepSeq ?? 0;
    return seqA - seqB;
  });

  return NextResponse.json({
    items,
    serverNowISO,
    chainBookingRequiredByEpisodeId,
  });
  });
});

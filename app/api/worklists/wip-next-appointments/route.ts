import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import {
  allPendingStepsWithData,
  isBlockedAll,
  type EpisodeBatchData,
  type EpisodeStepRow,
  type PathwayStep,
} from '@/lib/next-step-engine';
import { extractSuggestedTreatmentTypeCodes } from '@/lib/treatment-type-normalize';
import { WIP_STAGE_CODES } from '@/lib/wip-stage';
import {
  computeInputsHashBatch,
  refreshEpisodeForecastCache,
} from '@/lib/episode-forecast';
import type { WorklistItemBackend } from '@/lib/worklist-types';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
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
  if (auth.role !== 'admin') {
    extraConditions.push(`(pe.assigned_provider_id IS NULL OR pe.assigned_provider_id = $${paramIndex})`);
    queryParams.push(auth.userId);
    paramIndex++;
  }
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
    return NextResponse.json({ items: [], serverNowISO });
  }

  // ── Batch pre-fetch: ~11 parallel queries instead of N×(6-13) sequential ──
  const allEpisodeIds = episodesResult.rows.map((r: any) => r.episodeId);
  const allPatientIds = Array.from(new Set(episodesResult.rows.map((r: any) => r.patientId))) as string[];

  const [
    stageRows,
    noShowRows,
    blockRows,
    completedStatsRows,
    episodeStepRows,
    multiPathwayRows,
    legacyPathwayRows,
    episodeTreatmentRows,
    patientDataRows,
    treatmentTypesRows,
    episodeOpenedRows,
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
      `SELECT episode_id, step_code, pathway_order_index, seq, status, completed_at
       FROM episode_steps WHERE episode_id = ANY($1)
       ORDER BY episode_id, COALESCE(seq, pathway_order_index), pathway_order_index`,
      [allEpisodeIds]
    ),
    pool.query(
      `SELECT ep.episode_id, cp.steps_json
       FROM episode_pathways ep
       JOIN care_pathways cp ON ep.care_pathway_id = cp.id
       WHERE ep.episode_id = ANY($1)
       ORDER BY ep.episode_id, ep.ordinal`,
      [allEpisodeIds]
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT pe.id as episode_id, cp.steps_json
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
      `SELECT id, kezelesi_terv_felso as "kezelesiTervFelso", kezelesi_terv_also as "kezelesiTervAlso"
       FROM patients WHERE id = ANY($1)`,
      [allPatientIds]
    ),
    pool.query(`SELECT id, code, label_hu FROM treatment_types`),
    pool.query(
      `SELECT id, opened_at FROM patient_episodes WHERE id = ANY($1)`,
      [allEpisodeIds]
    ),
  ]);

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

  // Episode steps grouped by episode
  const episodeStepsMap = new Map<string, EpisodeStepRow[]>();
  for (const r of episodeStepRows.rows) {
    const arr = episodeStepsMap.get(r.episode_id) ?? [];
    arr.push(r as EpisodeStepRow);
    episodeStepsMap.set(r.episode_id, arr);
  }

  // Pathway steps: prefer multi-pathway, fallback to legacy
  const multiPathwayMap = new Map<string, PathwayStep[]>();
  for (const r of (multiPathwayRows as any).rows) {
    const existing = multiPathwayMap.get(r.episode_id) ?? [];
    if (Array.isArray(r.steps_json)) existing.push(...(r.steps_json as PathwayStep[]));
    multiPathwayMap.set(r.episode_id, existing);
  }
  const legacyPathwayMap = new Map<string, PathwayStep[]>(
    legacyPathwayRows.rows
      .filter((r: any) => Array.isArray(r.steps_json))
      .map((r: any) => [r.episode_id, r.steps_json as PathwayStep[]])
  );
  function getPathwayStepsForEpisode(episodeId: string): PathwayStep[] | null {
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

  // ── Process episodes using batch data (no per-episode DB queries) ──
  const items: WorklistItemBackend[] = [];

  for (let epIdx = 0; epIdx < episodesResult.rows.length; epIdx++) {
    const row = episodesResult.rows[epIdx];
    const episodeId = row.episodeId;

    const batchData: EpisodeBatchData = {
      blocks: blocksMap.get(episodeId) ?? [],
      pathwaySteps: getPathwayStepsForEpisode(episodeId),
      completedStats: completedStatsMap.get(episodeId) ?? { completedCount: 0, lastCompletedAt: null },
      episodeSteps: episodeStepsMap.get(episodeId) ?? null,
      openedAt: openedAtMap.get(episodeId) ?? new Date(),
      currentStage: stageMap.get(episodeId) ?? null,
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

      const item: WorklistItemBackend = {
        episodeId,
        patientId: row.patientId,
        patientName: row.patientName ?? null,
        currentStage,
        nextStep: step.label ?? step.step_code,
        stepLabel: step.label,
        stepCode: step.step_code,
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
      };

      if (treatmentTypeCode || treatmentTypeLabel || treatmentTypeSource) {
        item.treatmentTypeCode = treatmentTypeCode;
        item.treatmentTypeLabel = treatmentTypeLabel;
        item.treatmentTypeSource = treatmentTypeSource;
      }

      items.push(item);
    }
  }

  // ── Booked appointments enrichment ──
  const readyItems = items.filter((i) => i.status !== 'blocked');
  if (readyItems.length > 0) {
    const episodeIds = Array.from(new Set(readyItems.map((i) => i.episodeId)));
    const bookedResult = await pool.query(
      `SELECT a.id, a.episode_id, a.step_code,
              COALESCE(a.start_time, ats.start_time) as effective_start,
              a.dentist_email
       FROM appointments a
       JOIN available_time_slots ats ON a.time_slot_id = ats.id
       WHERE a.episode_id = ANY($1)
         AND COALESCE(a.start_time, ats.start_time) > CURRENT_TIMESTAMP
         AND (a.appointment_status IS NULL OR a.appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient', 'no_show'))`,
      [episodeIds]
    );
    type BookedEntry = { id: string; startTime: string; providerEmail: string | null };
    const exactMap = new Map<string, BookedEntry>();
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
      const epExisting = episodeMap.get(row.episode_id);
      if (!epExisting || start < epExisting.startTime) {
        episodeMap.set(row.episode_id, entry);
      }
    }
    for (const item of readyItems) {
      const exactKey = item.stepCode ? `${item.episodeId}:${item.stepCode}` : null;
      const booked = (exactKey && exactMap.get(exactKey))
        || ((item.stepSeq === 0 || item.stepSeq === undefined) && episodeMap.get(item.episodeId))
        || null;
      if (booked) {
        item.bookedAppointmentId = booked.id;
        item.bookedAppointmentStartTime = booked.startTime;
        item.bookedAppointmentProviderEmail = booked.providerEmail;
      }
    }
  }

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

    for (const id of toRecompute) {
      await refreshEpisodeForecastCache(id);
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
  });
});

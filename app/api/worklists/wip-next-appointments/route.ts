import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { allPendingSteps, isBlockedAll } from '@/lib/next-step-engine';
import { extractSuggestedTreatmentTypeCodes } from '@/lib/treatment-type-normalize';
import { getEffectiveTreatmentType } from '@/lib/effective-treatment-type';
import { WIP_STAGE_CODES } from '@/lib/wip-stage';
import {
  computeInputsHashBatch,
  computeEpisodeForecast,
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

  const items: WorklistItemBackend[] = [];

  for (let epIdx = 0; epIdx < episodesResult.rows.length; epIdx++) {
    const row = episodesResult.rows[epIdx];
    const result = await allPendingSteps(row.episodeId);

    if (isBlockedAll(result)) {
      const stageRow = await pool.query(
        `SELECT stage_code FROM stage_events WHERE episode_id = $1 ORDER BY at DESC LIMIT 1`,
        [row.episodeId]
      );
      let suggestedTreatmentTypeCode: string | null = null;
      let suggestedTreatmentTypeLabel: string | null = null;
      if (result.code === 'NO_CARE_PATHWAY') {
        const patientRow = await pool.query(
          `SELECT kezelesi_terv_felso as "kezelesiTervFelso", kezelesi_terv_also as "kezelesiTervAlso"
           FROM patients WHERE id = $1`,
          [row.patientId]
        );
        const p = patientRow.rows[0];
        const suggested = extractSuggestedTreatmentTypeCodes(
          p?.kezelesiTervFelso,
          p?.kezelesiTervAlso
        );
        if (suggested.length > 0) {
          suggestedTreatmentTypeCode = suggested[0];
          const labelRow = await pool.query(
            `SELECT label_hu FROM treatment_types WHERE code = $1`,
            [suggestedTreatmentTypeCode]
          );
          suggestedTreatmentTypeLabel = labelRow.rows[0]?.label_hu ?? suggestedTreatmentTypeCode;
        }
      }
      items.push({
        episodeId: row.episodeId,
        patientId: row.patientId,
        patientName: row.patientName ?? null,
        currentStage: stageRow.rows[0]?.stage_code ?? 'STAGE_0',
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

    const stageResult = await pool.query(
      `SELECT stage_code FROM stage_events WHERE episode_id = $1 ORDER BY at DESC LIMIT 1`,
      [row.episodeId]
    );
    const currentStage = stageResult.rows[0]?.stage_code ?? 'STAGE_0';

    const patientNoShowResult = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM appointments a
       WHERE a.patient_id = $1 AND a.appointment_status = 'no_show'
       AND a.created_at > CURRENT_TIMESTAMP - INTERVAL '12 months'`,
      [row.patientId]
    );
    const noShowCount = patientNoShowResult.rows[0]?.cnt ?? 0;
    const noShowRisk = Math.min(0.95, 0.05 + noShowCount * 0.15);

    let treatmentTypeCode: string | undefined;
    let treatmentTypeLabel: string | undefined;
    let treatmentTypeSource: 'episode' | 'pathway' | 'patient' | undefined;
    if (currentStage === 'STAGE_5') {
      const epRow = await pool.query(
        `SELECT pe.treatment_type_id as "episodeTreatmentTypeId", cp.treatment_type_id as "pathwayTreatmentTypeId"
         FROM patient_episodes pe
         LEFT JOIN care_pathways cp ON pe.care_pathway_id = cp.id
         WHERE pe.id = $1`,
        [row.episodeId]
      );
      const patientRow = await pool.query(
        `SELECT kezelesi_terv_felso as "kezelesiTervFelso", kezelesi_terv_also as "kezelesiTervAlso"
         FROM patients WHERE id = $1`,
        [row.patientId]
      );
      const ep = epRow.rows[0];
      const p = patientRow.rows[0];
      const effective = await getEffectiveTreatmentType(pool, {
        episodeTreatmentTypeId: ep?.episodeTreatmentTypeId,
        pathwayTreatmentTypeId: ep?.pathwayTreatmentTypeId,
        kezelesiTervFelso: p?.kezelesiTervFelso,
        kezelesiTervAlso: p?.kezelesiTervAlso,
      });
      treatmentTypeCode = effective.code ?? undefined;
      treatmentTypeLabel = effective.label ?? undefined;
      treatmentTypeSource = effective.source ?? undefined;
    }

    for (const step of result) {
      const now = new Date();
      const windowEnd = new Date(step.latest_date);
      const overdueByDays = windowEnd < now ? Math.ceil((now.getTime() - windowEnd.getTime()) / (24 * 60 * 60 * 1000)) : 0;
      const priorityScore = Math.min(100, 50 + overdueByDays * 5);

      const item: WorklistItemBackend = {
        episodeId: row.episodeId,
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

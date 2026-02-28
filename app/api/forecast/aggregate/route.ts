import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { WIP_STAGE_CODES } from '@/lib/wip-stage';
import type { ForecastAggregateResponse, DoctorWipForecast } from '@/lib/forecast-types';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  const { searchParams } = new URL(req.url);
  const horizonDays = Math.min(365, Math.max(1, parseInt(searchParams.get('horizonDays') || '120', 10) || 120));

  const pool = getDbPool();
  const serverNowResult = await pool.query('SELECT now() as now');
  const serverNow = new Date(serverNowResult.rows[0].now);
  const fetchedAt = new Date();

  const wipStageList = WIP_STAGE_CODES.map((c) => `'${c}'`).join(',');
  const wipResult = await pool.query(
    `SELECT pe.id as "episodeId", pe.assigned_provider_id as "assignedProviderId",
            u.doktor_neve as "providerName", u.email as "providerEmail"
     FROM patient_episodes pe
     LEFT JOIN users u ON pe.assigned_provider_id = u.id
     LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
     WHERE pe.status = 'open'
     AND (se.stage_code IS NULL OR se.stage_code IN (${wipStageList}))`
  );

  interface WipRow { episodeId: string; assignedProviderId: string | null; providerName: string | null; providerEmail: string | null }
  const wipRows: WipRow[] = wipResult.rows;
  const wipIds = wipRows.map((r) => r.episodeId);
  const wipCount = wipIds.length;

  let wipCompletionP50Max: string | null = null;
  let wipCompletionP80Max: string | null = null;
  let wipVisitsRemainingP50Sum = 0;
  let wipVisitsRemainingP80Sum = 0;

  const byDoctorMap = new Map<string, {
    providerId: string | null;
    providerName: string | null;
    providerEmail: string | null;
    wipCount: number;
    maxP50: Date | null;
    maxP80: Date | null;
    visitsP50: number;
    visitsP80: number;
  }>();

  const providerByEpisode = new Map<string, WipRow>();
  for (const row of wipRows) {
    providerByEpisode.set(row.episodeId, row);
    const key = row.assignedProviderId ?? '__unassigned__';
    if (!byDoctorMap.has(key)) {
      byDoctorMap.set(key, {
        providerId: row.assignedProviderId,
        providerName: row.providerName,
        providerEmail: row.providerEmail,
        wipCount: 0, maxP50: null, maxP80: null, visitsP50: 0, visitsP80: 0,
      });
    }
    byDoctorMap.get(key)!.wipCount++;
  }

  if (wipIds.length > 0) {
    const cacheResult = await pool.query(
      `SELECT episode_id, completion_end_p50, completion_end_p80, remaining_visits_p50, remaining_visits_p80
       FROM episode_forecast_cache
       WHERE episode_id = ANY($1) AND status = 'ready'`,
      [wipIds]
    );

    let maxP50: Date | null = null;
    let maxP80: Date | null = null;
    for (const r of cacheResult.rows) {
      if (r.completion_end_p50) {
        const d = new Date(r.completion_end_p50);
        if (!maxP50 || d > maxP50) maxP50 = d;
      }
      if (r.completion_end_p80) {
        const d = new Date(r.completion_end_p80);
        if (!maxP80 || d > maxP80) maxP80 = d;
      }
      wipVisitsRemainingP50Sum += r.remaining_visits_p50 ?? 0;
      wipVisitsRemainingP80Sum += r.remaining_visits_p80 ?? 0;

      const provRow = providerByEpisode.get(r.episode_id);
      const key = provRow?.assignedProviderId ?? '__unassigned__';
      const doc = byDoctorMap.get(key);
      if (doc) {
        if (r.completion_end_p50) {
          const d = new Date(r.completion_end_p50);
          if (!doc.maxP50 || d > doc.maxP50) doc.maxP50 = d;
        }
        if (r.completion_end_p80) {
          const d = new Date(r.completion_end_p80);
          if (!doc.maxP80 || d > doc.maxP80) doc.maxP80 = d;
        }
        doc.visitsP50 += r.remaining_visits_p50 ?? 0;
        doc.visitsP80 += r.remaining_visits_p80 ?? 0;
      }
    }
    wipCompletionP50Max = maxP50?.toISOString() ?? null;
    wipCompletionP80Max = maxP80?.toISOString() ?? null;
  }

  const byDoctor: DoctorWipForecast[] = Array.from(byDoctorMap.values())
    .sort((a, b) => b.wipCount - a.wipCount)
    .map((d) => ({
      providerId: d.providerId,
      providerName: d.providerName,
      providerEmail: d.providerEmail,
      wipCount: d.wipCount,
      wipCompletionP50Max: d.maxP50?.toISOString() ?? null,
      wipCompletionP80Max: d.maxP80?.toISOString() ?? null,
      wipVisitsRemainingP50Sum: d.visitsP50,
      wipVisitsRemainingP80Sum: d.visitsP80,
    }));

  const response: ForecastAggregateResponse = {
    wipCount,
    wipCompletionP50Max,
    wipCompletionP80Max,
    wipVisitsRemainingP50Sum,
    wipVisitsRemainingP80Sum,
    byDoctor,
    meta: {
      serverNow: serverNow.toISOString(),
      fetchedAt: fetchedAt.toISOString(),
      timezone: 'Europe/Budapest',
      dateDomain: 'TIMESTAMPTZ_INCLUSIVE',
      queryEcho: { horizonDays },
      episodeCountIncluded: wipCount,
    },
  };

  return NextResponse.json(response);
});

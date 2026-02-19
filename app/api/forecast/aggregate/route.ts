import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { WIP_STAGE_CODES } from '@/lib/wip-stage';
import type { ForecastAggregateResponse } from '@/lib/forecast-types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/forecast/aggregate?scope=work&horizonDays=120
 * Returns WIP aggregate: max completion P50/P80, sum remaining visits.
 * horizonDays in queryEcho only (future use).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const horizonDays = Math.min(365, Math.max(1, parseInt(searchParams.get('horizonDays') || '120', 10) || 120));

    const pool = getDbPool();
    const serverNowResult = await pool.query('SELECT now() as now');
    const serverNow = new Date(serverNowResult.rows[0].now);
    const fetchedAt = new Date();

    const wipStageList = WIP_STAGE_CODES.map((c) => `'${c}'`).join(',');
    const wipResult = await pool.query(
      `SELECT pe.id as "episodeId"
       FROM patient_episodes pe
       LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
       WHERE pe.status = 'open'
       AND (se.stage_code IS NULL OR se.stage_code IN (${wipStageList}))`
    );

    const wipIds = wipResult.rows.map((r: { episodeId: string }) => r.episodeId);
    let wipCount = wipIds.length;
    let wipCompletionP50Max: string | null = null;
    let wipCompletionP80Max: string | null = null;
    let wipVisitsRemainingP50Sum = 0;
    let wipVisitsRemainingP80Sum = 0;

    if (wipIds.length > 0) {
      const cacheResult = await pool.query(
        `SELECT completion_end_p50, completion_end_p80, remaining_visits_p50, remaining_visits_p80
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
      }
      wipCompletionP50Max = maxP50?.toISOString() ?? null;
      wipCompletionP80Max = maxP80?.toISOString() ?? null;
    }

    const response: ForecastAggregateResponse = {
      wipCount,
      wipCompletionP50Max,
      wipCompletionP80Max,
      wipVisitsRemainingP50Sum,
      wipVisitsRemainingP80Sum,
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
  } catch (error) {
    console.error('Error fetching aggregate forecast:', error);
    return NextResponse.json(
      { error: 'Hiba történt a prognózis lekérdezésekor' },
      { status: 500 }
    );
  }
}

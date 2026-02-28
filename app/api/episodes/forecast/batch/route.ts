import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import {
  computeEpisodeForecast,
  computeInputsHashBatch,
  toEpisodeForecastItem,
} from '@/lib/episode-forecast';
import type { EpisodeForecastBatchResponse, EpisodeForecastItem } from '@/lib/forecast-types';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const LIMIT = 100;

async function handleBatch(
  episodeIds: string[],
  serverNow: Date,
  fetchedAt: Date
): Promise<EpisodeForecastBatchResponse> {
  const pool = getDbPool();

  let ids = [...episodeIds];
  const limitApplied = ids.length > LIMIT;
  if (ids.length > LIMIT) {
    ids = ids.slice(0, LIMIT);
  }

  const forecasts: Record<string, EpisodeForecastItem> = {};

  if (ids.length === 0) {
    return {
      forecasts: {},
      meta: {
        serverNow: serverNow.toISOString(),
        fetchedAt: fetchedAt.toISOString(),
        timezone: 'Europe/Budapest',
        dateDomain: 'TIMESTAMPTZ_INCLUSIVE',
        episodeCountRequested: episodeIds.length,
        episodeCountReturned: 0,
        limit: LIMIT,
        limitApplied,
      },
    };
  }

  const cacheRows = await pool.query(
    `SELECT episode_id, completion_end_p50, completion_end_p80, remaining_visits_p50, remaining_visits_p80, next_step, status, inputs_hash
     FROM episode_forecast_cache WHERE episode_id = ANY($1)`,
    [ids]
  );
  type CacheRow = {
    episode_id: string;
    completion_end_p50: Date | string | null;
    completion_end_p80: Date | string | null;
    remaining_visits_p50: number | null;
    remaining_visits_p80: number | null;
    next_step: string | null;
    status: string;
    inputs_hash: string | null;
  };
  const cacheByEpisode = new Map<string, CacheRow>(
    (cacheRows.rows as CacheRow[]).map((r) => [r.episode_id, r])
  );

  const hashByEpisode = await computeInputsHashBatch(ids);

  const toRecompute: string[] = [];
  for (const id of ids) {
    const cached = cacheByEpisode.get(id);
    const currentHash = hashByEpisode.get(id);
    if (cached && cached.inputs_hash === currentHash) {
      if (cached.status === 'blocked') {
        forecasts[id] = { status: 'blocked', assumptions: ['BLOCKED_NO_CARE_PATHWAY'] };
      } else {
        const p50 = cached.completion_end_p50;
        const p80 = cached.completion_end_p80;
        forecasts[id] = {
          status: 'ready',
          assumptions: ['cached'],
          remainingVisitsP50: cached.remaining_visits_p50 ?? undefined,
          remainingVisitsP80: cached.remaining_visits_p80 ?? undefined,
          completionWindowStart: p50 != null ? new Date(p50).toISOString() : undefined,
          completionWindowEnd: p80 != null ? new Date(p80).toISOString() : undefined,
          stepCode: cached.next_step ?? undefined,
        };
      }
    } else {
      toRecompute.push(id);
    }
  }

  // Compute forecasts in parallel, then bulk upsert cache
  const recomputeResults = await Promise.all(
    toRecompute.map(async (id) => {
      const result = await computeEpisodeForecast(id);
      forecasts[id] = toEpisodeForecastItem(result);
      return { id, result, inputsHash: hashByEpisode.get(id)! };
    })
  );

  if (recomputeResults.length > 0) {
    const values: any[] = [];
    const placeholders: string[] = [];
    let idx = 1;
    for (const { id, result, inputsHash } of recomputeResults) {
      if (result.status === 'blocked') {
        placeholders.push(`($${idx}, NULL, NULL, NULL, NULL, NULL, 'blocked', $${idx + 1})`);
        values.push(id, inputsHash);
        idx += 2;
      } else {
        placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, 'ready', $${idx + 6})`);
        values.push(id, result.completionWindowStart, result.completionWindowEnd, result.remainingVisitsP50, result.remainingVisitsP80, result.stepCode, inputsHash);
        idx += 7;
      }
    }
    await pool.query(
      `INSERT INTO episode_forecast_cache (episode_id, completion_end_p50, completion_end_p80, remaining_visits_p50, remaining_visits_p80, next_step, status, inputs_hash)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (episode_id) DO UPDATE SET
         completion_end_p50 = EXCLUDED.completion_end_p50,
         completion_end_p80 = EXCLUDED.completion_end_p80,
         remaining_visits_p50 = EXCLUDED.remaining_visits_p50,
         remaining_visits_p80 = EXCLUDED.remaining_visits_p80,
         next_step = EXCLUDED.next_step,
         status = EXCLUDED.status,
         inputs_hash = EXCLUDED.inputs_hash,
         computed_at = CURRENT_TIMESTAMP`,
      values
    );
  }

  return {
    forecasts,
    meta: {
      serverNow: serverNow.toISOString(),
      fetchedAt: fetchedAt.toISOString(),
      timezone: 'Europe/Budapest',
      dateDomain: 'TIMESTAMPTZ_INCLUSIVE',
      episodeCountRequested: episodeIds.length,
      episodeCountReturned: Object.keys(forecasts).length,
      limit: LIMIT,
      limitApplied,
    },
  };
}

export const GET = authedHandler(async (req, { auth }) => {
  const { searchParams } = new URL(req.url);
  const episodeIdsParam = searchParams.get('episodeIds');
  const episodeIds = episodeIdsParam ? episodeIdsParam.split(',').map((s) => s.trim()).filter(Boolean) : [];

  const pool = getDbPool();
  const serverNowResult = await pool.query('SELECT now() as now');
  const serverNow = new Date(serverNowResult.rows[0].now);
  const fetchedAt = new Date();

  const response = await handleBatch(episodeIds, serverNow, fetchedAt);
  return NextResponse.json(response);
});

export const POST = authedHandler(async (req, { auth }) => {
  const body = await req.json().catch(() => ({}));
  const episodeIds = Array.isArray(body.episodeIds)
    ? body.episodeIds.filter((id: unknown) => typeof id === 'string')
    : [];

  const pool = getDbPool();
  const serverNowResult = await pool.query('SELECT now() as now');
  const serverNow = new Date(serverNowResult.rows[0].now);
  const fetchedAt = new Date();

  const response = await handleBatch(episodeIds, serverNow, fetchedAt);
  return NextResponse.json(response);
});

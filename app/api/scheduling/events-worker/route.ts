import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { refreshEpisodeNextStepCache, resolveEpisodeIdFromEvent } from '@/lib/refresh-episode-next-step-cache';
import { refreshEpisodeForecastCache } from '@/lib/refresh-episode-forecast-cache';
import { logger } from '@/lib/logger';
import { apiHandler } from '@/lib/api/route-handler';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const BATCH_SIZE = 50;

export const POST = apiHandler(async (req) => {
  const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('api_key');
  const expectedApiKey = process.env.GOOGLE_CALENDAR_SYNC_API_KEY;

  if (expectedApiKey && apiKey !== expectedApiKey) {
    const auth = await verifyAuth(req);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const pool = getDbPool();
  const result = await pool.query(
    `SELECT id, entity_type, entity_id FROM scheduling_events 
     WHERE processed_at IS NULL ORDER BY created_at ASC LIMIT $1`,
    [BATCH_SIZE]
  );

  const events = result.rows;
  let processed = 0;

  for (const ev of events) {
    try {
      const episodeId = await resolveEpisodeIdFromEvent(pool, ev.entity_type, ev.entity_id);
      if (episodeId) {
        await refreshEpisodeNextStepCache(episodeId);
        await refreshEpisodeForecastCache(episodeId);
      }
    } catch (err) {
      logger.error(`[events-worker] Error processing event ${ev.id}:`, err);
    }
    processed++;
  }

  if (processed > 0) {
    await pool.query(
      `UPDATE scheduling_events SET processed_at = CURRENT_TIMESTAMP WHERE id = ANY($1)`,
      [events.map((e: { id: string }) => e.id)]
    );
  }

  return NextResponse.json({
    processed,
    timestamp: new Date().toISOString(),
  });
});

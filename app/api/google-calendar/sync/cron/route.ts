import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { syncTimeSlotsFromGoogleCalendar } from '@/lib/google-calendar';
import { apiHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req, { correlationId }) => {
  const startTime = Date.now();
  logger.info(`[${new Date().toISOString()}] Cron sync started`);

  const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('api_key');
  const expectedApiKey = process.env.GOOGLE_CALENDAR_SYNC_API_KEY;

  if (expectedApiKey && apiKey !== expectedApiKey) {
    console.warn(`[${new Date().toISOString()}] Unauthorized cron sync attempt`);
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  logger.info(`[${new Date().toISOString()}] Fetching users with Google Calendar enabled...`);
  const pool = getDbPool();

  try {
    await pool.query('SELECT 1');
    logger.info(`[${new Date().toISOString()}] Database connection verified`);
  } catch (dbError) {
    logger.error(`[${new Date().toISOString()}] Database connection error:`, dbError);
    throw new Error(`Database connection failed: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`);
  }

  const usersResult = await pool.query(
    `SELECT id, email 
     FROM users 
     WHERE google_calendar_enabled = true`
  );

  logger.info(`[${new Date().toISOString()}] Found ${usersResult.rows.length} users to sync`);

  const results = [];
  let hasErrors = false;

  for (let i = 0; i < usersResult.rows.length; i++) {
    const user = usersResult.rows[i];
    const userStartTime = Date.now();

    try {
      logger.info(`[${new Date().toISOString()}] Syncing user ${i + 1}/${usersResult.rows.length}: ${user.email} (${user.id})`);
      const syncResult = await syncTimeSlotsFromGoogleCalendar(user.id);
      const userDuration = Date.now() - userStartTime;
      logger.info(`[${new Date().toISOString()}] User ${user.email} synced in ${userDuration}ms: ${syncResult.created} created, ${syncResult.updated} updated, ${syncResult.deleted} deleted`);

      results.push({
        userId: user.id,
        email: user.email,
        ...syncResult,
      });
    } catch (error) {
      hasErrors = true;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error(`[${new Date().toISOString()}] Error syncing user ${user.id} (${user.email}):`, errorMessage);
      if (errorStack) {
        logger.error(`[${new Date().toISOString()}] Error stack:`, errorStack);
      }
      results.push({
        userId: user.id,
        email: user.email,
        error: errorMessage,
        created: 0,
        updated: 0,
        deleted: 0,
      });
    }
  }

  const totalCreated = results.reduce((sum, r) => sum + ('created' in r ? (r.created || 0) : 0), 0);
  const totalUpdated = results.reduce((sum, r) => sum + ('updated' in r ? (r.updated || 0) : 0), 0);
  const totalDeleted = results.reduce((sum, r) => sum + ('deleted' in r ? (r.deleted || 0) : 0), 0);

  const totalDuration = Date.now() - startTime;
  logger.info(`[${new Date().toISOString()}] Cron sync completed in ${totalDuration}ms: ${totalCreated} created, ${totalUpdated} updated, ${totalDeleted} deleted`);

  const response = NextResponse.json({
    success: !hasErrors,
    timestamp: new Date().toISOString(),
    duration: totalDuration,
    usersProcessed: results.length,
    summary: {
      totalCreated,
      totalUpdated,
      totalDeleted,
    },
    details: results,
    warnings: hasErrors ? 'Some users failed to sync, check details' : undefined,
  }, {
    status: hasErrors ? 207 : 200,
    headers: {
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache',
    },
  });

  return response;
});

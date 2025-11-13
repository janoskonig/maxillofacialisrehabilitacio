import { NextRequest, NextResponse } from 'next/server';
import { getDbPool, queryWithRetry } from '@/lib/db';
import { syncTimeSlotsFromGoogleCalendar } from '@/lib/google-calendar';

/**
 * Cron job endpoint automatikus szinkronizációhoz
 * Védve API kulccsal
 */
export async function GET(request: NextRequest) {
  try {
    // API kulcs ellenőrzése
    const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
    const expectedApiKey = process.env.GOOGLE_CALENDAR_SYNC_API_KEY;
    
    if (expectedApiKey && apiKey !== expectedApiKey) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    
    // Lekérjük az összes Google Calendar-hoz kapcsolt felhasználót
    const usersResult = await queryWithRetry(
      pool,
      `SELECT id, email 
       FROM users 
       WHERE google_calendar_enabled = true`
    );

    console.log(`[Cron Sync] Found ${usersResult.rows.length} users with Google Calendar enabled`);
    
    const results = [];
    
    for (const user of usersResult.rows) {
      try {
        console.log(`[Cron Sync] Starting sync for user ID: ${user.id}, email: ${user.email}`);
        const syncResult = await syncTimeSlotsFromGoogleCalendar(user.id);
        const result = {
          userId: user.id,
          email: user.email,
          ...syncResult,
        };
        results.push(result);
        console.log(`[Cron Sync] Completed sync for user ID: ${user.id}, email: ${user.email}. Created: ${syncResult.created}, Updated: ${syncResult.updated}, Deleted: ${syncResult.deleted}, Errors: ${syncResult.errors.length}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Cron Sync] Error syncing user ID: ${user.id}, email: ${user.email}:`, errorMessage);
        results.push({
          userId: user.id,
          email: user.email,
          error: errorMessage,
        });
      }
    }

    const totalCreated = results.reduce((sum, r) => sum + ('created' in r ? (r.created || 0) : 0), 0);
    const totalUpdated = results.reduce((sum, r) => sum + ('updated' in r ? (r.updated || 0) : 0), 0);
    const totalDeleted = results.reduce((sum, r) => sum + ('deleted' in r ? (r.deleted || 0) : 0), 0);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      usersProcessed: results.length,
      summary: {
        totalCreated,
        totalUpdated,
        totalDeleted,
      },
      details: results,
    });
  } catch (error) {
    console.error('Error in cron sync:', error);
    return NextResponse.json(
      { 
        error: 'Hiba történt a cron szinkronizáció során',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}


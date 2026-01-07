import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
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
    const usersResult = await pool.query(
      `SELECT id, email 
       FROM users 
       WHERE google_calendar_enabled = true`
    );

    const results = [];
    let hasErrors = false;
    
    for (const user of usersResult.rows) {
      try {
        const syncResult = await syncTimeSlotsFromGoogleCalendar(user.id);
        results.push({
          userId: user.id,
          email: user.email,
          ...syncResult,
        });
      } catch (error) {
        hasErrors = true;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[cron sync] Error syncing user ${user.id} (${user.email}):`, errorMessage);
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

    // Ne dobjunk 500-as hibát, ha csak részleges sikertelenség van
    // Visszaadjuk a részleges eredményeket is
    return NextResponse.json({
      success: !hasErrors, // false ha voltak hibák
      timestamp: new Date().toISOString(),
      usersProcessed: results.length,
      summary: {
        totalCreated,
        totalUpdated,
        totalDeleted,
      },
      details: results,
      warnings: hasErrors ? 'Some users failed to sync, check details' : undefined,
    }, {
      status: hasErrors ? 207 : 200 // 207 Multi-Status ha voltak hibák
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


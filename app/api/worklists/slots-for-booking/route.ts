import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { canConsumeSlot } from '@/lib/scheduling-service';

/**
 * GET /api/worklists/slots-for-booking
 * Pre-filtered slot picker for worklist "Book next" CTA.
 * Params: pool, durationMinutes, windowStart, windowEnd, providerId? (optional)
 * Returns free slots matching pool + duration + window for easy one-click booking.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'sebészorvos' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultsága' }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const pool = searchParams.get('pool') || 'work';
    const durationMinutes = parseInt(searchParams.get('durationMinutes') || '30', 10);
    const windowStart = searchParams.get('windowStart');
    const windowEnd = searchParams.get('windowEnd');
    const providerId = searchParams.get('providerId');
    const limit = Math.min(50, parseInt(searchParams.get('limit') || '20', 10));

    const validPools = ['consult', 'work', 'control'];
    if (!validPools.includes(pool)) {
      return NextResponse.json(
        { error: 'pool érvényes értékek: consult, work, control' },
        { status: 400 }
      );
    }

    const db = getDbPool();

    // Csak manuálisan kiírt szabad slotok (ne a Google Calendar-ból szinkronizáltak)
    let whereClause = `WHERE ats.state = 'free' AND ats.start_time > CURRENT_TIMESTAMP
       AND (ats.source = 'manual' OR ats.source IS NULL)`;
    const params: unknown[] = [];
    let paramIndex = 1;

    if (pool) {
      whereClause += ` AND (ats.slot_purpose = $${paramIndex} OR ats.slot_purpose IS NULL)`;
      params.push(pool);
      paramIndex++;
    }

    if (durationMinutes > 0) {
      whereClause += ` AND (ats.duration_minutes >= $${paramIndex} OR ats.duration_minutes IS NULL)`;
      params.push(durationMinutes);
      paramIndex++;
    }

    if (windowStart) {
      whereClause += ` AND ats.start_time >= $${paramIndex}`;
      params.push(windowStart);
      paramIndex++;
    }

    if (windowEnd) {
      whereClause += ` AND ats.start_time <= $${paramIndex}`;
      params.push(windowEnd);
      paramIndex++;
    }

    if (providerId) {
      whereClause += ` AND ats.user_id = $${paramIndex}`;
      params.push(providerId);
      paramIndex++;
    }

    params.push(limit);

    const result = await db.query(
      `SELECT ats.id, ats.start_time as "startTime", ats.duration_minutes as "durationMinutes",
              ats.slot_purpose as "slotPurpose", ats.state,
              u.email as "dentistEmail", u.doktor_neve as "dentistName", u.id as "dentistUserId"
       FROM available_time_slots ats
       JOIN users u ON ats.user_id = u.id
       ${whereClause}
       ORDER BY ats.start_time ASC
       LIMIT $${paramIndex}`,
      params
    );

    const slots = result.rows.filter((s: { state: string }) => canConsumeSlot(s.state));

    // queryEcho – debug és cache-koherencia (support 10 mp alatt látja UI vs backend félreértést)
    const queryEcho = {
      pool,
      duration: durationMinutes,
      windowStartISO: windowStart ?? null,
      windowEndISO: windowEnd ?? null,
      provider: providerId ?? 'all',
    };

    return NextResponse.json({
      slots,
      filters: { pool, durationMinutes, windowStart, windowEnd, providerId },
      queryEcho,
    });
  } catch (error) {
    console.error('Error fetching slots for booking:', error);
    return NextResponse.json(
      { error: 'Hiba történt az időpontok lekérdezésekor' },
      { status: 500 }
    );
  }
}

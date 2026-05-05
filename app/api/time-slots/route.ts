import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  const pool = getDbPool();

  const searchParams = req.nextUrl.searchParams;
  const page = parseInt(searchParams.get('page') || '1', 10);
  // Hardcap a limitre, hogy a kliens ne tudjon véletlen 100k sort lekérni
  // (a `useAppointmentBooking` hook history-ja: 100 oldal × 100 = 10k slot
  // szekvenciálisan).
  const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
  const limit = Math.max(1, Math.min(rawLimit, 500));
  const offset = (page - 1) * limit;

  const onlyAvailable = searchParams.get('onlyAvailable') === 'true';
  /**
   * `from` paraméter — ha megadott ISO dátum, csak az ettől kezdődő slotokat
   * adjuk vissza. A `useAppointmentBooking` korábban kliens-oldalon szűrt
   * `now() - 4 óra`-ra, de így minden slot (akár évek óta múltbeli) átment
   * a wire-on. A backend-szintű szűréssel a 10k+ múltbeli sor kikerül.
   */
  const fromRaw = searchParams.get('from');
  const fromDate = fromRaw ? new Date(fromRaw) : null;
  const hasFrom = fromDate !== null && !Number.isNaN(fromDate.getTime());

  const whereParts: string[] = [];
  const params: unknown[] = [];
  if (onlyAvailable) {
    whereParts.push(`ats.status = 'available'`);
  }
  if (hasFrom) {
    params.push(fromDate!.toISOString());
    whereParts.push(`ats.start_time >= $${params.length}`);
  }
  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

  const countQuery = `
    SELECT COUNT(*) as total
    FROM available_time_slots ats
    JOIN users u ON ats.user_id = u.id
    ${whereClause}
  `;
  const countResult = await pool.query(countQuery, params);

  const dataParams = [...params, limit.toString(), offset.toString()];
  const query = `
    SELECT 
      ats.id,
      ats.start_time as "startTime",
      ats.status,
      ats.cim,
      ats.teremszam,
      ats.created_at as "createdAt",
      ats.updated_at as "updatedAt",
      u.email as "userEmail",
      u.doktor_neve as "dentistName",
      ats.slot_purpose as "slotPurpose",
      ats.source,
      ats.state,
      ats.duration_minutes as "durationMinutes"
    FROM available_time_slots ats
    JOIN users u ON ats.user_id = u.id
    ${whereClause}
    ORDER BY ats.start_time ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const result = await pool.query(query, dataParams);

  const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
  const timeSlots = result.rows.map((row: { cim?: string | null; [key: string]: unknown }) => ({
    ...row,
    cim: row.cim || DEFAULT_CIM,
  }));

  const total = parseInt(countResult.rows[0].total, 10);
  const totalPages = Math.ceil(total / limit);

  return NextResponse.json({
    timeSlots,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    }
  });
});

export const POST = roleHandler(['fogpótlástanász', 'admin'], async (req, { auth }) => {
  const body = await req.json();
  const { startTime, cim, teremszam, slotPurpose, durationMinutes } = body;

  const validPurposes = ['consult', 'work', 'control', 'flexible'];
  const finalSlotPurpose = validPurposes.includes(slotPurpose) ? slotPurpose : null;
  const finalDurationMinutes =
    typeof durationMinutes === 'number' && durationMinutes > 0 ? durationMinutes : null;

  const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
  const finalCim = cim || DEFAULT_CIM;

  if (!startTime) {
    return NextResponse.json(
      { error: 'Az időpont kezdete kötelező' },
      { status: 400 }
    );
  }

  const startDate = new Date(startTime);
  const now = new Date();

  if (startDate <= now) {
    return NextResponse.json(
      { error: 'Az időpont csak jövőbeli dátum lehet' },
      { status: 400 }
    );
  }

  const pool = getDbPool();
  
  const bodyUserId = body.userId;
  const bodyUserEmail = body.userEmail;
  
  let userId: string;
  
  if (auth.role === 'admin') {
    if (bodyUserId) {
      const targetUserResult = await pool.query('SELECT id FROM users WHERE id = $1', [bodyUserId]);
      if (targetUserResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'A megadott felhasználó nem található' },
          { status: 404 }
        );
      }
      userId = targetUserResult.rows[0].id;
    } else if (bodyUserEmail) {
      const targetUserResult = await pool.query('SELECT id FROM users WHERE email = $1', [bodyUserEmail.toLowerCase().trim()]);
      if (targetUserResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'A megadott felhasználó nem található' },
          { status: 404 }
        );
      }
      userId = targetUserResult.rows[0].id;
    } else {
      const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [auth.email]);
      if (userResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Felhasználó nem található' },
          { status: 404 }
        );
      }
      userId = userResult.rows[0].id;
    }
  } else {
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [auth.email]);
    if (userResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Felhasználó nem található' },
        { status: 404 }
      );
    }
    userId = userResult.rows[0].id;
  }

  const insertCols = ['user_id', 'start_time', 'status', 'cim', 'teremszam'];
  const insertVals: unknown[] = [userId, startDate.toISOString(), 'available', finalCim, teremszam || null];
  if (finalSlotPurpose !== null) {
    insertCols.push('slot_purpose');
    insertVals.push(finalSlotPurpose);
  }
  if (finalDurationMinutes !== null) {
    insertCols.push('duration_minutes');
    insertVals.push(finalDurationMinutes);
  }
  const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');
  const result = await pool.query(
    `INSERT INTO available_time_slots (${insertCols.join(', ')})
     VALUES (${placeholders})
     RETURNING 
       id,
       start_time as "startTime",
       status,
       cim,
       teremszam,
       created_at as "createdAt",
       updated_at as "updatedAt"`,
    insertVals
  );

  return NextResponse.json({ timeSlot: result.rows[0] }, { status: 201 });
});

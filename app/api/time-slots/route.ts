import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

// Get all available time slots
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    const role = auth.role;
    const userEmail = auth.email;
    
    // Pagination paraméterek
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = (page - 1) * limit;
    
    // Opcionális szűrés csak szabad időpontokra
    const onlyAvailable = searchParams.get('onlyAvailable') === 'true';
    const statusFilter = onlyAvailable ? "WHERE ats.status = 'available'" : '';

    // Count query
    const countQuery = `
      SELECT COUNT(*) as total
      FROM available_time_slots ats
      JOIN users u ON ats.user_id = u.id
      ${statusFilter}
    `;
    const countResult = await pool.query(countQuery);

    // Data query with pagination
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
        u.doktor_neve as "dentistName"
      FROM available_time_slots ats
      JOIN users u ON ats.user_id = u.id
      ${statusFilter}
      ORDER BY ats.start_time ASC
      LIMIT $1 OFFSET $2
    `;
    const params: unknown[] = [limit.toString(), offset.toString()];

    const result = await pool.query(query, params);
    
    // Default cím érték: "1088 Budapest, Szentkirályi utca 47"
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
  } catch (error) {
    console.error('Error fetching time slots:', error);
    return NextResponse.json(
      { error: 'Hiba történt az időpontok lekérdezésekor' },
      { status: 500 }
    );
  }
}

// Create a new time slot (only fogpótlástanász)
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    if (auth.role !== 'fogpótlástanász' && auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Csak fogpótlástanász vagy admin hozhat létre időpontot' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { startTime, cim, teremszam, slotPurpose, durationMinutes } = body;

    const validPurposes = ['consult', 'work', 'control', 'flexible'];
    const finalSlotPurpose = validPurposes.includes(slotPurpose) ? slotPurpose : null;
    const finalDurationMinutes =
      typeof durationMinutes === 'number' && durationMinutes > 0 ? durationMinutes : null;

    // Default cím érték: "1088 Budapest, Szentkirályi utca 47"
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

    // Validate that start time is in the future
    if (startDate <= now) {
      return NextResponse.json(
        { error: 'Az időpont csak jövőbeli dátum lehet' },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    
    // Get user ID
    // For admin creating time slot, they can specify which user the slot belongs to
    // For fogpótlástanász, the slot always belongs to them
    const bodyUserId = body.userId; // Optional: user ID (UUID)
    const bodyUserEmail = body.userEmail; // Optional: user email
    
    let userId: string;
    
    if (auth.role === 'admin') {
      // Admin can create slot for any user
      if (bodyUserId) {
        // Use provided user ID
        const targetUserResult = await pool.query('SELECT id FROM users WHERE id = $1', [bodyUserId]);
        if (targetUserResult.rows.length === 0) {
          return NextResponse.json(
            { error: 'A megadott felhasználó nem található' },
            { status: 404 }
          );
        }
        userId = targetUserResult.rows[0].id;
      } else if (bodyUserEmail) {
        // Use provided user email
        const targetUserResult = await pool.query('SELECT id FROM users WHERE email = $1', [bodyUserEmail.toLowerCase().trim()]);
        if (targetUserResult.rows.length === 0) {
          return NextResponse.json(
            { error: 'A megadott felhasználó nem található' },
            { status: 404 }
          );
        }
        userId = targetUserResult.rows[0].id;
      } else {
        // Admin didn't specify a user, use their own ID
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
      // Fogpótlástanász: use their own ID
      const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [auth.email]);
      if (userResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Felhasználó nem található' },
          { status: 404 }
        );
      }
      userId = userResult.rows[0].id;
    }

    // Insert time slot (state defaults to 'free'; optional slot_purpose, duration_minutes)
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
  } catch (error) {
    console.error('Error creating time slot:', error);
    return NextResponse.json(
      { error: 'Hiba történt az időpont létrehozásakor' },
      { status: 500 }
    );
  }
}


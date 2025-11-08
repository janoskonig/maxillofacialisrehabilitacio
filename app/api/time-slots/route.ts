import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

// Get all available time slots
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

    // Everyone sees all time slots (available and booked)
    const query = `
      SELECT 
        ats.id,
        ats.start_time as "startTime",
        ats.status,
        ats.created_at as "createdAt",
        ats.updated_at as "updatedAt",
        u.email as "userEmail"
      FROM available_time_slots ats
      JOIN users u ON ats.user_id = u.id
      ORDER BY ats.start_time ASC
    `;
    const params: any[] = [];

    const result = await pool.query(query, params);
    return NextResponse.json({ timeSlots: result.rows });
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
    const { startTime } = body;

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
    // For admin creating time slot, we need to specify which user (fogpótlástanász) the slot belongs to
    // For now, if admin creates, we'll use their own user ID, but ideally they should select a fogpótlástanász
    // For simplicity, admin can create slots for themselves or we can add a user_id parameter
    const bodyUserId = body.userId; // Optional: if admin wants to create slot for a specific fogpótlástanász
    
    let userId: string;
    if (bodyUserId && auth.role === 'admin') {
      // Admin can create slot for a specific user
      const targetUserResult = await pool.query('SELECT id FROM users WHERE id = $1', [bodyUserId]);
      if (targetUserResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'A megadott felhasználó nem található' },
          { status: 404 }
        );
      }
      userId = targetUserResult.rows[0].id;
    } else {
      // Use the current user's ID
      const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [auth.email]);
      if (userResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Felhasználó nem található' },
          { status: 404 }
        );
      }
      userId = userResult.rows[0].id;
    }

    // Insert time slot
    const result = await pool.query(
      `INSERT INTO available_time_slots (user_id, start_time, status)
       VALUES ($1, $2, 'available')
       RETURNING 
         id,
         start_time as "startTime",
         status,
         created_at as "createdAt",
         updated_at as "updatedAt"`,
      [userId, startDate.toISOString()]
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


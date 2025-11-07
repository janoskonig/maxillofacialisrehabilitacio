import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    const userEmail = user?.email || null;

    const body = await request.json();
    const { type, title, description, errorLog, errorStack } = body;

    // Validation
    if (!type || !description) {
      return NextResponse.json(
        { error: 'Type és description kötelező mezők' },
        { status: 400 }
      );
    }

    const validTypes = ['bug', 'error', 'crash', 'suggestion', 'other'];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: 'Érvénytelen type' },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    // Get user agent and URL from request
    const userAgent = request.headers.get('user-agent') || null;
    const referer = request.headers.get('referer') || null;

    // Insert feedback into database
    const result = await pool.query(
      `INSERT INTO feedback (
        user_email, type, title, description, error_log, error_stack, user_agent, url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, created_at`,
      [
        userEmail,
        type,
        title || null,
        description,
        errorLog || null,
        errorStack || null,
        userAgent,
        referer,
      ]
    );

    return NextResponse.json(
      {
        success: true,
        id: result.rows[0].id,
        createdAt: result.rows[0].created_at,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Error submitting feedback:', error);
    return NextResponse.json(
      { error: 'Hiba történt a visszajelzés küldésekor' },
      { status: 500 }
    );
  }
}

// GET endpoint for admins to view feedback (optional)
export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    
    if (!user || user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Nincs jogosultság' },
        { status: 403 }
      );
    }

    const pool = getDbPool();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // null means all statuses
    const limit = parseInt(searchParams.get('limit') || '100');

    let query = `
      SELECT id, user_email, type, title, description, error_log, error_stack, 
             user_agent, url, status, created_at, updated_at
      FROM feedback
    `;
    const params: any[] = [];
    let paramIndex = 1;
    
    if (status) {
      query += ` WHERE status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await pool.query(query, params);

    return NextResponse.json({ feedback: result.rows });
  } catch (error: any) {
    console.error('Error fetching feedback:', error);
    return NextResponse.json(
      { error: 'Hiba történt a visszajelzések lekérdezésekor' },
      { status: 500 }
    );
  }
}


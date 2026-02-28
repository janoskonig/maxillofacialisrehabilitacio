import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { optionalAuthHandler, roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const POST = optionalAuthHandler(async (req, { correlationId, auth }) => {
  const userEmail = auth?.email || null;

  const body = await req.json();
  const { type, title, description, errorLog, errorStack } = body;

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

  const userAgent = req.headers.get('user-agent') || null;
  const referer = req.headers.get('referer') || null;

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
});

export const GET = roleHandler(['admin'], async (req, { correlationId, auth }) => {
  const pool = getDbPool();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
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
});

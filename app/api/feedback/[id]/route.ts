import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const PUT = roleHandler(['admin'], async (req, { auth, params }) => {
  const { id } = params;
  const body = await req.json();
  const { status } = body;

  const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
  if (!status || !validStatuses.includes(status)) {
    return NextResponse.json(
      { error: 'Érvénytelen status' },
      { status: 400 }
    );
  }

  const pool = getDbPool();

  const result = await pool.query(
    `UPDATE feedback 
     SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING id, status, updated_at`,
    [status, id]
  );

  if (result.rows.length === 0) {
    return NextResponse.json(
      { error: 'Feedback nem található' },
      { status: 404 }
    );
  }

  return NextResponse.json({ 
    success: true,
    feedback: result.rows[0]
  });
});

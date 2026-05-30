import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (_req, { auth }) => {
  const pool = getDbPool();
  const userResult = await pool.query(
    'SELECT email, role, active, restricted_view, intezmeny, doktor_neve FROM users WHERE id = $1',
    [auth.userId]
  );

  if (userResult.rows.length === 0 || !userResult.rows[0].active) {
    return NextResponse.json(
      { error: 'Felhasználó nem található vagy inaktív' },
      { status: 401 }
    );
  }

  return NextResponse.json({
    user: {
      id: auth.userId,
      email: userResult.rows[0].email,
      role: userResult.rows[0].role,
      restrictedView: userResult.rows[0].restricted_view || false,
      intezmeny: userResult.rows[0].intezmeny || null,
      name: userResult.rows[0].doktor_neve || null,
    },
  });
});

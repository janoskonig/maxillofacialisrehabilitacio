import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const POST = authedHandler(async (req, { auth }) => {
  const body = await req.json();
  const { endpoint } = body;

  if (!endpoint) {
    return NextResponse.json(
      { error: 'Hiányzó endpoint' },
      { status: 400 }
    );
  }

  const pool = getDbPool();

  await pool.query(
    'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
    [auth.userId, endpoint]
  );

  return NextResponse.json({ success: true });
});

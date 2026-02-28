import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const pool = getDbPool();
  let dbOk = false;

  try {
    await pool.query('SELECT 1');
    dbOk = true;
  } catch {
    // DB unreachable
  }

  const body = {
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk,
    uptime: process.uptime(),
    pool: {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    },
  };

  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}

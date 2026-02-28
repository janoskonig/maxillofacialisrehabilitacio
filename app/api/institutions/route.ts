import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { apiHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (_req, { correlationId }) => {
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT DISTINCT intezmeny 
     FROM users 
     WHERE intezmeny IS NOT NULL AND intezmeny != ''
     ORDER BY intezmeny ASC`
  );

  const institutions = result.rows.map(row => row.intezmeny);

  return NextResponse.json({ institutions });
});

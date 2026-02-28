import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  const pool = getDbPool();
  
  const result = await pool.query(
    `SELECT 
      id,
      email,
      doktor_neve,
      role,
      active,
      intezmeny
     FROM users
     WHERE (role = 'fogpótlástanász' OR role = 'admin') AND active = true
     ORDER BY COALESCE(doktor_neve, email) ASC`
  );

  const users = result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.doktor_neve || row.email,
    displayName: row.doktor_neve || row.email,
    intezmeny: row.intezmeny || null,
  }));

  return NextResponse.json({ users });
});

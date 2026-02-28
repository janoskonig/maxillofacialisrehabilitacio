import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  const { searchParams } = new URL(req.url);
  const doctorName = searchParams.get('name');
  
  if (!doctorName) {
    return NextResponse.json(
      { error: 'Orvos neve megadása kötelező' },
      { status: 400 }
    );
  }

  const pool = getDbPool();
  
  const result = await pool.query(
    `SELECT 
      doktor_neve,
      intezmeny
     FROM users
     WHERE doktor_neve ILIKE $1 AND intezmeny IS NOT NULL AND intezmeny != ''
     ORDER BY doktor_neve ASC
     LIMIT 1`,
    [`%${doctorName}%`]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ intezmeny: null });
  }

  return NextResponse.json({ 
    intezmeny: result.rows[0].intezmeny,
    doktor_neve: result.rows[0].doktor_neve
  });
});

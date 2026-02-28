import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  const searchParams = req.nextUrl.searchParams;
  const institution = searchParams.get('institution');

  if (!institution) {
    return NextResponse.json(
      { error: 'Intézmény megadása kötelező' },
      { status: 400 }
    );
  }

  const pool = getDbPool();
  
  const result = await pool.query(
    `SELECT id, email, doktor_neve, intezmeny
     FROM users
     WHERE intezmeny = $1
       AND doktor_neve IS NOT NULL 
       AND doktor_neve != ''
       AND active = true
       AND (role IN ('sebészorvos', 'fogpótlástanász', 'admin') OR doktor_neve IS NOT NULL)
     ORDER BY doktor_neve ASC`,
    [institution]
  );

  const doctors = result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.doktor_neve,
    intezmeny: row.intezmeny || null,
  }));

  return NextResponse.json({ doctors });
});

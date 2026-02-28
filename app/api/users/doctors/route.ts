import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  const pool = getDbPool();
  const forSlotPicker = req.nextUrl.searchParams.get('forSlotPicker') === '1';

  const roleCondition = forSlotPicker
    ? `AND role IN ('admin', 'fogpótlástanász')`
    : `AND (role IN ('sebészorvos', 'fogpótlástanász', 'admin') OR doktor_neve IS NOT NULL)`;
  const result = await pool.query(
    `SELECT DISTINCT id, email, doktor_neve, intezmeny
     FROM users
     WHERE doktor_neve IS NOT NULL 
       AND doktor_neve != ''
       AND active = true
       ${roleCondition}
     ORDER BY doktor_neve ASC`
  );

  const doctors = result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.doktor_neve,
    intezmeny: row.intezmeny || null,
  }));

  return NextResponse.json({ doctors });
});

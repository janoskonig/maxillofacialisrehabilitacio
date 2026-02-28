import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { apiHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const POST = apiHandler(async (req, { correlationId }) => {
  const body = await req.json();
  const { email, taj } = body;

  if (!email || !taj) {
    return NextResponse.json(
      { error: 'Email cím és TAJ szám megadása kötelező' },
      { status: 400 }
    );
  }

  const cleanTaj = taj.replace(/[-\s]/g, '');

  if (!/^\d{9}$/.test(cleanTaj)) {
    return NextResponse.json(
      { error: 'Érvénytelen TAJ szám formátum' },
      { status: 400 }
    );
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return NextResponse.json(
      { error: 'Érvénytelen email cím formátum' },
      { status: 400 }
    );
  }

  const pool = getDbPool();

  const patientResult = await pool.query(
    `SELECT id, email, nev, taj 
     FROM patients 
     WHERE REPLACE(REPLACE(taj, '-', ''), ' ', '') = $1`,
    [cleanTaj]
  );

  return NextResponse.json({
    exists: patientResult.rows.length > 0,
  });
});

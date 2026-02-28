import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * Check if patient exists
 * POST /api/patient-portal/auth/check-patient
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, taj } = body;

    if (!email || !taj) {
      return NextResponse.json(
        { error: 'Email cím és TAJ szám megadása kötelező' },
        { status: 400 }
      );
    }

    // Clean TAJ (remove dashes and spaces)
    const cleanTaj = taj.replace(/[-\s]/g, '');

    // Validate TAJ format (9 digits)
    if (!/^\d{9}$/.test(cleanTaj)) {
      return NextResponse.json(
        { error: 'Érvénytelen TAJ szám formátum' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json(
        { error: 'Érvénytelen email cím formátum' },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    // Find patient by TAJ only (one profile per TAJ; email may vary)
    const patientResult = await pool.query(
      `SELECT id, email, nev, taj 
       FROM patients 
       WHERE REPLACE(REPLACE(taj, '-', ''), ' ', '') = $1`,
      [cleanTaj]
    );

    return NextResponse.json({
      exists: patientResult.rows.length > 0,
    });
  } catch (error) {
    logger.error('Error checking patient:', error);
    return NextResponse.json(
      { error: 'Hiba történt a beteg ellenőrzésekor' },
      { status: 500 }
    );
  }
}

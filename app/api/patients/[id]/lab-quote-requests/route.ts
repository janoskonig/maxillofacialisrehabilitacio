import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { labQuoteRequestSchema } from '@/lib/types';
import { logger } from '@/lib/logger';

/**
 * Árajánlatkérő lekérdezése beteghez
 */
export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { params }) => {
  const pool = getDbPool();
  const patientId = params.id;

  // Ellenőrizzük, hogy a beteg létezik-e
  const patientCheck = await pool.query(
    'SELECT id FROM patients WHERE id = $1',
    [patientId]
  );

  if (patientCheck.rows.length === 0) {
    return NextResponse.json(
      { error: 'Beteg nem található' },
      { status: 404 }
    );
  }

  // Árajánlatkérők lekérdezése
  const result = await pool.query(
    `SELECT 
        lqr.id,
        lqr.patient_id as "patientId",
        lqr.szoveg,
        lqr.datuma,
        lqr.created_at as "createdAt",
        lqr.updated_at as "updatedAt",
        lqr.created_by as "createdBy",
        lqr.updated_by as "updatedBy",
        el.status as "lastEmailStatus",
        el.created_at as "lastEmailSentAt",
        el.sent_by as "lastEmailSentBy",
        el.error_message as "lastEmailError"
      FROM lab_quote_requests lqr
      LEFT JOIN LATERAL (
        SELECT status, created_at, sent_by, error_message
        FROM outbound_email_log
        WHERE email_type = 'lab_quote'
          AND metadata->>'quoteId' = lqr.id::text
        ORDER BY created_at DESC
        LIMIT 1
      ) el ON true
      WHERE lqr.patient_id = $1
      ORDER BY lqr.created_at DESC`,
    [patientId]
  );

  return NextResponse.json({ quoteRequests: result.rows }, { status: 200 });
});

/**
 * Új árajánlatkérő létrehozása
 */
export const POST = authedHandler(async (req, { auth, params }) => {
  // Jogosultság ellenőrzése
  if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász' && auth.role !== 'beutalo_orvos' && auth.role !== 'technikus') {
    return NextResponse.json(
      { error: 'Nincs jogosultsága árajánlatkérő létrehozásához' },
      { status: 403 }
    );
  }

  const pool = getDbPool();
  const patientId = params.id;
  const userEmail = auth.email;

  // Ellenőrizzük, hogy a beteg létezik-e
  const patientCheck = await pool.query(
    'SELECT id FROM patients WHERE id = $1',
    [patientId]
  );

  if (patientCheck.rows.length === 0) {
    return NextResponse.json(
      { error: 'Beteg nem található' },
      { status: 404 }
    );
  }

  const body = await req.json();
  try {
    const validatedData = labQuoteRequestSchema.parse({
      ...body,
      patientId,
    });

    // Új árajánlatkérő létrehozása
    const result = await pool.query(
      `INSERT INTO lab_quote_requests (
          patient_id, szoveg, datuma, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING 
          id,
          patient_id as "patientId",
          szoveg,
          datuma,
          created_at as "createdAt",
          updated_at as "updatedAt",
          created_by as "createdBy",
          updated_by as "updatedBy"`,
      [
        patientId,
        validatedData.szoveg,
        validatedData.datuma,
        userEmail,
        userEmail,
      ]
    );

    return NextResponse.json({ quoteRequest: result.rows[0] }, { status: 201 });
  } catch (error) {
    logger.error('Hiba az árajánlatkérő létrehozásakor:', error);
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json(
        { error: 'Érvénytelen adatok', details: error },
        { status: 400 }
      );
    }
    throw error;
  }
});

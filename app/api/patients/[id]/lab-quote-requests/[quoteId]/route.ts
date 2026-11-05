import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { labQuoteRequestSchema } from '@/lib/types';
import { logger } from '@/lib/logger';

/**
 * Árajánlatkérő frissítése
 */
export const dynamic = 'force-dynamic';

export const PUT = authedHandler(async (req, { auth, params }) => {
  // Jogosultság ellenőrzése
  if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász' && auth.role !== 'beutalo_orvos' && auth.role !== 'technikus') {
    return NextResponse.json(
      { error: 'Nincs jogosultsága árajánlatkérő módosításához' },
      { status: 403 }
    );
  }

  const pool = getDbPool();
  const patientId = params.id;
  const quoteId = params.quoteId;
  const userEmail = auth.email;

  const body = await req.json();
  try {
    const validatedData = labQuoteRequestSchema.parse({
      ...body,
      patientId,
      id: quoteId,
    });

    // Árajánlatkérő frissítése
    const result = await pool.query(
      `UPDATE lab_quote_requests lqr
      SET szoveg = $1, datuma = $2, updated_at = CURRENT_TIMESTAMP, updated_by = $3
      WHERE id = $4 AND patient_id = $5
        AND NOT EXISTS (
          SELECT 1
          FROM outbound_email_log sent_email
          WHERE sent_email.email_type = 'lab_quote'
            AND sent_email.status = 'sent'
            AND sent_email.metadata->>'quoteId' = lqr.id::text
        )
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
        validatedData.szoveg,
        validatedData.datuma,
        userEmail,
        quoteId,
        patientId,
      ]
    );

    if (result.rows.length === 0) {
      const quoteCheck = await pool.query(
        'SELECT id FROM lab_quote_requests WHERE id = $1 AND patient_id = $2',
        [quoteId, patientId]
      );

      if (quoteCheck.rows.length > 0) {
        return NextResponse.json(
          { error: 'Az árajánlatkérő már el lett küldve, ezért nem szerkeszthető' },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: 'Árajánlatkérő nem található' },
        { status: 404 }
      );
    }

    return NextResponse.json({ quoteRequest: result.rows[0] }, { status: 200 });
  } catch (error) {
    logger.error('Hiba az árajánlatkérő frissítésekor:', error);
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json(
        { error: 'Érvénytelen adatok', details: error },
        { status: 400 }
      );
    }
    throw error;
  }
});

/**
 * Árajánlatkérő törlése
 */
export const DELETE = authedHandler(async (req, { auth, params }) => {
  if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász') {
    return NextResponse.json(
      { error: 'Nincs jogosultsága árajánlatkérő törléséhez' },
      { status: 403 }
    );
  }

  const pool = getDbPool();
  const patientId = params.id;
  const quoteId = params.quoteId;

  const result = await pool.query(
    'DELETE FROM lab_quote_requests WHERE id = $1 AND patient_id = $2 RETURNING id',
    [quoteId, patientId]
  );

  if (result.rows.length === 0) {
    return NextResponse.json(
      { error: 'Árajánlatkérő nem található' },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true }, { status: 200 });
});

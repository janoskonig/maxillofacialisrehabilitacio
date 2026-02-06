import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { labQuoteRequestSchema } from '@/lib/types';

/**
 * Árajánlatkérő frissítése
 */
export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; quoteId: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    // Jogosultság ellenőrzése
    if (auth.role !== 'admin' && auth.role !== 'editor' && auth.role !== 'sebészorvos') {
      return NextResponse.json(
        { error: 'Nincs jogosultsága árajánlatkérő módosításához' },
        { status: 403 }
      );
    }

    const pool = getDbPool();
    const patientId = params.id;
    const quoteId = params.quoteId;
    const userEmail = auth.email;

    const body = await request.json();
    const validatedData = labQuoteRequestSchema.parse({
      ...body,
      patientId,
      id: quoteId,
    });

    // Árajánlatkérő frissítése
    const result = await pool.query(
      `UPDATE lab_quote_requests
      SET szoveg = $1, datuma = $2, updated_at = CURRENT_TIMESTAMP, updated_by = $3
      WHERE id = $4 AND patient_id = $5
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
      return NextResponse.json(
        { error: 'Árajánlatkérő nem található' },
        { status: 404 }
      );
    }

    return NextResponse.json({ quoteRequest: result.rows[0] }, { status: 200 });
  } catch (error) {
    console.error('Hiba az árajánlatkérő frissítésekor:', error);
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json(
        { error: 'Érvénytelen adatok', details: error },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: 'Hiba történt az árajánlatkérő frissítésekor' },
      { status: 500 }
    );
  }
}

/**
 * Árajánlatkérő törlése
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; quoteId: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    // Jogosultság ellenőrzése - csak admin és editor
    if (auth.role !== 'admin' && auth.role !== 'editor') {
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
  } catch (error) {
    console.error('Hiba az árajánlatkérő törlésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az árajánlatkérő törlésekor' },
      { status: 500 }
    );
  }
}


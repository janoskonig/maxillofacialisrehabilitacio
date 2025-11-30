import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { labQuoteRequestSchema, LabQuoteRequest } from '@/lib/types';

/**
 * Árajánlatkérő lekérdezése beteghez
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

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
        id,
        patient_id as "patientId",
        szoveg,
        datuma,
        created_at as "createdAt",
        updated_at as "updatedAt",
        created_by as "createdBy",
        updated_by as "updatedBy"
      FROM lab_quote_requests
      WHERE patient_id = $1
      ORDER BY created_at DESC`,
      [patientId]
    );

    return NextResponse.json({ quoteRequests: result.rows }, { status: 200 });
  } catch (error) {
    console.error('Hiba az árajánlatkérők lekérdezésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az árajánlatkérők lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * Új árajánlatkérő létrehozása
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
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

    const body = await request.json();
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
    console.error('Hiba az árajánlatkérő létrehozásakor:', error);
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json(
        { error: 'Érvénytelen adatok', details: error },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: 'Hiba történt az árajánlatkérő létrehozásakor' },
      { status: 500 }
    );
  }
}


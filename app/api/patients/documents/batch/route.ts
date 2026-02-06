import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

// Batch lekérdezés a dokumentumok számához beteg ID-k alapján
// Optimalizálás: egyetlen lekérdezésben visszaadja az összes beteg dokumentumszámát
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { patientIds } = body;

    if (!Array.isArray(patientIds) || patientIds.length === 0) {
      return NextResponse.json({ 
        opDocuments: {},
        fotoDocuments: {}
      }, { status: 200 });
    }

    const pool = getDbPool();

    // OP dokumentumok száma beteg ID szerint
    const opQuery = `
      SELECT 
        patient_id as "patientId",
        COUNT(*) as count
      FROM patient_documents
      WHERE patient_id = ANY($1::uuid[])
        AND (
          tags @> '["orthopantomogram"]'::jsonb
          OR tags @> '["OP"]'::jsonb
          OR tags::text ILIKE '%orthopantomogram%'
          OR tags::text ILIKE '%"OP"%'
        )
      GROUP BY patient_id
    `;

    // Foto dokumentumok száma beteg ID szerint
    const fotoQuery = `
      SELECT 
        patient_id as "patientId",
        COUNT(*) as count
      FROM patient_documents
      WHERE patient_id = ANY($1::uuid[])
        AND (
          tags @> '["foto"]'::jsonb
          OR tags::text ILIKE '%"foto"%'
          OR tags::text ILIKE '%foto%'
        )
      GROUP BY patient_id
    `;

    const [opResult, fotoResult] = await Promise.all([
      pool.query(opQuery, [patientIds]),
      pool.query(fotoQuery, [patientIds])
    ]);

    // Csoportosítás beteg ID szerint
    const opDocuments: Record<string, number> = {};
    const fotoDocuments: Record<string, number> = {};

    opResult.rows.forEach((row: { patientId: string; count: string }) => {
      opDocuments[row.patientId] = parseInt(row.count, 10);
    });

    fotoResult.rows.forEach((row: { patientId: string; count: string }) => {
      fotoDocuments[row.patientId] = parseInt(row.count, 10);
    });

    return NextResponse.json({ 
      opDocuments,
      fotoDocuments
    }, { status: 200 });
  } catch (error) {
    console.error('Error fetching batch documents:', error);
    return NextResponse.json(
      { error: 'Hiba történt a dokumentumok lekérdezésekor' },
      { status: 500 }
    );
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { generateLabQuoteRequestPDF } from '@/lib/pdf/lab-quote-request';
import { Patient, patientSchema, LabQuoteRequest } from '@/lib/types';

/**
 * Árajánlatkérő PDF generálása beteg adataiból
 * Query paraméter: quoteId - az árajánlatkérő ID-ja
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Hitelesítés ellenőrzése
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    // Jogosultság ellenőrzése - csak admin, editor és sebészorvos
    if (auth.role !== 'admin' && auth.role !== 'editor' && auth.role !== 'sebészorvos') {
      return NextResponse.json(
        { error: 'Nincs jogosultsága PDF generáláshoz' },
        { status: 403 }
      );
    }

    const pool = getDbPool();
    const patientId = params.id;
    const searchParams = request.nextUrl.searchParams;
    const quoteId = searchParams.get('quoteId');

    if (!quoteId) {
      return NextResponse.json(
        { error: 'quoteId query paraméter kötelező' },
        { status: 400 }
      );
    }

    // Beteg adatainak lekérdezése
    const patientResult = await pool.query(
      `SELECT 
        id, nev, taj, telefonszam, szuletesi_datum as "szuletesiDatum", nem,
        email, cim, varos, iranyitoszam, kezeleoorvos
      FROM patients
      WHERE id = $1`,
      [patientId]
    );

    if (patientResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    // Árajánlatkérő lekérdezése
    const quoteResult = await pool.query(
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
      WHERE id = $1 AND patient_id = $2`,
      [quoteId, patientId]
    );

    if (quoteResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Árajánlatkérő nem található' },
        { status: 404 }
      );
    }

    const patientData = patientResult.rows[0];
    const quoteData = quoteResult.rows[0];
    
    // Konvertáljuk a dátum mezőket string formátumba
    const normalizedPatientData = {
      ...patientData,
      szuletesiDatum: patientData.szuletesiDatum 
        ? (patientData.szuletesiDatum instanceof Date 
            ? patientData.szuletesiDatum.toISOString().split('T')[0]
            : String(patientData.szuletesiDatum))
        : null,
    };
    
    const normalizedQuoteData = {
      ...quoteData,
      datuma: quoteData.datuma 
        ? (quoteData.datuma instanceof Date 
            ? quoteData.datuma.toISOString().split('T')[0]
            : String(quoteData.datuma))
        : null,
    };
    
    // Validáljuk az adatokat
    const patient = patientSchema.parse(normalizedPatientData) as Patient;
    const quoteRequest = normalizedQuoteData as LabQuoteRequest;

    // PDF generálása
    const pdfBuffer = await generateLabQuoteRequestPDF(patient, quoteRequest);

    // Fájlnév generálása
    const patientName = patient.nev || 'Beteg';
    const sanitizedName = patientName.replace(/[^a-zA-Z0-9áéíóöőúüűÁÉÍÓÖŐÚÜŰ\s]/g, '').trim().replace(/\s+/g, '_');
    const filename = `Arajanlatkero_${sanitizedName}_${Date.now()}.pdf`;

    // PDF válasz visszaadása
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('Hiba a PDF generálása során:', error);
    return NextResponse.json(
      { 
        error: 'Hiba történt a PDF generálása során',
        details: error instanceof Error ? error.message : 'Ismeretlen hiba'
      },
      { status: 500 }
    );
  }
}


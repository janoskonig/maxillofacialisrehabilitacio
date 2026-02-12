import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { generateEquityRequestPDF } from '@/lib/pdf/equity-request';
import { Patient, patientSchema } from '@/lib/types';
import { patientSelectSql, normalizePatientRow } from '@/lib/patient-select';
import { uploadFile, isFtpConfigured, generateDocumentFilename } from '@/lib/ftp-client';
import { logActivity } from '@/lib/activity';

/**
 * Méltányossági kérelem PDF generálása beteg adataiból
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

    // Beteg adatainak lekérdezése (közös patient SELECT – lib/patient-select)
    const result = await pool.query(patientSelectSql(), [patientId]);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    const patientData = result.rows[0];
    
    // Normalizáljuk a dátum mezőket string formátumba (PostgreSQL Date objektumokat ad vissza)
    // Ez kezeli az összes dátum mezőt, beleértve a createdAt-et is
    const normalizedPatientData = normalizePatientRow(patientData);
    
    // Validáljuk a beteg adatait a schema szerint
    const patient = patientSchema.parse(normalizedPatientData) as Patient;

    // PDF generálása
    const pdfBuffer = await generateEquityRequestPDF(patient);

    // Fájlnév generálása
    const patientName = patient.nev || 'Beteg';
    const sanitizedName = patientName.replace(/[^a-zA-Z0-9áéíóöőúüűÁÉÍÓÖŐÚÜŰ\s]/g, '').trim().replace(/\s+/g, '_');
    const filename = `Meltanyossagi_kerelm_${sanitizedName}_${Date.now()}.pdf`;

    // Feltöltés szerverre "méltányossági" tag-gel, ha FTP konfigurálva van
    if (isFtpConfigured()) {
      try {
        const tags = ['méltányossági'];
        const uploadFilename = generateDocumentFilename(
          filename,
          tags,
          patientId,
          new Date()
        );
        
        // Feltöltés FTP-re
        const filePath = await uploadFile(patientId, pdfBuffer, uploadFilename);
        
        // Mentés adatbázisba
        const tagsJsonb = JSON.stringify(tags);
        await pool.query(
          `INSERT INTO patient_documents (
            patient_id, filename, file_path, file_size, mime_type,
            description, tags, uploaded_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [
            patientId,
            uploadFilename,
            filePath,
            pdfBuffer.length,
            'application/pdf',
            'Méltányossági kérelem PDF',
            tagsJsonb,
            auth.email
          ]
        );

        // Activity logging
        await logActivity(
          request,
          auth.email,
          'patient_document_uploaded',
          `Patient ID: ${patientId}, Document: ${uploadFilename}, Type: Méltányossági kérelem, Size: ${pdfBuffer.length} bytes`
        );
      } catch (uploadError) {
        // Ha a feltöltés sikertelen, csak logoljuk, de ne akadályozzuk meg a PDF letöltését
        console.error('Hiba a PDF feltöltésekor:', uploadError);
        // Folytatjuk a PDF visszaadásával
      }
    }

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
    const err = error instanceof Error ? error : new Error(String(error));
    const errorMessage = err.message;
    const errorStack = err.stack;
    const details = (err as Error & { details?: unknown }).details;

    console.error('Hiba a PDF generálása során:', errorMessage);
    if (details) console.error('PDF hiba részletek (log):', JSON.stringify(details));
    if (process.env.NODE_ENV === 'development' && errorStack) console.error('Stack:', errorStack);

    return NextResponse.json(
      {
        error: 'Hiba történt a PDF generálása során',
        details: errorMessage,
        ...(process.env.NODE_ENV === 'development' && errorStack ? { stack: errorStack } : {}),
      },
      { status: 500 }
    );
  }
}


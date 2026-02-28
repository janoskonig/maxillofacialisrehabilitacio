import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { generateDentalStatusPDF } from '@/lib/pdf/generateDentalStatusPDF';
import { logger } from '@/lib/logger';

/**
 * Export patient dental status as PDF
 * GET /api/patients/[id]/dental-status-export
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Authentication required
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    const patientId = params.id;

    // Get patient data with dental status information
    // Use a client to ensure proper connection handling
    const client = await pool.connect();
    let patient;
    
    try {
      const result = await client.query(
        `SELECT 
          id,
          nev,
          taj,
          meglevo_fogak as "meglevoFogak",
          felso_fogpotlas_van as "felsoFogpotlasVan",
          felso_fogpotlas_mikor as "felsoFogpotlasMikor",
          felso_fogpotlas_keszito as "felsoFogpotlasKeszito",
          felso_fogpotlas_elegedett as "felsoFogpotlasElegedett",
          felso_fogpotlas_problema as "felsoFogpotlasProblema",
          felso_fogpotlas_tipus as "felsoFogpotlasTipus",
          fabian_fejerdy_protetikai_osztaly_felso as "fabianFejerdyProtetikaiOsztalyFelso",
          also_fogpotlas_van as "alsoFogpotlasVan",
          also_fogpotlas_mikor as "alsoFogpotlasMikor",
          also_fogpotlas_keszito as "alsoFogpotlasKeszito",
          also_fogpotlas_elegedett as "alsoFogpotlasElegedett",
          also_fogpotlas_problema as "alsoFogpotlasProblema",
          also_fogpotlas_tipus as "alsoFogpotlasTipus",
          fabian_fejerdy_protetikai_osztaly_also as "fabianFejerdyProtetikaiOsztalyAlso",
          meglevo_implantatumok as "meglevoImplantatumok",
          nem_ismert_poziciokban_implantatum as "nemIsmertPoziciokbanImplantatum",
          nem_ismert_poziciokban_implantatum_reszletek as "nemIsmertPoziciokbanImplantatumRészletek"
        FROM patients
        WHERE id = $1`,
        [patientId]
      );

      if (result.rows.length === 0) {
        return NextResponse.json(
          { error: 'Beteg nem található' },
          { status: 404 }
        );
      }

      patient = result.rows[0];
    } finally {
      // Release the client immediately after query, before PDF generation
      client.release();
    }

    // Generate PDF (this can take time, so we do it after releasing the DB connection)
    const pdfBuffer = await generateDentalStatusPDF(patient);

    // Return PDF - convert Buffer to Uint8Array for NextResponse
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="fogazati-status-${patientId}.pdf"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    logger.error('Hiba a PDF generálásakor:', error);
    const errorMessage = error instanceof Error ? error.message : 'Ismeretlen hiba';
    return NextResponse.json(
      { error: `Hiba történt a PDF generálásakor: ${errorMessage}` },
      { status: 500 }
    );
  }
}


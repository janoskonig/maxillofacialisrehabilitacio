import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { generateDentalStatusPDF } from '@/lib/pdf/generateDentalStatusPDF';

/**
 * Export patient dental status as PDF
 * GET /api/patients/[id]/dental-status-export
 */
export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;

  // Get patient data with dental status information
  // Use a client to ensure proper connection handling
  const client = await pool.connect();
  let patient;

  try {
    const result = await client.query(
      `SELECT 
          p.id,
          p.nev,
          p.taj,
          d.meglevo_fogak as "meglevoFogak",
          d.felso_fogpotlas_van as "felsoFogpotlasVan",
          d.felso_fogpotlas_mikor as "felsoFogpotlasMikor",
          d.felso_fogpotlas_keszito as "felsoFogpotlasKeszito",
          d.felso_fogpotlas_elegedett as "felsoFogpotlasElegedett",
          d.felso_fogpotlas_problema as "felsoFogpotlasProblema",
          d.felso_fogpotlas_tipus as "felsoFogpotlasTipus",
          a.fabian_fejerdy_protetikai_osztaly_felso as "fabianFejerdyProtetikaiOsztalyFelso",
          d.also_fogpotlas_van as "alsoFogpotlasVan",
          d.also_fogpotlas_mikor as "alsoFogpotlasMikor",
          d.also_fogpotlas_keszito as "alsoFogpotlasKeszito",
          d.also_fogpotlas_elegedett as "alsoFogpotlasElegedett",
          d.also_fogpotlas_problema as "alsoFogpotlasProblema",
          d.also_fogpotlas_tipus as "alsoFogpotlasTipus",
          a.fabian_fejerdy_protetikai_osztaly_also as "fabianFejerdyProtetikaiOsztalyAlso",
          d.meglevo_implantatumok as "meglevoImplantatumok",
          d.nem_ismert_poziciokban_implantatum as "nemIsmertPoziciokbanImplantatum",
          d.nem_ismert_poziciokban_implantatum_reszletek as "nemIsmertPoziciokbanImplantatumRészletek"
        FROM patients p
        LEFT JOIN patient_dental_status d ON d.patient_id = p.id
        LEFT JOIN patient_anamnesis a ON a.patient_id = p.id
        WHERE p.id = $1`,
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
});


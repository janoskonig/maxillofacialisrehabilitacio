import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { logger } from '@/lib/logger';

// Get OP-tagged documents for quick access
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

    // Verify patient exists
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

    // Role-based access control (same as patient view)
    const role = auth.role;
    const userEmail = auth.email;

    if (role === 'technikus') {
      const patientResult = await pool.query(
        `SELECT kezelesi_terv_arcot_erinto FROM patients WHERE id = $1`,
        [patientId]
      );
      const hasEpitesis = patientResult.rows[0]?.kezelesi_terv_arcot_erinto && 
                          Array.isArray(patientResult.rows[0].kezelesi_terv_arcot_erinto) && 
                          patientResult.rows[0].kezelesi_terv_arcot_erinto.length > 0;
      if (!hasEpitesis) {
        return NextResponse.json(
          { error: 'Nincs jogosultsága ehhez a beteghez' },
          { status: 403 }
        );
      }
    } else if (role === 'sebészorvos' && userEmail) {
      const userResult = await pool.query(
        `SELECT intezmeny FROM users WHERE email = $1`,
        [userEmail]
      );
      if (userResult.rows.length > 0 && userResult.rows[0].intezmeny) {
        const userInstitution = userResult.rows[0].intezmeny;
        const patientResult = await pool.query(
          `SELECT beutalo_intezmeny FROM patients WHERE id = $1`,
          [patientId]
        );
        if (patientResult.rows[0]?.beutalo_intezmeny !== userInstitution) {
          return NextResponse.json(
            { error: 'Nincs jogosultsága ehhez a beteghez' },
            { status: 403 }
          );
        }
      } else {
        return NextResponse.json(
          { error: 'Nincs jogosultsága ehhez a beteghez' },
          { status: 403 }
        );
      }
    }

    // Get OP-tagged documents (tags containing "orthopantomogram" or "OP")
    const result = await pool.query(
      `SELECT 
        id,
        patient_id as "patientId",
        filename,
        file_path as "filePath",
        file_size as "fileSize",
        mime_type as "mimeType",
        description,
        tags,
        uploaded_by as "uploadedBy",
        uploaded_at as "uploadedAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM patient_documents
      WHERE patient_id = $1
        AND (
          tags @> '["orthopantomogram"]'::jsonb
          OR tags @> '["OP"]'::jsonb
          OR tags::text ILIKE '%orthopantomogram%'
          OR tags::text ILIKE '%"OP"%'
        )
      ORDER BY uploaded_at DESC`,
      [patientId]
    );

    return NextResponse.json({ documents: result.rows }, { status: 200 });
  } catch (error) {
    logger.error('Hiba az OP dokumentumok lekérdezésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az OP dokumentumok lekérdezésekor' },
      { status: 500 }
    );
  }
}


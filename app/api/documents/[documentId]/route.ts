import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { apiHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

/**
 * Get document by ID
 * GET /api/documents/[documentId]
 */
export const GET = apiHandler(async (req, { params }) => {
  const documentId = params.documentId;
  const pool = getDbPool();

  let patientId: string | null = null;
  let isAuthorized = false;

  try {
    const patientIdFromSession = await verifyPatientPortalSession(req);
    if (patientIdFromSession) {
      patientId = patientIdFromSession;
      isAuthorized = true;
    }
  } catch {
    // Not a patient portal session, try doctor auth
  }

  if (!isAuthorized) {
    try {
      const auth = await verifyAuth(req);
      if (auth) {
        isAuthorized = true;
      }
    } catch {
      // Not authenticated
    }
  }

  if (!isAuthorized) {
    return NextResponse.json(
      { error: 'Bejelentkezés szükséges' },
      { status: 401 }
    );
  }

  const result = await pool.query(
    `SELECT 
      pd.id,
      pd.patient_id as "patientId",
      pd.filename,
      pd.file_path as "filePath",
      pd.file_size as "fileSize",
      pd.mime_type as "mimeType",
      pd.description,
      pd.tags,
      pd.uploaded_by as "uploadedBy",
      COALESCE(
        u.doktor_neve,
        p.nev,
        u_by_id.doktor_neve,
        p_by_id.nev,
        pd.uploaded_by
      ) as "uploadedByName",
      pd.uploaded_at as "uploadedAt",
      pd.created_at as "createdAt"
    FROM patient_documents pd
    LEFT JOIN users u ON u.email = pd.uploaded_by
    LEFT JOIN patients p ON p.email = pd.uploaded_by
    LEFT JOIN users u_by_id ON pd.uploaded_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND u_by_id.id::text = pd.uploaded_by
    LEFT JOIN patients p_by_id ON pd.uploaded_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND p_by_id.id::text = pd.uploaded_by
    WHERE pd.id = $1`,
    [documentId]
  );

  if (result.rows.length === 0) {
    return NextResponse.json(
      { error: 'Dokumentum nem található' },
      { status: 404 }
    );
  }

  const document = result.rows[0];

  if (patientId && document.patientId !== patientId) {
    return NextResponse.json(
      { error: 'Nincs jogosultsága ehhez a dokumentumhoz' },
      { status: 403 }
    );
  }

  if (!patientId) {
    const auth = await verifyAuth(req);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const role = auth.role;
    const userEmail = auth.email;

    if (role === 'technikus') {
      const patientResult = await pool.query(
        `SELECT kezelesi_terv_arcot_erinto FROM patients WHERE id = $1`,
        [document.patientId]
      );
      const hasEpitesis = patientResult.rows[0]?.kezelesi_terv_arcot_erinto && 
                          Array.isArray(patientResult.rows[0].kezelesi_terv_arcot_erinto) && 
                          patientResult.rows[0].kezelesi_terv_arcot_erinto.length > 0;
      if (!hasEpitesis) {
        return NextResponse.json(
          { error: 'Nincs jogosultsága ehhez a dokumentumhoz' },
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
          [document.patientId]
        );
        if (patientResult.rows[0]?.beutalo_intezmeny !== userInstitution) {
          return NextResponse.json(
            { error: 'Nincs jogosultsága ehhez a dokumentumhoz' },
            { status: 403 }
          );
        }
      } else {
        return NextResponse.json(
          { error: 'Nincs jogosultsága ehhez a dokumentumhoz' },
          { status: 403 }
        );
      }
    }
  }

  return NextResponse.json({
    document: document,
  });
});

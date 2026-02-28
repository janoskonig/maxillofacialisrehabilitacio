import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { isFtpConfigured, uploadFile, getMaxFileSize } from '@/lib/ftp-client';
import { logger } from '@/lib/logger';

/**
 * Get patient's documents
 * GET /api/patient-portal/documents
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const patientId = await verifyPatientPortalSession(request);

    if (!patientId) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();

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
      WHERE pd.patient_id = $1
      ORDER BY pd.uploaded_at DESC`,
      [patientId]
    );

    return NextResponse.json({
      documents: result.rows,
    });
  } catch (error) {
    logger.error('Error fetching documents:', error);
    return NextResponse.json(
      { error: 'Hiba történt a dokumentumok lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * Upload document for patient
 * POST /api/patient-portal/documents
 */
export async function POST(request: NextRequest) {
  try {
    const patientId = await verifyPatientPortalSession(request);

    if (!patientId) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    // Check FTP configuration
    if (!isFtpConfigured()) {
      return NextResponse.json(
        { error: 'Dokumentum feltöltés jelenleg nem elérhető' },
        { status: 500 }
      );
    }

    const pool = getDbPool();

    // Verify patient exists and get email
    const patientCheck = await pool.query(
      'SELECT id, nev, email FROM patients WHERE id = $1',
      [patientId]
    );

    if (patientCheck.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    const patientEmail = patientCheck.rows[0].email;

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const description = formData.get('description') as string | null;
    const tagsStr = formData.get('tags') as string | null;

    if (!file) {
      return NextResponse.json(
        { error: 'Fájl kötelező' },
        { status: 400 }
      );
    }

    // Validate file size
    const maxSize = getMaxFileSize();
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: `Fájlméret túllépi a maximumot (${Math.round(maxSize / 1024 / 1024)}MB)` },
        { status: 400 }
      );
    }

    // Parse tags
    let tags: string[] = [];
    if (tagsStr) {
      try {
        tags = JSON.parse(tagsStr);
        if (!Array.isArray(tags)) {
          tags = [];
        }
      } catch {
        tags = [];
      }
    }

    // Generate filename
    const { generateDocumentFilename } = await import('@/lib/ftp-client');
    const newFilename = generateDocumentFilename(
      file.name,
      tags,
      patientId,
      new Date()
    );

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // Upload to FTP
    const filePath = await uploadFile(patientId, fileBuffer, newFilename);

    // Save metadata to database
    const tagsJsonb = JSON.stringify(tags);

    const result = await pool.query(
      `INSERT INTO patient_documents (
        patient_id, filename, file_path, file_size, mime_type,
        description, tags, uploaded_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      RETURNING 
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
        updated_at as "updatedAt"`,
      [
        patientId,
        newFilename,
        filePath,
        file.size,
        file.type || null,
        description || null,
        tagsJsonb,
        patientEmail, // Use patient email as uploaded_by for portal uploads
      ]
    );

    const document = result.rows[0];

    return NextResponse.json({
      success: true,
      document: document,
      message: 'Dokumentum sikeresen feltöltve',
    });
  } catch (error) {
    logger.error('Error uploading document:', error);
    return NextResponse.json(
      { error: 'Hiba történt a dokumentum feltöltésekor' },
      { status: 500 }
    );
  }
}









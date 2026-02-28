import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { uploadFile, isFtpConfigured, getMaxFileSize } from '@/lib/ftp-client';
import { documentSchema } from '@/lib/types';
import { logActivity, logActivityWithAuth } from '@/lib/activity';
import { logger } from '@/lib/logger';

// List all documents for a patient
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
      // Technikus: only patients with arcot erinto kezelesi terv
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
      // Sebészorvos: only patients from their institution
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

    // Get all documents for patient
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
        pd.created_at as "createdAt",
        pd.updated_at as "updatedAt"
      FROM patient_documents pd
      LEFT JOIN users u ON u.email = pd.uploaded_by
      LEFT JOIN patients p ON p.email = pd.uploaded_by
      LEFT JOIN users u_by_id ON pd.uploaded_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND u_by_id.id::text = pd.uploaded_by
      LEFT JOIN patients p_by_id ON pd.uploaded_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND p_by_id.id::text = pd.uploaded_by
      WHERE pd.patient_id = $1
      ORDER BY pd.uploaded_at DESC`,
      [patientId]
    );

    // Activity logging
    await logActivityWithAuth(
      request,
      auth,
      'patient_documents_listed',
      `Patient ID: ${patientId}, Documents: ${result.rows.length}`
    );

    return NextResponse.json({ documents: result.rows }, { status: 200 });
  } catch (error) {
    logger.error('Hiba a dokumentumok lekérdezésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt a dokumentumok lekérdezésekor' },
      { status: 500 }
    );
  }
}

// Upload a document for a patient
export async function POST(
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

    // Only doctors (admin, editor, fogpótlástanász, sebészorvos) can upload
    const doctorRoles = ['admin', 'editor', 'fogpótlástanász', 'sebészorvos'];
    if (!doctorRoles.includes(auth.role)) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága dokumentumok feltöltéséhez' },
        { status: 403 }
      );
    }

    // Check FTP configuration
    if (!isFtpConfigured()) {
      return NextResponse.json(
        { error: 'FTP szerver nincs konfigurálva' },
        { status: 500 }
      );
    }

    const pool = getDbPool();
    const patientId = params.id;
    const userEmail = auth.email;

    // Verify patient exists
    const patientCheck = await pool.query(
      'SELECT id, nev FROM patients WHERE id = $1',
      [patientId]
    );

    if (patientCheck.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const description = formData.get('description') as string | null;
    const tagsStr = formData.get('tags') as string | null;
    
    logger.info('Received tagsStr:', tagsStr);

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

    // Check patient's total document size (approximately 5GB = 5368709120 bytes)
    const patientTotalSizeResult = await pool.query(
      `SELECT COALESCE(SUM(file_size), 0) as total_size
       FROM patient_documents
       WHERE patient_id = $1`,
      [patientId]
    );
    const currentTotalSize = parseInt(patientTotalSizeResult.rows[0].total_size, 10);
    const patientMaxSize = 5 * 1024 * 1024 * 1024; // 5GB
    if (currentTotalSize + file.size > patientMaxSize) {
      return NextResponse.json(
        { error: 'A beteg dokumentumok összmérete túllépi a maximumot (5GB)' },
        { status: 400 }
      );
    }

    // Parse tags first (needed for filename generation)
    let tags: string[] = [];
    if (tagsStr) {
      try {
        const parsed = JSON.parse(tagsStr);
        tags = Array.isArray(parsed) ? parsed : [];
      } catch {
        // If not JSON, treat as comma-separated string
        tags = tagsStr.split(',').map(t => t.trim()).filter(t => t.length > 0);
      }
    }
    
    // Ensure tags is always an array
    if (!Array.isArray(tags)) {
      tags = [];
    }
    
    logger.info('Parsed tags:', tags);

    // Validate: OP tag can only be used with image files
    const hasOPTag = tags.some(tag => 
      tag.toLowerCase() === 'op' || 
      tag.toLowerCase() === 'orthopantomogram'
    );
    
    if (hasOPTag) {
      // Check if file is an image
      const isImage = file.type && file.type.startsWith('image/');
      if (!isImage) {
        return NextResponse.json(
          { error: 'OP tag-gel csak képfájlok tölthetők fel' },
          { status: 400 }
        );
      }
    }

    // Validate: foto tag can only be used with image files
    const hasFotoTag = tags.some(tag => 
      tag.toLowerCase() === 'foto'
    );
    
    if (hasFotoTag) {
      // Check if file is an image
      const isImage = file.type && file.type.startsWith('image/');
      if (!isImage) {
        return NextResponse.json(
          { error: 'Foto tag-gel csak képfájlok tölthetők fel' },
          { status: 400 }
        );
      }
    }

    // Generate new filename: {cimke}_{patientId}_{datum}.{kiterjesztes}
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

    // Upload to FTP with new filename
    const filePath = await uploadFile(patientId, fileBuffer, newFilename);

    // Save metadata to database
    // Convert tags array to JSONB format for PostgreSQL
    const tagsJsonb = JSON.stringify(tags);
    logger.info('Saving tags to database:', tagsJsonb);
    
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
        newFilename, // Store the renamed filename, not original
        filePath,
        file.size,
        file.type || null,
        description || null,
        tagsJsonb, // Cast to JSONB in SQL query
        userEmail
      ]
    );

    const document = result.rows[0];

    // Activity logging
    await logActivity(
      request,
      userEmail,
      'patient_document_uploaded',
      `Patient ID: ${patientId}, Document: ${file.name}, Size: ${file.size} bytes`
    );

    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    logger.error('Hiba a dokumentum feltöltésekor:', error);
    const errorMessage = error instanceof Error ? error.message : 'Ismeretlen hiba';
    return NextResponse.json(
      { error: `Hiba történt a dokumentum feltöltésekor: ${errorMessage}` },
      { status: 500 }
    );
  }
}


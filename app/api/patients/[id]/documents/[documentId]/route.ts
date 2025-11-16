import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { downloadFile, deleteFile } from '@/lib/ftp-client';

// Download a document
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; documentId: string } }
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
    const documentId = params.documentId;

    // Get document metadata
    const result = await pool.query(
      `SELECT 
        id,
        patient_id,
        filename,
        file_path,
        file_size,
        mime_type,
        uploaded_by
      FROM patient_documents
      WHERE id = $1 AND patient_id = $2`,
      [documentId, patientId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Dokumentum nem található' },
        { status: 404 }
      );
    }

    const document = result.rows[0];

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
          [patientId]
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

    // Download file from FTP
    const fileBuffer = await downloadFile(document.file_path);

    // Activity logging
    try {
      const ipHeader = request.headers.get('x-forwarded-for') || '';
      const ipAddress = ipHeader.split(',')[0]?.trim() || null;
      await pool.query(
        `INSERT INTO activity_logs (user_email, action, detail, ip_address)
         VALUES ($1, $2, $3, $4)`,
        [auth.email, 'patient_document_downloaded', `Patient ID: ${patientId}, Document: ${document.filename}`, ipAddress]
      );
    } catch (logError) {
      console.error('Failed to log activity:', logError);
    }

    // Return file
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': document.mime_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(document.filename)}"`,
        'Content-Length': document.file_size.toString(),
      },
    });
  } catch (error) {
    console.error('Hiba a dokumentum letöltésekor:', error);
    const errorMessage = error instanceof Error ? error.message : 'Ismeretlen hiba';
    return NextResponse.json(
      { error: `Hiba történt a dokumentum letöltésekor: ${errorMessage}` },
      { status: 500 }
    );
  }
}

// Delete a document
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; documentId: string } }
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

    // Only admins can delete documents
    if (auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Csak admin törölhet dokumentumokat' },
        { status: 403 }
      );
    }

    const pool = getDbPool();
    const patientId = params.id;
    const documentId = params.documentId;
    const userEmail = auth.email;

    // Get document metadata
    const result = await pool.query(
      `SELECT 
        id,
        patient_id,
        filename,
        file_path
      FROM patient_documents
      WHERE id = $1 AND patient_id = $2`,
      [documentId, patientId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Dokumentum nem található' },
        { status: 404 }
      );
    }

    const document = result.rows[0];

    // Delete from FTP
    try {
      // Pass patientId to deleteFile so it can navigate to the correct directory
      await deleteFile(document.file_path, patientId);
    } catch (error) {
      console.error('Failed to delete file from FTP:', error);
      // Continue with database deletion even if FTP deletion fails
    }

    // Delete from database
    await pool.query(
      'DELETE FROM patient_documents WHERE id = $1',
      [documentId]
    );

    // Activity logging
    try {
      const ipHeader = request.headers.get('x-forwarded-for') || '';
      const ipAddress = ipHeader.split(',')[0]?.trim() || null;
      await pool.query(
        `INSERT INTO activity_logs (user_email, action, detail, ip_address)
         VALUES ($1, $2, $3, $4)`,
        [userEmail, 'patient_document_deleted', `Patient ID: ${patientId}, Document: ${document.filename}`, ipAddress]
      );
    } catch (logError) {
      console.error('Failed to log activity:', logError);
    }

    return NextResponse.json(
      { message: 'Dokumentum sikeresen törölve' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Hiba a dokumentum törlésekor:', error);
    const errorMessage = error instanceof Error ? error.message : 'Ismeretlen hiba';
    return NextResponse.json(
      { error: `Hiba történt a dokumentum törlésekor: ${errorMessage}` },
      { status: 500 }
    );
  }
}


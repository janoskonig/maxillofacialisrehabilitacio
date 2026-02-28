import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { downloadFile } from '@/lib/ftp-client';
import { apiHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req, { correlationId, params }) => {
  const patientId = await verifyPatientPortalSession(req);

  if (!patientId) {
    return NextResponse.json(
      { error: 'Bejelentkezés szükséges' },
      { status: 401 }
    );
  }

  const pool = getDbPool();
  const documentId = params.documentId;

  const result = await pool.query(
    `SELECT 
      id,
      patient_id,
      filename,
      file_path,
      file_size,
      mime_type
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

  const fileBuffer = await downloadFile(document.file_path, patientId);

  const isImage = document.mime_type && document.mime_type.startsWith('image/');

  return new NextResponse(new Uint8Array(fileBuffer), {
    status: 200,
    headers: {
      'Content-Type': document.mime_type || 'application/octet-stream',
      'Content-Disposition': isImage
        ? `inline; filename="${encodeURIComponent(document.filename)}"`
        : `attachment; filename="${encodeURIComponent(document.filename)}"`,
      'Content-Length': document.file_size.toString(),
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

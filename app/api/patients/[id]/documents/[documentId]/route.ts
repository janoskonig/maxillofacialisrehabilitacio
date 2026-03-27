import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { downloadFile, deleteFile } from '@/lib/ftp-client';
import { logActivity, logActivityWithAuth } from '@/lib/activity';
import { logger } from '@/lib/logger';

// Download a document
export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth, params }) => {
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

  // All authenticated users can access all documents

  // Download file from FTP
  // Pass patientId to downloadFile so it can navigate to the correct directory
  const fileBuffer = await downloadFile(document.file_path, patientId);

  // Activity logging
  await logActivityWithAuth(
    req,
    auth,
    'patient_document_downloaded',
    `Patient ID: ${patientId}, Document: ${document.filename}`
  );

  // Check if this is an image - if so, use inline disposition for viewing
  const isImage = document.mime_type && (
    document.mime_type.startsWith('image/') ||
    document.mime_type === 'image/jpeg' ||
    document.mime_type === 'image/jpg' ||
    document.mime_type === 'image/png' ||
    document.mime_type === 'image/gif' ||
    document.mime_type === 'image/webp' ||
    document.mime_type === 'image/svg+xml'
  );

  // Check if request wants inline display (from query param or referer)
  const url = new URL(req.url);
  const viewInline = url.searchParams.get('inline') === 'true' || isImage;

  // Return file
  // Convert Buffer to Uint8Array for NextResponse compatibility
  return new NextResponse(new Uint8Array(fileBuffer), {
    status: 200,
    headers: {
      'Content-Type': document.mime_type || 'application/octet-stream',
      'Content-Disposition': viewInline
        ? `inline; filename="${encodeURIComponent(document.filename)}"`
        : `attachment; filename="${encodeURIComponent(document.filename)}"`,
      'Content-Length': document.file_size.toString(),
      // Add CORS headers for cross-origin image loading if needed
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

// Delete a document
export const DELETE = roleHandler(['admin'], async (req, { auth, params }) => {
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
    logger.error('Failed to delete file from FTP:', error);
    // Continue with database deletion even if FTP deletion fails
  }

  // Delete from database
  await pool.query(
    'DELETE FROM patient_documents WHERE id = $1',
    [documentId]
  );

  // Activity logging
  await logActivity(
    req,
    userEmail,
    'patient_document_deleted',
    `Patient ID: ${patientId}, Document: ${document.filename}`
  );

  return NextResponse.json(
    { message: 'Dokumentum sikeresen törölve' },
    { status: 200 }
  );
});

// Update document metadata (currently tags)
export const PATCH = roleHandler(['admin', 'fogpótlástanász', 'beutalo_orvos'], async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;
  const documentId = params.documentId;
  const userEmail = auth.email;

  const existingResult = await pool.query(
    `SELECT id, patient_id, filename, mime_type, tags
     FROM patient_documents
     WHERE id = $1 AND patient_id = $2`,
    [documentId, patientId]
  );

  if (existingResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Dokumentum nem található' },
      { status: 404 }
    );
  }

  const existingDoc = existingResult.rows[0];
  const body = await req.json().catch(() => null);
  const incomingTags = body?.tags;

  if (!Array.isArray(incomingTags)) {
    return NextResponse.json(
      { error: 'Érvénytelen kérés: a tags mező tömb kell legyen' },
      { status: 400 }
    );
  }

  const tags = incomingTags
    .filter((tag: unknown) => typeof tag === 'string')
    .map((tag: string) => tag.trim())
    .filter((tag: string) => tag.length > 0)
    .slice(0, 50);

  const hasOPTag = tags.some((tag: string) => {
    const t = tag.toLowerCase();
    return t === 'op' || t === 'orthopantomogram';
  });
  const hasFotoTag = tags.some((tag: string) => tag.toLowerCase() === 'foto');
  const isImage = typeof existingDoc.mime_type === 'string' && existingDoc.mime_type.startsWith('image/');

  if ((hasOPTag || hasFotoTag) && !isImage) {
    return NextResponse.json(
      { error: 'OP/Foto tag csak képfájlhoz adható' },
      { status: 400 }
    );
  }

  const result = await pool.query(
    `UPDATE patient_documents
     SET tags = $1::jsonb, updated_at = NOW()
     WHERE id = $2
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
    [JSON.stringify(tags), documentId]
  );

  await logActivity(
    req,
    userEmail,
    'patient_document_tags_updated',
    `Patient ID: ${patientId}, Document: ${existingDoc.filename}, Tags: ${tags.join(', ')}`
  );

  return NextResponse.json({ document: result.rows[0] }, { status: 200 });
});


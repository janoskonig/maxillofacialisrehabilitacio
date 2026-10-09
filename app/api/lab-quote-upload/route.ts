import { NextResponse, type NextRequest } from 'next/server';
import { apiHandler } from '@/lib/api/route-handler';
import { HttpError } from '@/lib/auth-server';
import { getDbPool } from '@/lib/db';
import { uploadFile, deleteFile, isFtpConfigured, generateDocumentFilename } from '@/lib/ftp-client';
import { logActivity } from '@/lib/activity';
import { checkRateLimit } from '@/lib/rate-limit';
import { hashUploadToken, getLabQuoteUploadMaxSize, LAB_QUOTE_UPLOAD_LIMIT, validateLabQuoteUpload } from '@/lib/lab-quote-upload';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface UploadLink {
  id: string; patient_id: string; quote_id: string; target_id: string | null;
  recipient_email: string; expires_at: Date; upload_count: number;
}

function authorizeRequest(req: NextRequest): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  if (!checkRateLimit(`lab-upload:${ip}`, 30, 60_000).allowed) {
    throw new HttpError(429, 'Túl sok kérés. Próbálja újra egy perc múlva.');
  }
  return hashUploadToken(req.headers.get('x-upload-token') || '');
}

const LINK_QUERY = `SELECT id, patient_id, quote_id, target_id, recipient_email, expires_at, upload_count
  FROM lab_quote_upload_links WHERE token_hash = $1 AND expires_at > now() AND revoked_at IS NULL`;

function requireLink(link: UploadLink | undefined): UploadLink {
  if (!link) throw new HttpError(404, 'A feltöltési link érvénytelen vagy lejárt');
  if (link.upload_count >= LAB_QUOTE_UPLOAD_LIMIT) throw new HttpError(410, 'A feltöltési keret elfogyott. Kérjen új linket a kezelőorvostól.');
  return link;
}

export const GET = apiHandler(async req => {
  const tokenHash = authorizeRequest(req);
  const result = await getDbPool().query<UploadLink>(LINK_QUERY, [tokenHash]);
  const link = requireLink(result.rows[0]);
  // No patient data or existing documents are exposed to the recipient.
  return NextResponse.json({
    expiresAt: link.expires_at,
    remainingUploads: LAB_QUOTE_UPLOAD_LIMIT - link.upload_count,
    maxFileSize: getLabQuoteUploadMaxSize(),
    uploadAvailable: isFtpConfigured(),
  }, { headers: { 'Cache-Control': 'no-store' } });
});

export const POST = apiHandler(async req => {
  const tokenHash = authorizeRequest(req);
  const pool = getDbPool();
  requireLink((await pool.query<UploadLink>(LINK_QUERY, [tokenHash])).rows[0]);
  if (!isFtpConfigured()) throw new HttpError(503, 'A dokumentumfeltöltés átmenetileg nem elérhető.');
  const contentLength = Number(req.headers.get('content-length'));
  if (contentLength > getLabQuoteUploadMaxSize() + 1024 * 1024) throw new HttpError(413, 'A fájl túl nagy');
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') throw new HttpError(400, 'Válasszon egy fájlt');
  if (file.size > getLabQuoteUploadMaxSize()) throw new HttpError(413, 'A fájl túl nagy');
  const description = form.get('description');
  if (description !== null && (typeof description !== 'string' || description.length > 2000)) throw new HttpError(400, 'A megjegyzés legfeljebb 2000 karakter lehet');
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = validateLabQuoteUpload(file.name, buffer);
  const client = await pool.connect();
  let filePath: string | null = null;
  let link: UploadLink | undefined;
  let committed = false;
  try {
    await client.query('BEGIN');
    link = requireLink((await client.query<UploadLink>(`${LINK_QUERY} FOR UPDATE`, [tokenHash])).rows[0]);
    // Serialize uploads for this patient so both link and storage quotas hold under concurrency.
    await client.query('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [link.patient_id]);
    const total = await client.query('SELECT COALESCE(SUM(file_size), 0) AS size FROM patient_documents WHERE patient_id = $1', [link.patient_id]);
    if (Number(total.rows[0].size) + file.size > 5 * 1024 * 1024 * 1024) throw new HttpError(400, 'A beteg dokumentumtára megtelt. Jelezze a kezelőorvosnak.');
    const tags = ['árajánlat', ...(link.target_id ? [link.target_id] : [])];
    const filename = generateDocumentFilename(file.name, tags, link.patient_id);
    filePath = await uploadFile(link.patient_id, buffer, filename);
    await client.query(
      `INSERT INTO patient_documents (patient_id, filename, file_path, file_size, mime_type,
       description, tags, uploaded_by, lab_quote_request_id, lab_quote_upload_link_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
      [link.patient_id, filename, filePath, file.size, mimeType,
        `Árajánlatkérőre érkezett dokumentum${description ? ` – ${description}` : ''}`,
        JSON.stringify(tags), link.recipient_email, link.quote_id, link.id]
    );
    await client.query('UPDATE lab_quote_upload_links SET upload_count = upload_count + 1 WHERE id = $1', [link.id]);
    await client.query('COMMIT');
    committed = true;
  } catch (error) {
    await client.query('ROLLBACK');
    if (filePath && link && !committed) await deleteFile(filePath, link.patient_id).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await logActivity(req, link!.recipient_email, 'patient_document_uploaded',
    `Patient ID: ${link!.patient_id}, Quote ID: ${link!.quote_id}, External upload, Size: ${file.size} bytes`);
  return NextResponse.json({ success: true, remainingUploads: LAB_QUOTE_UPLOAD_LIMIT - link!.upload_count - 1 },
    { status: 201, headers: { 'Cache-Control': 'no-store' } });
});

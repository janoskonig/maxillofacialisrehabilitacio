import { createHash, randomBytes } from 'crypto';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import { getMaxFileSize } from '@/lib/ftp-client';

export const LAB_QUOTE_UPLOAD_DAYS = 30;
export const LAB_QUOTE_UPLOAD_LIMIT = 20;
export const LAB_QUOTE_UPLOAD_ACCEPT = '.pdf,.docx,.xlsx,.jpg,.jpeg,.png';

export function getLabQuoteUploadMaxSize(): number {
  return Math.min(getMaxFileSize(), 20 * 1024 * 1024);
}

export function hashUploadToken(token: string): string {
  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw new HttpError(404, 'A feltöltési link érvénytelen vagy lejárt');
  }
  return createHash('sha256').update(token).digest('hex');
}

export async function createLabQuoteUploadLink(options: {
  patientId: string; quoteId: string; targetId: string | null; recipientEmail: string; createdBy: string;
}) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + LAB_QUOTE_UPLOAD_DAYS * 24 * 60 * 60 * 1000);
  const result = await getDbPool().query<{ id: string }>(
    `INSERT INTO lab_quote_upload_links
     (token_hash, patient_id, quote_id, target_id, recipient_email, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [hashUploadToken(token), options.patientId, options.quoteId, options.targetId,
      options.recipientEmail, options.createdBy, expiresAt]
  );
  return { id: result.rows[0].id, token, expiresAt };
}

/** Determine the stored MIME type from both the extension and file signature. */
export function validateLabQuoteUpload(filename: string, buffer: Buffer): string {
  if (!buffer.length || buffer.length > getLabQuoteUploadMaxSize()) {
    throw new HttpError(400, 'A fájl üres vagy túllépi a megengedett fájlméretet');
  }
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'pdf' && buffer.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (['jpg', 'jpeg'].includes(extension ?? '') && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (extension === 'png' && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (['docx', 'xlsx'].includes(extension ?? '') && buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    return extension === 'docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  throw new HttpError(400, 'PDF, DOCX, XLSX, JPG vagy PNG fájl tölthető fel, a kiterjesztésnek megfelelő tartalommal');
}

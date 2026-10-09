// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), txQuery: vi.fn(), release: vi.fn(), connect: vi.fn(),
  upload: vi.fn(), remove: vi.fn(), log: vi.fn(), configured: vi.fn(), rateLimit: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ getDbPool: () => ({ query: mocks.query, connect: mocks.connect }) }));
vi.mock('@/lib/ftp-client', () => ({
  getMaxFileSize: () => 100 * 1024 * 1024,
  isFtpConfigured: mocks.configured, uploadFile: mocks.upload, deleteFile: mocks.remove,
  generateDocumentFilename: () => 'quote.pdf',
}));
vi.mock('@/lib/activity', () => ({ logActivity: mocks.log }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rateLimit }));

import { GET, POST } from '@/app/api/lab-quote-upload/route';
import { createLabQuoteUploadLink, hashUploadToken, validateLabQuoteUpload } from '@/lib/lab-quote-upload';

const token = 'a'.repeat(64);
const link = {
  id: 'link-1', patient_id: 'patient-from-token', quote_id: 'quote-from-token',
  target_id: 'neoss', recipient_email: 'partner@example.com', expires_at: new Date('2030-01-01'), upload_count: 0,
};
function request(file?: { name: string; content: string }, secret = token) {
  const form = new FormData();
  if (file) form.set('file', new File([file.content], file.name, { type: 'application/pdf' }));
  // The caller must not be able to choose another patient/quote.
  form.set('patientId', 'attacker-chosen-patient');
  form.set('quoteId', 'attacker-chosen-quote');
  return new NextRequest('http://localhost/api/lab-quote-upload', {
    method: file ? 'POST' : 'GET', headers: { 'x-upload-token': secret }, ...(file ? { body: form } : {}),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.rateLimit.mockReturnValue({ allowed: true });
  mocks.query.mockResolvedValue({ rows: [link] });
  mocks.connect.mockResolvedValue({ query: mocks.txQuery, release: mocks.release });
  mocks.txQuery.mockImplementation(async (sql: string) => ({
    rows: sql.includes('FROM lab_quote_upload_links') ? [link] : sql.includes('SUM(file_size)') ? [{ size: 0 }] : [],
  }));
  mocks.upload.mockResolvedValue('/patients/p/quote.pdf');
});

describe('quote upload capability', () => {
  it('rejects a missing or malformed secret before accessing the DB', async () => {
    expect((await GET(request(undefined, ''))).status).toBe(404);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('treats an unknown, expired or revoked link as unavailable', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    expect((await GET(request())).status).toBe(404);
    expect((await POST(request({ name: 'quote.pdf', content: '%PDF-1.7' }))).status).toBe(404);
    expect(mocks.upload).not.toHaveBeenCalled();
    const [sql, values] = mocks.query.mock.calls[0];
    expect(sql).toContain('expires_at > now()');
    expect(sql).toContain('revoked_at IS NULL');
    expect(values).toEqual([hashUploadToken(token)]);
  });

  it('returns only upload settings, without patient data or existing documents', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      expiresAt: link.expires_at.toISOString(), remainingUploads: 20, maxFileSize: 20 * 1024 * 1024, uploadAvailable: true,
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('saves the PDF under the patient and quote bound to the token', async () => {
    const res = await POST(request({ name: 'quote.pdf', content: '%PDF-1.7\ncontent' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, remainingUploads: 19 });
    expect(mocks.upload).toHaveBeenCalledWith(link.patient_id, expect.any(Buffer), 'quote.pdf');
    const insert = mocks.txQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO patient_documents'))!;
    expect(insert[1][0]).toBe(link.patient_id);
    expect(insert[1][7]).toBe(link.recipient_email);
    expect(insert[1][8]).toBe(link.quote_id);
    expect(insert[1][9]).toBe(link.id);
    expect(mocks.txQuery).toHaveBeenCalledWith('COMMIT');
    expect(mocks.log).toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalled();
  });

  it('rechecks the quota inside a lock, rejecting a concurrently exhausted link', async () => {
    mocks.txQuery.mockImplementation(async (sql: string) => ({ rows: sql.includes('FOR UPDATE') ? [{ ...link, upload_count: 20 }] : [] }));
    const res = await POST(request({ name: 'quote.pdf', content: '%PDF-1.7' }));
    expect(res.status).toBe(410);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.txQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it('rejects a disguised executable before touching file storage', async () => {
    const res = await POST(request({ name: 'quote.pdf', content: '<script>evil</script>' }));
    expect(res.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('enforces the patient storage quota', async () => {
    mocks.txQuery.mockImplementation(async (sql: string) => ({
      rows: sql.includes('FROM lab_quote_upload_links') ? [link] : sql.includes('SUM(file_size)') ? [{ size: 5 * 1024 ** 3 }] : [],
    }));
    expect((await POST(request({ name: 'quote.pdf', content: '%PDF-1.7' }))).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('removes the uploaded file and rolls back the quota if metadata persistence fails', async () => {
    mocks.txQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO patient_documents')) throw new Error('database failure');
      return { rows: sql.includes('FROM lab_quote_upload_links') ? [link] : sql.includes('SUM(file_size)') ? [{ size: 0 }] : [] };
    });
    expect((await POST(request({ name: 'quote.pdf', content: '%PDF-1.7' }))).status).toBe(500);
    expect(mocks.remove).toHaveBeenCalledWith('/patients/p/quote.pdf', link.patient_id);
    expect(mocks.txQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.txQuery).not.toHaveBeenCalledWith('COMMIT');
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it('rate limits requests before accessing the DB', async () => {
    mocks.rateLimit.mockReturnValue({ allowed: false });
    expect((await GET(request())).status).toBe(429);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('stores only a hash of a fresh unpredictable token', async () => {
    mocks.query.mockResolvedValue({ rows: [{ id: 'new-link' }] });
    const result = await createLabQuoteUploadLink({ patientId: 'p', quoteId: 'q', targetId: 'neoss', recipientEmail: 'partner@example.com', createdBy: 'doctor@example.com' });
    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    const params = mocks.query.mock.calls[0][1];
    expect(params[0]).toBe(hashUploadToken(result.token));
    expect(params).not.toContain(result.token);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
  });

  it('checks document signatures and rejects empty or unsupported files', () => {
    expect(validateLabQuoteUpload('quote.PDF', Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    expect(() => validateLabQuoteUpload('quote.html', Buffer.from('%PDF-1.7'))).toThrow();
    expect(() => validateLabQuoteUpload('quote.pdf', Buffer.alloc(0))).toThrow();
  });
});

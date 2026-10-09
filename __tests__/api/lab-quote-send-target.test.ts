// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { LAB_QUOTE_TARGETS } from '@/lib/email/lab-quote-target-catalog';

const mocks = vi.hoisted(() => ({ query: vi.fn(), send: vi.fn(), pdf: vi.fn(), link: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDbPool: () => ({ query: mocks.query }) }));
vi.mock('@/lib/auth-server', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/auth-server')>(),
  requireAuth: vi.fn(async () => ({ userId: 'u1', role: 'admin', email: 'doctor@example.com' })),
}));
vi.mock('@/lib/legal/patient-data-access-log', () => ({ maybeLogPatientAccess: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/email', () => ({ sendEmail: mocks.send }));
vi.mock('@/lib/pdf/lab-quote-request', () => ({ generateLabQuoteRequestPDF: mocks.pdf }));
vi.mock('@/lib/email/lab-quote-targets', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/email/lab-quote-targets')>(),
  getLabQuoteTargets: vi.fn(async () => [...LAB_QUOTE_TARGETS]),
}));
vi.mock('@/lib/lab-quote-upload', () => ({ createLabQuoteUploadLink: mocks.link, LAB_QUOTE_UPLOAD_DAYS: 30 }));

import { POST } from '@/app/api/patients/[id]/lab-quote-requests/[quoteId]/send-email/route';
const call = (body: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/patients/p1/lab-quote-requests/q1/send-email', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), { params: { id: 'p1', quoteId: 'q1' } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockImplementation(async (sql: string) => ({ rows:
    sql.includes('FROM patients') ? [{ id: 'p1', nev: 'Teszt Elek', taj: '123456789', nem: 'ferfi', szuletesiDatum: '1980-01-01' }]
      : sql.includes('FROM lab_quote_requests') ? [{ id: 'q1', patientId: 'p1', szoveg: '<script>alert(1)</script>', datuma: '2026-10-20' }]
        : sql.includes('FROM users') ? [{ doktor_neve: 'Dr. Orvos', email: 'doctor@example.com' }] : [],
  }));
  mocks.pdf.mockResolvedValue(Buffer.from('%PDF-1.7'));
  mocks.link.mockResolvedValue({ id: 'l1', token: 'a'.repeat(64), expiresAt: new Date('2030-01-01') });
  mocks.send.mockResolvedValue(undefined);
});

describe('targeted quote email', () => {
  it('sends fogtechnika to Interdental, with a link in both email formats', async () => {
    expect((await call({ targetId: 'fogtechnika' })).status).toBe(200);
    const mail = mocks.send.mock.calls[0][0];
    expect(mail.to).toBe('idssote@gmail.com');
    expect(mail.html).toContain('Tisztelt Interdental KFT!');
    expect(mail.html).toContain('/lab-quote-upload#token=');
    expect(mail.text).toContain('/lab-quote-upload#token=');
    expect(mail.html).not.toContain('<script>');
    expect(mail.metadata).toMatchObject({ targetId: 'fogtechnika', uploadLinkId: 'l1' });
    expect(JSON.stringify(mail.metadata)).not.toContain('a'.repeat(64));
  });

  it('requires the missing target address before generating a PDF or sending', async () => {
    expect((await call({ targetId: 'neoss' })).status).toBe(400);
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('does not fall back to a legacy address for an empty targeted recipient', async () => {
    expect((await call({ targetId: 'neoss', recipients: ['  '] })).status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('allows a manually confirmed nurse address and opting out of uploads', async () => {
    expect((await call({ targetId: 'implantacio', recipients: ['zsuzsi@example.com'], includeUploadLink: false })).status).toBe(200);
    expect(mocks.send.mock.calls[0][0].to).toBe('zsuzsi@example.com');
    expect(mocks.link).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls[0][0].html).not.toContain('/lab-quote-upload');
  });

  it('revokes the upload link when sending fails', async () => {
    mocks.send.mockRejectedValueOnce(new Error('SMTP unavailable'));
    expect((await call({ targetId: 'fogtechnika' })).status).toBe(500);
    expect(mocks.query).toHaveBeenCalledWith('UPDATE lab_quote_upload_links SET revoked_at = now() WHERE id = $1', ['l1']);
  });
});

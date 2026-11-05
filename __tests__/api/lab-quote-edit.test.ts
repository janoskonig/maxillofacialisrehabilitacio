// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/api/route-handler', () => ({ authedHandler: (handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({ getDbPool: () => ({ query: mocks.query }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import { PUT } from '@/app/api/patients/[id]/lab-quote-requests/[quoteId]/route';
import { GET } from '@/app/api/patients/[id]/lab-quote-requests/route';

const quote = { id: 'q1', patientId: 'p1', szoveg: 'Módosított kérés', datuma: '2026-11-20' };
const context = (role = 'admin') => ({
  params: { id: 'p1', quoteId: 'q1' },
  auth: { userId: 'u1', email: 'doctor@example.com', role },
  correlationId: 'test',
});
const request = (body: unknown = quote) => new NextRequest('http://localhost/api/patients/p1/lab-quote-requests/q1', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue({ rows: [quote] });
});

describe('editing saved lab quote requests', () => {
  it.each(['admin', 'fogpótlástanász', 'beutalo_orvos', 'technikus'])('allows %s to update an unsent quote', async role => {
    const response = await PUT(request(), context(role));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ quoteRequest: quote });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE lab_quote_requests'),
      ['Módosított kérés', '2026-11-20', 'doctor@example.com', 'q1', 'p1'],
    );
  });

  it('guards the write against every successful send, including one before a failed retry', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'q1' }] });
    const response = await PUT(request(), context());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('már el lett küldve');
    const sql = mocks.query.mock.calls[0][0];
    expect(sql).toContain('AND NOT EXISTS');
    expect(sql).toContain("sent_email.email_type = 'lab_quote'");
    expect(sql).toContain("sent_email.status = 'sent'");
    expect(sql).toContain("sent_email.metadata->>'quoteId' = lqr.id::text");
    expect(sql).not.toMatch(/LIMIT|ORDER BY/);
  });

  it('returns 404 for a missing quote or a quote belonging to a different patient', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    expect((await PUT(request(), context())).status).toBe(404);
    expect(mocks.query).toHaveBeenLastCalledWith(
      'SELECT id FROM lab_quote_requests WHERE id = $1 AND patient_id = $2', ['q1', 'p1'],
    );
  });

  it('rejects roles without edit access before querying the database', async () => {
    expect((await PUT(request(), context('viewer'))).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects an empty request without updating the saved quote', async () => {
    expect((await PUT(request({ szoveg: '', datuma: '' }), context())).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('exposes successful send history separately from the last failed attempt', async () => {
    const sentQuote = { ...quote, hasBeenSent: true, lastEmailStatus: 'failed' };
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 'p1' }] }).mockResolvedValueOnce({ rows: [sentQuote] });
    const response = await GET(new NextRequest('http://localhost/api/patients/p1/lab-quote-requests'), context());
    expect((await response.json()).quoteRequests).toEqual([sentQuote]);
    const sql = mocks.query.mock.calls[1][0];
    expect(sql).toContain('EXISTS (');
    expect(sql).toContain('as "hasBeenSent"');
    expect(sql).toContain("sent_email.status = 'sent'");
    expect(sql).toContain("sent_email.metadata->>'quoteId' = lqr.id::text");
  });
});

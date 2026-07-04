import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const queryMock = vi.fn();

vi.mock('@/lib/db', () => ({
  getDbPool: () => ({ query: queryMock }),
}));

vi.mock('@/lib/auth-server', () => ({
  verifyAuth: vi.fn(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
  HttpError: class HttpError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.name = 'HttpError';
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock('@/lib/api-error-handler', () => ({
  handleApiError: vi.fn((error: any, msg: string, correlationId?: string) => {
    const status = error?.status || 500;
    const res = NextResponse.json({ error: error?.message || msg }, { status });
    if (correlationId) res.headers.set('x-correlation-id', correlationId);
    return res;
  }),
}));

import { GET } from '@/app/api/admin/patient-access-log/route';
import { requireRole } from '@/lib/auth-server';

const adminAuth = { userId: 'a1', email: 'admin@clinic.hu', role: 'admin' as const };
const UUID = '11111111-2222-4333-8444-555555555555';

function makeRequest(qs: string) {
  return new NextRequest(`http://localhost/api/admin/patient-access-log${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/admin/patient-access-log', () => {
  it('403 for a non-admin role', async () => {
    const HttpError = (await import('@/lib/auth-server')).HttpError;
    vi.mocked(requireRole).mockRejectedValue(new HttpError(403, 'Forbidden'));
    const res = await GET(makeRequest(`?patientId=${UUID}`));
    expect(res.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('400 for a missing patientId', async () => {
    vi.mocked(requireRole).mockResolvedValue(adminAuth);
    const res = await GET(makeRequest(''));
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('400 for an invalid (non-UUID) patientId', async () => {
    vi.mocked(requireRole).mockResolvedValue(adminAuth);
    const res = await GET(makeRequest('?patientId=not-a-uuid'));
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('queries with default limit 200 and returns rows', async () => {
    vi.mocked(requireRole).mockResolvedValue(adminAuth);
    queryMock.mockResolvedValueOnce({ rows: [{ id: '1' }] });
    const res = await GET(makeRequest(`?patientId=${UUID}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accesses).toEqual([{ id: '1' }]);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('FROM patient_data_access_log');
    expect(params[0]).toBe(UUID);
    expect(params[params.length - 1]).toBe(200); // default limit
  });

  it('applies from/to filters and clamps limit to the max', async () => {
    vi.mocked(requireRole).mockResolvedValue(adminAuth);
    queryMock.mockResolvedValueOnce({ rows: [] });
    const res = await GET(
      makeRequest(`?patientId=${UUID}&from=2026-01-01&to=2026-06-30&limit=5000`),
    );
    expect(res.status).toBe(400); // limit above max (1000) fails validation
  });

  it('accepts a valid limit within range', async () => {
    vi.mocked(requireRole).mockResolvedValue(adminAuth);
    queryMock.mockResolvedValueOnce({ rows: [] });
    const res = await GET(makeRequest(`?patientId=${UUID}&from=2026-01-01&to=2026-06-30&limit=50`));
    expect(res.status).toBe(200);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('accessed_at >=');
    expect(sql).toContain('accessed_at <');
    expect(params).toContain('2026-01-01');
    expect(params).toContain('2026-06-30');
    expect(params[params.length - 1]).toBe(50);
  });
});

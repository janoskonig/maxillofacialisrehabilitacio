import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

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
    const res = NextResponse.json(
      { error: error?.message || msg },
      { status }
    );
    if (correlationId) res.headers.set('x-correlation-id', correlationId);
    return res;
  }),
}));

import { apiHandler, authedHandler, roleHandler } from '@/lib/api/route-handler';
import { requireAuth, requireRole } from '@/lib/auth-server';

function makeRequest(url = 'http://localhost/api/test', headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers });
}

const mockAuth = { userId: 'u1', email: 'test@test.com', role: 'admin' as const };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('apiHandler', () => {
  it('sets correlation ID on response', async () => {
    const handler = apiHandler(async (_req, { correlationId }) => {
      return NextResponse.json({ ok: true, correlationId });
    });

    const res = await handler(makeRequest());
    expect(res.headers.get('x-correlation-id')).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('propagates incoming correlation ID', async () => {
    const handler = apiHandler(async (_req, { correlationId }) => {
      return NextResponse.json({ correlationId });
    });

    const res = await handler(makeRequest('http://localhost/api/test', { 'x-correlation-id': 'MY-ID' }));
    expect(res.headers.get('x-correlation-id')).toBe('my-id');
  });

  it('catches errors and returns error response', async () => {
    const handler = apiHandler(async () => {
      throw new Error('boom');
    });

    const res = await handler(makeRequest());
    expect(res.status).toBe(500);
  });

  it('passes params from route context', async () => {
    const handler = apiHandler(async (_req, { params }) => {
      return NextResponse.json({ id: params.id });
    });

    const res = await handler(makeRequest(), { params: { id: '42' } });
    const body = await res.json();
    expect(body.id).toBe('42');
  });
});

describe('authedHandler', () => {
  it('calls requireAuth and passes auth to handler', async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockAuth);

    const handler = authedHandler(async (_req, { auth }) => {
      return NextResponse.json({ email: auth.email });
    });

    const res = await handler(makeRequest());
    expect(requireAuth).toHaveBeenCalled();
    const body = await res.json();
    expect(body.email).toBe('test@test.com');
  });

  it('returns 401 when requireAuth throws', async () => {
    const HttpError = (await import('@/lib/auth-server')).HttpError;
    vi.mocked(requireAuth).mockRejectedValue(new HttpError(401, 'Unauthenticated'));

    const handler = authedHandler(async () => {
      return NextResponse.json({ never: true });
    });

    const res = await handler(makeRequest());
    expect(res.status).toBe(401);
  });
});

describe('roleHandler', () => {
  it('calls requireRole with specified roles', async () => {
    vi.mocked(requireRole).mockResolvedValue(mockAuth);

    const handler = roleHandler(['admin'], async (_req, { auth }) => {
      return NextResponse.json({ role: auth.role });
    });

    const res = await handler(makeRequest());
    expect(requireRole).toHaveBeenCalledWith(expect.anything(), ['admin']);
    const body = await res.json();
    expect(body.role).toBe('admin');
  });

  it('returns 403 when role check fails', async () => {
    const HttpError = (await import('@/lib/auth-server')).HttpError;
    vi.mocked(requireRole).mockRejectedValue(new HttpError(403, 'Forbidden'));

    const handler = roleHandler(['admin'], async () => {
      return NextResponse.json({ never: true });
    });

    const res = await handler(makeRequest());
    expect(res.status).toBe(403);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/auth/forgot-password — inaktív fiókhoz nem megy visszaállító link;
 * helyette tájékoztató e-mail („nem a jelszó hibás"). Az API-válasz a semleges
 * szöveg marad (nem árulja el kívülállónak, létezik-e a fiók).
 */
const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ getDbPool: () => ({ query: queryMock }) }));
vi.mock('@/lib/api-error-handler', () => ({
  handleApiError: vi.fn((error: any, msg: string) =>
    NextResponse.json({ error: error?.message || msg }, { status: error?.status || 500 })
  ),
}));
vi.mock('@/lib/legal/patient-data-access-log', () => ({ maybeLogPatientAccess: vi.fn() }));
const logActivityMock = vi.fn(async (..._args: unknown[]) => true);
vi.mock('@/lib/activity', () => ({ logActivity: (...a: unknown[]) => logActivityMock(...(a as [])) }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn(), debug: vi.fn() },
}));
const resetMailMock = vi.fn(async () => undefined);
const noticeMailMock = vi.fn(async () => undefined);
vi.mock('@/lib/email', () => ({
  sendPasswordResetEmail: (...a: unknown[]) => resetMailMock(...(a as [])),
  sendAccountInactiveNoticeEmail: (...a: unknown[]) => noticeMailMock(...(a as [])),
}));
const probeColumnExistsMock = vi.fn(async () => true);
vi.mock('@/lib/schema-probe', () => ({
  probeColumnExists: (...a: unknown[]) => probeColumnExistsMock(...(a as [])),
}));

import { POST } from '@/app/api/auth/forgot-password/route';

function req(email = 'doki@dev.local') {
  return new NextRequest('http://localhost/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/auth/forgot-password — inaktív fiók', () => {
  it('inaktivált fiók: tájékoztató levél, NINCS reset token, semleges válasz', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // rate limit
      .mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'doki@dev.local', active: false, deactivated_at: '2026-09-15T10:00:00Z', deactivated_by: 'admin@dev.local' }] });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatch(/Ha ez az email cím regisztrálva van/);
    expect(noticeMailMock).toHaveBeenCalledWith('doki@dev.local', 'deactivated');
    expect(resetMailMock).not.toHaveBeenCalled();
    expect(queryMock.mock.calls.some(([sql]) => /password_reset_token/.test(sql))).toBe(false);
    expect(logActivityMock.mock.calls[0][3]).toBe('inactive_user:deactivated');
  });

  it('jóváhagyásra váró fiók: „még jóváhagyásra vár" tájékoztató', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'doki@dev.local', active: false, deactivated_at: null, deactivated_by: null }] });
    await POST(req());
    expect(noticeMailMock).toHaveBeenCalledWith('doki@dev.local', 'pending_approval');
    expect(resetMailMock).not.toHaveBeenCalled();
  });

  it('aktív fiók: a szokásos reset-link megy', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'doki@dev.local', active: true, deactivated_at: null, deactivated_by: null }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE token
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(resetMailMock).toHaveBeenCalledTimes(1);
    expect(noticeMailMock).not.toHaveBeenCalled();
  });
});

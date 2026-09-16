import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/auth/login — inaktivált / jóváhagyásra váró fiók: a jelszót nem
 * is nézzük, a válasz egyértelműen kimondja, hogy NEM a jelszó hibás
 * (különben a felhasználó jelszó-visszaállítást kezdeményezne).
 */
const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ getDbPool: () => ({ query: queryMock }) }));
vi.mock('@/lib/api-error-handler', () => ({
  handleApiError: vi.fn((error: any, msg: string) =>
    NextResponse.json({ error: error?.message || msg }, { status: error?.status || 500 })
  ),
}));
vi.mock('@/lib/legal/patient-data-access-log', () => ({ maybeLogPatientAccess: vi.fn() }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => true) }));
const compareMock = vi.fn(async () => false);
vi.mock('bcryptjs', () => ({ default: { compare: (...a: unknown[]) => compareMock(...(a as [])) } }));
const probeColumnExistsMock = vi.fn(async () => true);
vi.mock('@/lib/schema-probe', () => ({
  probeColumnExists: (...a: unknown[]) => probeColumnExistsMock(...(a as [])),
}));

import { POST } from '@/app/api/auth/login/route';

function loginReq(email = 'doki@dev.local') {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: String(Date.now()) }),
  });
}

const baseUser = {
  id: 'u1',
  email: 'doki@dev.local',
  password_hash: 'hash',
  role: 'fogpótlástanász',
  restricted_view: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/auth/login — inaktív fiók', () => {
  it('inaktivált fiók: 403 ACCOUNT_DEACTIVATED, egyértelmű üzenet, jelszó-ellenőrzés nélkül', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ ...baseUser, active: false, deactivated_at: '2026-09-15T10:00:00Z', deactivated_by: 'admin@dev.local' }] });
    const res = await POST(loginReq());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ACCOUNT_DEACTIVATED');
    expect(body.accountState).toBe('deactivated');
    expect(body.error).toMatch(/inaktiválta/);
    expect(body.error).toMatch(/jelszó nem hibás/);
    expect(body.error).toMatch(/visszaállítás nem segít/);
    expect(compareMock).not.toHaveBeenCalled();
    // A lekérdezés oszlop-toleráns (to_jsonb), nem hivatkozik közvetlenül a deactivated_at oszlopra.
    expect(queryMock.mock.calls[0][0]).toMatch(/to_jsonb\(u\) ->> 'deactivated_at'/);
  });

  it('jóváhagyásra váró regisztráció: 403 ACCOUNT_PENDING_APPROVAL', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ ...baseUser, active: false, deactivated_at: null, deactivated_by: null }] });
    const res = await POST(loginReq());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ACCOUNT_PENDING_APPROVAL');
    expect(body.error).toMatch(/jóváhagyásra vár/);
    expect(body.error).toMatch(/jelszó nem hibás/);
  });

  it('100-as migráció előtt (nincs oszlop): 403 ACCOUNT_INACTIVE, a jelszó-félreértést így is kizárja', async () => {
    probeColumnExistsMock.mockResolvedValueOnce(false);
    queryMock.mockResolvedValueOnce({ rows: [{ ...baseUser, active: false, deactivated_at: null, deactivated_by: null }] });
    const res = await POST(loginReq());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ACCOUNT_INACTIVE');
    expect(body.error).toMatch(/jelszó nem hibás/);
  });

  it('aktív fiók + rossz jelszó: a régi, semleges 401 marad', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ ...baseUser, active: true, deactivated_at: null, deactivated_by: null }] });
    compareMock.mockResolvedValueOnce(false);
    const res = await POST(loginReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Hibás email cím vagy jelszó');
    expect(body.code).toBeUndefined();
  });
});

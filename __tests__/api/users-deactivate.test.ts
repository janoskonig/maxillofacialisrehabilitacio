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
    const res = NextResponse.json({ error: error?.message || msg, code: error?.code }, { status });
    if (correlationId) res.headers.set('x-correlation-id', correlationId);
    return res;
  }),
}));

vi.mock('@/lib/legal/patient-data-access-log', () => ({
  maybeLogPatientAccess: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn(), debug: vi.fn() },
}));

const sendApprovalEmailMock = vi.fn(async () => undefined);
vi.mock('@/lib/email', () => ({
  sendApprovalEmail: (...a: unknown[]) => sendApprovalEmailMock(...(a as [])),
}));
const closeTasksMock = vi.fn(async () => undefined);
const deleteTasksMock = vi.fn(async () => undefined);
vi.mock('@/lib/user-tasks', () => ({
  closeStaffRegistrationReviewTasks: (...a: unknown[]) => closeTasksMock(...(a as [])),
  deleteStaffRegistrationReviewTasks: (...a: unknown[]) => deleteTasksMock(...(a as [])),
}));
const invalidateMock = vi.fn();
vi.mock('@/lib/user-active-check', () => ({
  invalidateUserActiveCache: (...a: unknown[]) => invalidateMock(...a),
}));
const disconnectMock = vi.fn();
vi.mock('@/lib/socket-server', () => ({
  disconnectUserSockets: (...a: unknown[]) => disconnectMock(...a),
}));

import { PUT, DELETE } from '@/app/api/users/[id]/route';
import { requireAuth, requireRole } from '@/lib/auth-server';

const admin = { userId: 'admin-1', email: 'admin@dev.local', role: 'admin' as const };
const TARGET = 'user-2';

function putReq(body: unknown) {
  return new NextRequest(`http://localhost/api/users/${TARGET}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function deleteReq() {
  return new NextRequest(`http://localhost/api/users/${TARGET}`, { method: 'DELETE' });
}

const activeDoctor = { id: TARGET, email: 'doki@dev.local', role: 'fogpótlástanász', active: true, deactivated_at: null };
const pendingDoctor = { ...activeDoctor, active: false, deactivated_at: null };
const deactivatedDoctor = { ...activeDoctor, active: false, deactivated_at: '2026-09-01T10:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(admin);
  vi.mocked(requireRole).mockResolvedValue(admin);
});

describe('PUT /api/users/[id] — inaktiválás', () => {
  it('active=false: deactivated_at/by beíródik, session-cache + socket + feladatok kezelve', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [activeDoctor] }) // SELECT user
      .mockResolvedValueOnce({ rows: [{ ...activeDoctor, active: false, deactivated_at: 'now', deactivated_by: admin.email }] }); // UPDATE
    const res = await PUT(putReq({ active: false }), { params: { id: TARGET } });
    expect(res.status).toBe(200);
    const [updateSql, params] = queryMock.mock.calls[1];
    expect(updateSql).toMatch(/UPDATE users SET/);
    expect(updateSql).toMatch(/active = \$1/);
    expect(updateSql).toMatch(/deactivated_at = CURRENT_TIMESTAMP/);
    expect(updateSql).toMatch(/deactivated_by = \$2/);
    expect(params).toEqual([false, admin.email, TARGET]);
    expect(invalidateMock).toHaveBeenCalledWith(TARGET);
    expect(disconnectMock).toHaveBeenCalledWith(TARGET);
    expect(closeTasksMock).toHaveBeenCalledWith(TARGET, 'cancelled');
    expect(sendApprovalEmailMock).not.toHaveBeenCalled();
  });

  it('saját fiók inaktiválása → 400, nem ír', async () => {
    const self = { ...activeDoctor, id: admin.userId, role: 'admin' };
    queryMock.mockResolvedValueOnce({ rows: [self] });
    const res = await PUT(putReq({ active: false }), { params: { id: admin.userId } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('CANNOT_DEACTIVATE_SELF');
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('utolsó aktív admin → 409', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ ...activeDoctor, role: 'admin' }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }); // más aktív admin nincs
    const res = await PUT(putReq({ active: false }), { params: { id: TARGET } });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('LAST_ACTIVE_ADMIN');
  });

  it('nem admin nem inaktiválhat → 403', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'other', email: 'o@dev.local', role: 'fogpótlástanász' });
    queryMock.mockResolvedValueOnce({ rows: [activeDoctor] });
    const res = await PUT(putReq({ active: false }), { params: { id: TARGET } });
    expect(res.status).toBe(403);
  });

  it('újraaktiválás: deactivated_* törlődik, NEM megy jóváhagyó levél', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [deactivatedDoctor] })
      .mockResolvedValueOnce({ rows: [{ ...activeDoctor }] });
    const res = await PUT(putReq({ active: true }), { params: { id: TARGET } });
    expect(res.status).toBe(200);
    const [updateSql, params] = queryMock.mock.calls[1];
    expect(updateSql).toMatch(/deactivated_at = NULL/);
    expect(updateSql).toMatch(/deactivated_by = NULL/);
    expect(params).toEqual([true, TARGET]);
    expect(invalidateMock).toHaveBeenCalledWith(TARGET);
    expect(sendApprovalEmailMock).not.toHaveBeenCalled();
    expect(closeTasksMock).not.toHaveBeenCalled();
  });

  it('első jóváhagyás (regisztráció): jóváhagyó levél + feladat lezárás', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [pendingDoctor] })
      .mockResolvedValueOnce({ rows: [{ ...activeDoctor }] });
    const res = await PUT(putReq({ active: true }), { params: { id: TARGET } });
    expect(res.status).toBe(200);
    expect(sendApprovalEmailMock).toHaveBeenCalledWith(activeDoctor.email);
    expect(closeTasksMock).toHaveBeenCalledWith(TARGET, 'done');
  });

  it('active nem boolean → 400', async () => {
    queryMock.mockResolvedValueOnce({ rows: [activeDoctor] });
    const res = await PUT(putReq({ active: 'no' }), { params: { id: TARGET } });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/users/[id]', () => {
  it('jóváhagyásra váró regisztráció: fizikai törlés', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [pendingDoctor] })
      .mockResolvedValueOnce({ rows: [] }); // DELETE
    const res = await DELETE(deleteReq(), { params: { id: TARGET } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, deleted: true });
    expect(deleteTasksMock).toHaveBeenCalledWith(TARGET);
    expect(queryMock.mock.calls[1][0]).toMatch(/DELETE FROM users/);
  });

  it('aktív fiók: soft-inaktiválás (nem törlés)', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [activeDoctor] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE
    const res = await DELETE(deleteReq(), { params: { id: TARGET } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, deleted: false, deactivated: true });
    expect(queryMock.mock.calls[1][0]).toMatch(/UPDATE users/);
    expect(queryMock.mock.calls[1][0]).toMatch(/deactivated_at = CURRENT_TIMESTAMP/);
    expect(queryMock.mock.calls.some(([sql]) => /DELETE FROM users/.test(sql))).toBe(false);
    expect(disconnectMock).toHaveBeenCalledWith(TARGET);
  });

  it('már inaktivált fiók: 409, semmi nem törlődik', async () => {
    queryMock.mockResolvedValueOnce({ rows: [deactivatedDoctor] });
    const res = await DELETE(deleteReq(), { params: { id: TARGET } });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('USER_ALREADY_DEACTIVATED');
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});

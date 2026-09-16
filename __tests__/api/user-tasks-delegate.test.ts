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

const getUserInstitutionMock = vi.fn(async () => 'SE Fogpótlástani Klinika');
const ensurePatientVisibleMock = vi.fn(async () => undefined);
vi.mock('@/lib/consilium', () => ({
  getUserInstitution: (...a: unknown[]) => getUserInstitutionMock(...(a as [])),
  ensurePatientVisibleForUser: (...a: unknown[]) => ensurePatientVisibleMock(...(a as [])),
}));

const delegateStaffTaskMock = vi.fn(async (_p: unknown) => true);
const insertUserTaskMock = vi.fn(async (p: Record<string, unknown>) => ({
  id: 'task-new',
  status: 'open',
  ...p,
}));
vi.mock('@/lib/user-tasks', () => ({
  delegateStaffTask: (...a: unknown[]) => delegateStaffTaskMock(...(a as [unknown])),
  insertUserTask: (...a: unknown[]) => insertUserTaskMock(...(a as [Record<string, unknown>])),
  listOpenTasksForStaff: vi.fn(async () => []),
}));

import { POST as delegatePOST } from '@/app/api/user-tasks/[id]/delegate/route';
import { POST as createPOST } from '@/app/api/user-tasks/route';
import { requireAuth } from '@/lib/auth-server';

const DOCTOR = {
  userId: '0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d',
  email: 'doktor@dev.local',
  role: 'fogpótlástanász' as const,
};
const TECHNIKUS = {
  userId: '6f1d2c3b-4a5e-4f60-8b7c-9d0e1f2a3b4c',
  email: 'technikus@dev.local',
  role: 'technikus' as const,
};
const TASK_ID = '123e4567-e89b-42d3-a456-426614174000';
const ASSIGNABLE_ROW = { rows: [{ '?column?': 1 }] };

function delegateReq(assigneeUserId: string) {
  return new NextRequest(`http://localhost/api/user-tasks/${TASK_ID}/delegate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assigneeUserId }),
  });
}

function createReq(body: unknown) {
  return new NextRequest('http://localhost/api/user-tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  queryMock.mockReset();
  delegateStaffTaskMock.mockClear();
  insertUserTaskMock.mockClear();
});

describe('POST /api/user-tasks/:id/delegate — technikus címzett', () => {
  it('fogpótlástanász technikusnak delegál: elfogadva, a címzett-ellenőrzés nem szűr szerepkörre', async () => {
    vi.mocked(requireAuth).mockResolvedValue(DOCTOR);
    queryMock.mockResolvedValueOnce(ASSIGNABLE_ROW);

    const res = await delegatePOST(delegateReq(TECHNIKUS.userId), { params: { id: TASK_ID } });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).not.toMatch(/technikus/);
    expect(params).toEqual([TECHNIKUS.userId, 'SE Fogpótlástani Klinika']);

    expect(delegateStaffTaskMock).toHaveBeenCalledWith({
      taskId: TASK_ID,
      fromUserId: DOCTOR.userId,
      toUserId: TECHNIKUS.userId,
    });
  });

  it('technikus is továbbadhatja a saját feladatát (korábban 403)', async () => {
    vi.mocked(requireAuth).mockResolvedValue(TECHNIKUS);
    queryMock.mockResolvedValueOnce(ASSIGNABLE_ROW);

    const res = await delegatePOST(delegateReq(DOCTOR.userId), { params: { id: TASK_ID } });
    expect(res.status).toBe(200);
    expect(delegateStaffTaskMock).toHaveBeenCalledWith({
      taskId: TASK_ID,
      fromUserId: TECHNIKUS.userId,
      toUserId: DOCTOR.userId,
    });
  });

  it('inaktív / más intézményű címzett: 400, a hibaüzenet már nem említi a technikust', async () => {
    vi.mocked(requireAuth).mockResolvedValue(DOCTOR);
    queryMock.mockResolvedValueOnce({ rows: [] });

    const res = await delegatePOST(delegateReq(TECHNIKUS.userId), { params: { id: TASK_ID } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('A címzett nem található, inaktív, vagy nem kiosztható');
    expect(delegateStaffTaskMock).not.toHaveBeenCalled();
  });

  it('önmagának nem delegálhat', async () => {
    vi.mocked(requireAuth).mockResolvedValue(DOCTOR);

    const res = await delegatePOST(delegateReq(DOCTOR.userId), { params: { id: TASK_ID } });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
    expect(delegateStaffTaskMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/user-tasks — kézi teendő technikusnak / technikustól', () => {
  it('fogpótlástanász kézi teendőt hoz létre technikusnak', async () => {
    vi.mocked(requireAuth).mockResolvedValue(DOCTOR);
    queryMock.mockResolvedValueOnce(ASSIGNABLE_ROW);

    const res = await createPOST(
      createReq({ title: 'kinyomtatni a lemezt', assigneeUserId: TECHNIKUS.userId }),
    );
    expect(res.status).toBe(200);
    expect(insertUserTaskMock).toHaveBeenCalledTimes(1);
    expect(insertUserTaskMock.mock.calls[0][0]).toMatchObject({
      assigneeKind: 'staff',
      assigneeUserId: TECHNIKUS.userId,
      taskType: 'manual',
      title: 'kinyomtatni a lemezt',
      createdByUserId: DOCTOR.userId,
    });
  });

  it('technikus is delegálhat kézi teendőt kollégának (korábban 403)', async () => {
    vi.mocked(requireAuth).mockResolvedValue(TECHNIKUS);
    queryMock.mockResolvedValueOnce(ASSIGNABLE_ROW);

    const res = await createPOST(createReq({ title: 'Új lenyomat kell', assigneeUserId: DOCTOR.userId }));
    expect(res.status).toBe(200);
    expect(insertUserTaskMock.mock.calls[0][0]).toMatchObject({
      assigneeUserId: DOCTOR.userId,
      createdByUserId: TECHNIKUS.userId,
    });
  });

  it('címzett nélkül saját teendő, címzett-ellenőrzés nélkül', async () => {
    vi.mocked(requireAuth).mockResolvedValue(TECHNIKUS);

    const res = await createPOST(createReq({ title: 'Saját jegyzet' }));
    expect(res.status).toBe(200);
    expect(queryMock).not.toHaveBeenCalled();
    expect(insertUserTaskMock.mock.calls[0][0]).toMatchObject({ assigneeUserId: TECHNIKUS.userId });
  });
});

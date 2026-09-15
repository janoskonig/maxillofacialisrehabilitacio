import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ getDbPool: () => ({ query: vi.fn() }) }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn(), debug: vi.fn() },
}));
const invalidateMock = vi.fn();
vi.mock('@/lib/user-active-check', () => ({
  invalidateUserActiveCache: (...a: unknown[]) => invalidateMock(...a),
}));
const disconnectMock = vi.fn();
vi.mock('@/lib/socket-server', () => ({
  disconnectUserSockets: (...a: unknown[]) => disconnectMock(...a),
}));
const closeTasksMock = vi.fn(async () => undefined);
vi.mock('@/lib/user-tasks', () => ({
  closeStaffRegistrationReviewTasks: (...a: unknown[]) => closeTasksMock(...(a as [])),
}));

import {
  assertCanDeactivate,
  deactivateUserAccount,
  userAccountState,
} from '@/lib/user-deactivation';
import { HttpError } from '@/lib/auth-server';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('userAccountState', () => {
  it('megkülönbözteti az aktív, a jóváhagyásra váró és az inaktivált fiókot', () => {
    expect(userAccountState({ active: true, deactivated_at: null })).toBe('active');
    expect(userAccountState({ active: false, deactivated_at: null })).toBe('pending_approval');
    expect(userAccountState({ active: false, deactivated_at: '2026-09-15T10:00:00Z' })).toBe('deactivated');
  });
});

describe('assertCanDeactivate', () => {
  const pool = { query: vi.fn() };

  it('saját fiók → 400', async () => {
    await expect(
      assertCanDeactivate(pool as any, { id: 'me', role: 'admin', active: true }, 'me')
    ).rejects.toMatchObject({ status: 400, code: 'CANNOT_DEACTIVATE_SELF' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('utolsó aktív admin → 409', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    await expect(
      assertCanDeactivate(pool as any, { id: 'a1', role: 'admin', active: true }, 'me')
    ).rejects.toMatchObject({ status: 409, code: 'LAST_ACTIVE_ADMIN' });
  });

  it('másik admin is aktív → engedélyezett', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ count: 1 }] });
    await expect(
      assertCanDeactivate(pool as any, { id: 'a1', role: 'admin', active: true }, 'me')
    ).resolves.toBeUndefined();
  });

  it('nem-admin fióknál nincs admin-számlálás', async () => {
    await expect(
      assertCanDeactivate(pool as any, { id: 'f1', role: 'fogpótlástanász', active: true }, 'me')
    ).resolves.toBeUndefined();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('HttpError példány (a route hibakezelője kezeli)', async () => {
    await assertCanDeactivate(pool as any, { id: 'me', role: 'admin', active: true }, 'me').catch((e) => {
      expect(e).toBeInstanceOf(HttpError);
    });
  });
});

describe('deactivateUserAccount', () => {
  it('active=false + deactivated_at/by, majd cache-érvénytelenítés, socket-bontás, feladat-lezárás', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await deactivateUserAccount(pool as any, 'u9', 'admin@dev.local');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/active = false/);
    expect(sql).toMatch(/deactivated_at = CURRENT_TIMESTAMP/);
    expect(sql).toMatch(/deactivated_by = \$2/);
    expect(params).toEqual(['u9', 'admin@dev.local']);
    expect(invalidateMock).toHaveBeenCalledWith('u9');
    expect(disconnectMock).toHaveBeenCalledWith('u9');
    expect(closeTasksMock).toHaveBeenCalledWith('u9', 'cancelled');
  });
});

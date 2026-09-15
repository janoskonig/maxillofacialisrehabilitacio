import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getDbPool: () => ({ query: queryMock }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn(), debug: vi.fn() },
}));

import {
  isUserActive,
  invalidateUserActiveCache,
  userActiveCacheSize,
  USER_ACTIVE_CACHE_TTL_MS,
} from '@/lib/user-active-check';

/**
 * A JWT fölötti fiók-aktivitás ellenőrzés: rövid TTL-ű cache, inaktiválás
 * után azonnali érvénytelenítés, DB-hiba esetén fail-open.
 */
beforeEach(() => {
  vi.clearAllMocks();
  invalidateUserActiveCache();
});

describe('isUserActive', () => {
  it('lekérdezi a users.active értéket és cache-eli', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ active: true }] });
    expect(await isUserActive('u1', { now: 1000 })).toBe(true);
    expect(await isUserActive('u1', { now: 1000 + USER_ACTIVE_CACHE_TTL_MS - 1 })).toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual(['u1']);
  });

  it('inaktív / nem létező felhasználóra false', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ active: false }] });
    expect(await isUserActive('inaktiv')).toBe(false);
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await isUserActive('torolt')).toBe(false);
  });

  it('a TTL lejárta után újra lekérdez', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ active: true }] });
    await isUserActive('u1', { now: 1000 });
    queryMock.mockResolvedValueOnce({ rows: [{ active: false }] });
    expect(await isUserActive('u1', { now: 1000 + USER_ACTIVE_CACHE_TTL_MS + 1 })).toBe(false);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('invalidateUserActiveCache után azonnal a friss DB-állapot érvényes', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ active: true }] });
    await isUserActive('u1', { now: 1000 });
    invalidateUserActiveCache('u1');
    expect(userActiveCacheSize()).toBe(0);
    queryMock.mockResolvedValueOnce({ rows: [{ active: false }] });
    expect(await isUserActive('u1', { now: 1001 })).toBe(false);
  });

  it('DB-hiba esetén fail-open: ismert állapot, különben aktív', async () => {
    queryMock.mockRejectedValueOnce(new Error('53300 too many clients'));
    expect(await isUserActive('friss')).toBe(true);

    queryMock.mockResolvedValueOnce({ rows: [{ active: false }] });
    await isUserActive('regi', { now: 1000 });
    queryMock.mockRejectedValueOnce(new Error('db down'));
    // A lejárt, de ismert (inaktív) bejegyzés hiba esetén is inaktív marad.
    expect(await isUserActive('regi', { now: 1000 + USER_ACTIVE_CACHE_TTL_MS + 1 })).toBe(false);
  });
});

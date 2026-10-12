import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/lib/db', () => ({ getDbPool: () => ({ query }) }));

import { verifyPortalToken } from '@/lib/patient-portal-auth';

const TOKEN = 'a'.repeat(64);
const PATIENT_ID = '00000000-0000-4000-8000-000000000001';
const DATABASE_NOW = new Date('2026-10-12T08:00:00.000Z');

type TokenRow = {
  patient_id: string;
  token_type: 'magic_link' | 'email_verification';
  expires_at: Date;
  used_at: Date | null;
};

let row: TokenRow | null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(DATABASE_NOW);
  row = {
    patient_id: PATIENT_ID,
    token_type: 'magic_link',
    expires_at: new Date(DATABASE_NOW.getTime() + 60_000),
    used_at: null,
  };
  query.mockReset();

  // Model statement-level row updates and snapshots. Separate concurrent
  // SELECTs both see an unused row; a guarded UPDATE can claim it only once.
  query.mockImplementation(async (sql: string, params: string[]) => {
    const matchesToken = row && params[0] === TOKEN;
    const matchesType = !params[1] || params[1] === row?.token_type;
    const checksExpiry = /expires_at\s*>\s*CURRENT_TIMESTAMP/i.test(sql);
    const unexpired = row && row.expires_at > DATABASE_NOW;
    if (!matchesToken || !matchesType || (checksExpiry && !unexpired)) {
      return { rows: [] };
    }

    if (/^\s*UPDATE/i.test(sql)) {
      if (/used_at\s+IS NULL/i.test(sql) && row!.used_at) {
        return { rows: [] };
      }
      row!.used_at = DATABASE_NOW;
      return { rows: /RETURNING/i.test(sql) ? [{ ...row }] : [] };
    }

    return { rows: [{ ...row }] };
  });
});

afterEach(() => vi.useRealTimers());

describe('verifyPortalToken', () => {
  it('allows exactly one new login when two requests claim the same link', async () => {
    const results = await Promise.all([
      verifyPortalToken(TOKEN),
      verifyPortalToken(TOKEN),
    ]);

    expect(results).toEqual([
      { patientId: PATIENT_ID, isUsed: false },
      { patientId: PATIENT_ID, isUsed: true },
    ]);
    expect(row!.used_at).toEqual(DATABASE_NOW);
  });

  it('reports an already-used link without changing its consumption time', async () => {
    const usedAt = new Date(DATABASE_NOW.getTime() - 30_000);
    row!.used_at = usedAt;

    await expect(verifyPortalToken(TOKEN)).resolves.toEqual({
      patientId: PATIENT_ID,
      isUsed: true,
    });
    expect(row!.used_at).toEqual(usedAt);
  });

  it.each([-1, 0])('rejects a link with expiry offset %i ms without consuming it', async offset => {
    row!.expires_at = new Date(DATABASE_NOW.getTime() + offset);

    await expect(verifyPortalToken(TOKEN)).resolves.toBeNull();
    expect(row!.used_at).toBeNull();
  });

  it('rejects an expired link even when it was already used', async () => {
    row!.expires_at = new Date(DATABASE_NOW.getTime() - 1);
    row!.used_at = new Date(DATABASE_NOW.getTime() - 30_000);

    await expect(verifyPortalToken(TOKEN)).resolves.toBeNull();
  });

  it('rejects a missing link and a token of the wrong type', async () => {
    await expect(verifyPortalToken('b'.repeat(64))).resolves.toBeNull();
    row!.token_type = 'email_verification';
    await expect(verifyPortalToken(TOKEN)).resolves.toBeNull();
    expect(row!.used_at).toBeNull();
  });

  it('keeps valid email verification non-consuming and repeatable', async () => {
    row!.token_type = 'email_verification';

    const results = await Promise.all([
      verifyPortalToken(TOKEN, 'email_verification'),
      verifyPortalToken(TOKEN, 'email_verification'),
    ]);

    expect(results).toEqual([
      { patientId: PATIENT_ID, isUsed: false },
      { patientId: PATIENT_ID, isUsed: false },
    ]);
    expect(row!.used_at).toBeNull();
    expect(query.mock.calls.every(([sql]) => !/^\s*UPDATE/i.test(sql))).toBe(true);
  });

  it('preserves email verification semantics if used_at was populated', async () => {
    row!.token_type = 'email_verification';
    row!.used_at = DATABASE_NOW;

    await expect(verifyPortalToken(TOKEN, 'email_verification')).resolves.toEqual({
      patientId: PATIENT_ID,
      isUsed: false,
    });
  });

  it('rejects expired email verification without updating it', async () => {
    row!.token_type = 'email_verification';
    row!.expires_at = new Date(DATABASE_NOW.getTime() - 1);

    await expect(verifyPortalToken(TOKEN, 'email_verification')).resolves.toBeNull();
    expect(row!.used_at).toBeNull();
  });
});

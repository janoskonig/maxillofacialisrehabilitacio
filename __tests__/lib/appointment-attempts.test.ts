/**
 * Unit tests for `lib/appointment-attempts.ts` — the `attempt_number`
 * computation introduced in migration 029.
 *
 * The counting rule (see lib/appointment-attempts.ts):
 *   • Counts only "real attempts" — appointments where the visit happened
 *     or was supposed to (`completed`, `unsuccessful`, `no_show`).
 *   • Does NOT count `NULL` (still pending — typically rebook target) or
 *     `cancelled_*` (visit didn't happen, slot freed).
 *   • New attempt = real-attempt count + 1; minimum 1.
 *   • Returns 1 if either episodeId or stepCode is missing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  nextAttemptNumber,
  ATTEMPT_COUNTING_STATUSES,
  resetAttemptColumnsExistCache,
  setAttemptColumnsExist,
  probeAttemptColumns,
} from '@/lib/appointment-attempts';

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function makeFakeDb(rowsToReturn: Array<{ prior_attempts: number }> = [{ prior_attempts: 0 }]) {
  const calls: RecordedQuery[] = [];
  let nextRows = rowsToReturn;
  return {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const rows = nextRows;
      return { rows };
    },
    setNextRows: (rows: Array<{ prior_attempts: number }>) => {
      nextRows = rows;
    },
    calls,
  };
}

describe('ATTEMPT_COUNTING_STATUSES', () => {
  it('contains exactly the three "real attempt" statuses', () => {
    expect([...ATTEMPT_COUNTING_STATUSES]).toEqual(['completed', 'unsuccessful', 'no_show']);
  });

  it('does NOT include cancelled or pending (NULL)', () => {
    const set = new Set<string>(ATTEMPT_COUNTING_STATUSES);
    expect(set.has('cancelled_by_doctor')).toBe(false);
    expect(set.has('cancelled_by_patient')).toBe(false);
    expect(set.has('pending')).toBe(false);
  });
});

describe('nextAttemptNumber', () => {
  it('returns 1 when episodeId is missing (e.g. consult/control booking)', async () => {
    const db = makeFakeDb();
    const n = await nextAttemptNumber(db, null, 'STEP_X');
    expect(n).toBe(1);
    expect(db.calls).toHaveLength(0);
  });

  it('returns 1 when stepCode is missing', async () => {
    const db = makeFakeDb();
    const n = await nextAttemptNumber(db, 'episode-1', null);
    expect(n).toBe(1);
    expect(db.calls).toHaveLength(0);
  });

  it('returns 1 for the first booking (no prior real attempts)', async () => {
    const db = makeFakeDb([{ prior_attempts: 0 }]);
    const n = await nextAttemptNumber(db, 'episode-1', 'STEP_LENYOMAT');
    expect(n).toBe(1);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].params).toEqual(['episode-1', 'STEP_LENYOMAT']);
  });

  it('returns 2 when one prior attempt was unsuccessful', async () => {
    const db = makeFakeDb([{ prior_attempts: 1 }]);
    const n = await nextAttemptNumber(db, 'episode-1', 'STEP_LENYOMAT');
    expect(n).toBe(2);
  });

  it('returns 3 when two prior attempts (e.g. unsuccessful + no_show)', async () => {
    const db = makeFakeDb([{ prior_attempts: 2 }]);
    const n = await nextAttemptNumber(db, 'episode-1', 'STEP_LENYOMAT');
    expect(n).toBe(3);
  });

  it('SQL: filters by exactly the three counting statuses (no cancelled, no NULL)', async () => {
    const db = makeFakeDb([{ prior_attempts: 0 }]);
    await nextAttemptNumber(db, 'ep', 'STEP');
    const sql = db.calls[0].sql;
    expect(sql).toMatch(/appointment_status\s+IN\s*\(/);
    expect(sql).toContain("'completed'");
    expect(sql).toContain("'unsuccessful'");
    expect(sql).toContain("'no_show'");
    expect(sql).not.toMatch(/cancelled/);
    expect(sql).not.toMatch(/IS\s+NULL/);
  });

  it('SQL: scopes by both episode_id and step_code', async () => {
    const db = makeFakeDb([{ prior_attempts: 0 }]);
    await nextAttemptNumber(db, 'ep', 'STEP');
    const sql = db.calls[0].sql;
    expect(sql).toMatch(/episode_id\s*=\s*\$1/);
    expect(sql).toMatch(/step_code\s*=\s*\$2/);
  });

  it('handles missing/non-numeric COUNT result defensively (treats as 0 → returns 1)', async () => {
    const db = makeFakeDb([]);
    const n = await nextAttemptNumber(db, 'ep', 'STEP');
    expect(n).toBe(1);
  });
});

describe('probeAttemptColumns / setAttemptColumnsExist', () => {
  beforeEach(() => {
    resetAttemptColumnsExistCache();
  });

  it('caches the probe result across calls (one DB hit)', async () => {
    let queryCount = 0;
    const db = {
      query: async () => {
        queryCount++;
        return { rows: [{ exists: true }] };
      },
    };
    expect(await probeAttemptColumns(db)).toBe(true);
    expect(await probeAttemptColumns(db)).toBe(true);
    expect(await probeAttemptColumns(db)).toBe(true);
    expect(queryCount).toBe(1);
  });

  it('returns false on probe failure (legacy DB without migration 029)', async () => {
    const db = {
      query: async () => {
        throw new Error('relation "information_schema.columns" does not exist');
      },
    };
    expect(await probeAttemptColumns(db)).toBe(false);
  });

  it('setAttemptColumnsExist() lets tests bypass the probe', async () => {
    setAttemptColumnsExist(true);
    let queryCount = 0;
    const db = {
      query: async () => {
        queryCount++;
        return { rows: [{ exists: false }] };
      },
    };
    expect(await probeAttemptColumns(db)).toBe(true);
    expect(queryCount).toBe(0);
  });
});

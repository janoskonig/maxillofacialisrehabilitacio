import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recomputeKezeleoorvos, type DbQueryable } from '@/lib/recompute-kezeleoorvos';

// Two stable UUIDs we'll reuse. Format must pass validateUUID().
const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
const DR_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DR_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * Builds a deterministic mock DbQueryable. Provide responses *in the order the
 * service issues them*:
 *   1) SELECT current kezeleoorvos_user_id  (patient existence + previous value)
 *   2) SELECT episode (B-eset)
 *   3) SELECT appointment (A-eset)  — only fired if (2) returns no rows
 *   4) UPDATE patients               — only fired if a candidate exists
 *
 * Pass `null` to skip a step that the service is expected to NOT issue.
 */
function makeDb(plan: { rows: any[]; rowCount?: number }[]): {
  db: DbQueryable;
  query: ReturnType<typeof vi.fn>;
  calls: { sql: string; params: unknown[] | undefined }[];
} {
  const calls: { sql: string; params: unknown[] | undefined }[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    const next = plan.shift();
    if (!next) {
      throw new Error(
        `Unexpected query #${calls.length}: ${sql.slice(0, 120).replace(/\s+/g, ' ')}`
      );
    }
    return next;
  });
  return { db: { query } as DbQueryable, query, calls };
}

describe('recomputeKezeleoorvos', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('input validation', () => {
    it('rejects malformed patient id before touching the DB', async () => {
      const { db, query } = makeDb([]);
      await expect(recomputeKezeleoorvos('not-a-uuid', db)).rejects.toThrow();
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('patient existence', () => {
    it('returns silent no-op when patient does not exist', async () => {
      const { db, query } = makeDb([{ rows: [] }]);
      const result = await recomputeKezeleoorvos(PATIENT_ID, db);
      expect(result).toEqual({
        changed: false,
        userId: null,
        name: null,
        source: 'none',
        previousUserId: null,
      });
      expect(query).toHaveBeenCalledTimes(1); // Only the existence check.
    });
  });

  describe('B-eset: epizód provider nyer', () => {
    it('writes episode provider when previous value differs', async () => {
      const { db, query, calls } = makeDb([
        { rows: [{ kezeleoorvos_user_id: null }] },
        { rows: [{ user_id: DR_B_ID, name: 'Dr. B' }] },
        { rows: [], rowCount: 1 }, // UPDATE
      ]);

      const result = await recomputeKezeleoorvos(PATIENT_ID, db);

      expect(result).toEqual({
        changed: true,
        userId: DR_B_ID,
        name: 'Dr. B',
        source: 'episode',
        previousUserId: null,
      });
      expect(query).toHaveBeenCalledTimes(3);
      // The third query must be the UPDATE that writes both columns.
      expect(calls[2].sql).toMatch(/UPDATE\s+patients/);
      expect(calls[2].sql).toContain('kezeleoorvos_user_id');
      expect(calls[2].sql).toContain('kezeleoorvos = $2');
      expect(calls[2].params).toEqual([DR_B_ID, 'Dr. B', PATIENT_ID]);
    });

    it('returns changed=false when episode provider equals current', async () => {
      const { db, query, calls } = makeDb([
        { rows: [{ kezeleoorvos_user_id: DR_B_ID }] },
        { rows: [{ user_id: DR_B_ID, name: 'Dr. B' }] },
        { rows: [], rowCount: 0 }, // name-drift sub-update (no-op)
      ]);

      const result = await recomputeKezeleoorvos(PATIENT_ID, db);

      expect(result.changed).toBe(false);
      expect(result.userId).toBe(DR_B_ID);
      expect(result.source).toBe('episode');
      // The third query is the name-drift UPDATE, not the full one.
      expect(calls[2].sql).toMatch(/UPDATE\s+patients\s+SET\s+kezeleoorvos\s*=\s*\$1/);
      expect(calls[2].sql).not.toContain('kezeleoorvos_user_id');
      expect(query).toHaveBeenCalledTimes(3);
    });
  });

  describe('A-eset: appointment dentist nyer', () => {
    it('falls through to appointment when no episode provider exists', async () => {
      const { db, query, calls } = makeDb([
        { rows: [{ kezeleoorvos_user_id: null }] },
        { rows: [] }, // No episode candidate
        { rows: [{ user_id: DR_A_ID, name: 'Dr. A' }] },
        { rows: [], rowCount: 1 }, // UPDATE
      ]);

      const result = await recomputeKezeleoorvos(PATIENT_ID, db);

      expect(result).toEqual({
        changed: true,
        userId: DR_A_ID,
        name: 'Dr. A',
        source: 'appointment',
        previousUserId: null,
      });
      expect(query).toHaveBeenCalledTimes(4);
      // Confirm the appointment query filters cancelled & rejected.
      expect(calls[2].sql).toContain('cancelled_by_doctor');
      expect(calls[2].sql).toContain('cancelled_by_patient');
      expect(calls[2].sql).toContain('rejected');
      // Confirm 30-day past window.
      expect(calls[2].sql).toContain("interval '30 days'");
      // Confirm "nearest to now()" ordering by absolute time delta.
      expect(calls[2].sql).toMatch(/ABS\(\s*EXTRACT\(\s*EPOCH/);
    });
  });

  describe('B beats A (priority)', () => {
    it('does not query appointments when an episode provider exists', async () => {
      const { db, query } = makeDb([
        { rows: [{ kezeleoorvos_user_id: null }] },
        { rows: [{ user_id: DR_B_ID, name: 'Dr. B' }] },
        { rows: [], rowCount: 1 },
      ]);

      const result = await recomputeKezeleoorvos(PATIENT_ID, db);

      expect(result.source).toBe('episode');
      expect(result.userId).toBe(DR_B_ID);
      // Exactly 3 queries: existence + episode + UPDATE. No appointment query.
      expect(query).toHaveBeenCalledTimes(3);
    });
  });

  describe('no candidates: never overwrite ("ne vonja vissza")', () => {
    it('keeps previous value when both lookups return empty', async () => {
      const { db, query, calls } = makeDb([
        { rows: [{ kezeleoorvos_user_id: DR_A_ID }] },
        { rows: [] }, // No episode
        { rows: [] }, // No appointment
      ]);

      const result = await recomputeKezeleoorvos(PATIENT_ID, db);

      expect(result).toEqual({
        changed: false,
        userId: DR_A_ID, // Previous value preserved.
        name: null,
        source: 'none',
        previousUserId: DR_A_ID,
      });
      // Critically: no UPDATE issued.
      expect(query).toHaveBeenCalledTimes(3);
      expect(calls.find((c) => /UPDATE/.test(c.sql))).toBeUndefined();
    });
  });

  describe('episode query semantics', () => {
    it('orders by opened_at DESC and filters status=active + provider not null', async () => {
      const { db, calls } = makeDb([
        { rows: [{ kezeleoorvos_user_id: null }] },
        { rows: [] },
        { rows: [] },
      ]);
      await recomputeKezeleoorvos(PATIENT_ID, db);
      const episodeSql = calls[1].sql;
      expect(episodeSql).toContain("status = 'active'");
      expect(episodeSql).toContain('assigned_provider_id IS NOT NULL');
      expect(episodeSql).toMatch(/ORDER BY pe\.opened_at DESC/);
      expect(episodeSql).toContain('LIMIT 1');
    });
  });
});

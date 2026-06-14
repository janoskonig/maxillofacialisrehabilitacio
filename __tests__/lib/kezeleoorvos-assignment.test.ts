import { describe, it, expect, vi } from 'vitest';
import {
  assignKezeleoorvos,
  applyKezeleoorvosFromForm,
  type DbQueryable,
} from '@/lib/kezeleoorvos-assignment';

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
const DR_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DR_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAFF_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** Deterministic mock: provide query responses in issue order. */
function makeDb(plan: { rows: any[]; rowCount?: number }[]): {
  db: DbQueryable;
  query: ReturnType<typeof vi.fn>;
  calls: { sql: string; params: unknown[] | undefined }[];
} {
  const calls: { sql: string; params: unknown[] | undefined }[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    const next = plan.shift();
    if (!next) throw new Error(`Unexpected query #${calls.length}: ${sql.slice(0, 100)}`);
    return next;
  });
  return { db: { query } as DbQueryable, query, calls };
}

describe('assignKezeleoorvos', () => {
  it('rejects malformed patient id before touching the DB', async () => {
    const { db, query } = makeDb([]);
    await expect(assignKezeleoorvos('nope', DR_A_ID, STAFF_ID, db)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('returns no-op when patient does not exist', async () => {
    const { db } = makeDb([{ rows: [] }]);
    const res = await assignKezeleoorvos(PATIENT_ID, DR_A_ID, STAFF_ID, db);
    expect(res).toEqual({ changed: false, userId: null, name: null, intezmeny: null });
  });

  it('assigns a new doctor with a fresh sticky stamp (assigned_at = NOW)', async () => {
    const { db, calls } = makeDb([
      { rows: [{ kezeleoorvos_user_id: null }] }, // current
      { rows: [{ name: 'Dr. A', intezmeny: 'Klinika X' }] }, // user lookup
      { rows: [], rowCount: 1 }, // UPDATE (changed branch)
    ]);
    const res = await assignKezeleoorvos(PATIENT_ID, DR_A_ID, STAFF_ID, db);
    expect(res).toEqual({ changed: true, userId: DR_A_ID, name: 'Dr. A', intezmeny: 'Klinika X' });
    // The changed-branch UPDATE stamps assigned_at = NOW() and assigned_by.
    expect(calls[2].sql).toContain('kezeleoorvos_assigned_at = NOW()');
    expect(calls[2].params).toContain(STAFF_ID);
  });

  it('same doctor (autosave) syncs name but preserves the original stamp', async () => {
    const { db, calls } = makeDb([
      { rows: [{ kezeleoorvos_user_id: DR_A_ID }] }, // current == candidate
      { rows: [{ name: 'Dr. A', intezmeny: 'Klinika X' }] }, // user lookup
      { rows: [], rowCount: 1 }, // UPDATE (unchanged branch)
    ]);
    const res = await assignKezeleoorvos(PATIENT_ID, DR_A_ID, STAFF_ID, db);
    expect(res.changed).toBe(false);
    // Unchanged branch must NOT reset assigned_at to NOW unconditionally.
    expect(calls[2].sql).toContain('COALESCE(kezeleoorvos_assigned_at, NOW())');
    expect(calls[2].sql).not.toContain('kezeleoorvos_assigned_at = NOW()');
  });

  it('clears the assignment when userId is null', async () => {
    const { db, calls } = makeDb([
      { rows: [{ kezeleoorvos_user_id: DR_A_ID }] }, // current
      { rows: [], rowCount: 1 }, // UPDATE clear
    ]);
    const res = await assignKezeleoorvos(PATIENT_ID, null, STAFF_ID, db);
    expect(res).toEqual({ changed: true, userId: null, name: null, intezmeny: null });
    expect(calls[1].sql).toContain('kezeleoorvos_assigned_at = NULL');
  });
});

describe('applyKezeleoorvosFromForm', () => {
  it('empty name clears the assignment', async () => {
    const { db, query } = makeDb([
      { rows: [{ kezeleoorvos_user_id: DR_A_ID }] }, // current (inside assignKezeleoorvos)
      { rows: [], rowCount: 1 }, // UPDATE clear
    ]);
    const { resolved, result } = await applyKezeleoorvosFromForm(PATIENT_ID, '   ', STAFF_ID, db);
    expect(resolved).toBe(true);
    expect(result?.userId).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('unknown doctor name → not resolved, no sticky write', async () => {
    const { db } = makeDb([
      { rows: [] }, // resolveDoctorByName finds nothing
    ]);
    const { resolved, result } = await applyKezeleoorvosFromForm(PATIENT_ID, 'Dr. Nincs', STAFF_ID, db);
    expect(resolved).toBe(false);
    expect(result).toBeNull();
  });

  it('known doctor name → resolves and assigns', async () => {
    const { db } = makeDb([
      { rows: [{ id: DR_B_ID, name: 'Dr. B', intezmeny: 'Klinika Y' }] }, // resolveDoctorByName
      { rows: [{ kezeleoorvos_user_id: null }] }, // current (assignKezeleoorvos)
      { rows: [{ name: 'Dr. B', intezmeny: 'Klinika Y' }] }, // user lookup
      { rows: [], rowCount: 1 }, // UPDATE
    ]);
    const { resolved, result } = await applyKezeleoorvosFromForm(PATIENT_ID, 'Dr. B', STAFF_ID, db);
    expect(resolved).toBe(true);
    expect(result?.userId).toBe(DR_B_ID);
    expect(result?.changed).toBe(true);
  });
});

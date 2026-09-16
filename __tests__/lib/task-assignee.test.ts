import { describe, it, expect, vi } from 'vitest';
import { assertAssignableStaffUser } from '@/lib/task-assignee';

const TECH_ID = '6f1d2c3b-4a5e-4f60-8b7c-9d0e1f2a3b4c';
const INST = 'SE Fogpótlástani Klinika';

function fakePool(rows: unknown[]) {
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows }));
  return { pool: { query } as any, query };
}

describe('assertAssignableStaffUser', () => {
  it('technikus is kiosztható: a lekérdezés csak aktív státuszt és intézményt szűr', async () => {
    const { pool, query } = fakePool([{ '?column?': 1 }]);
    await expect(assertAssignableStaffUser(pool, TECH_ID, INST, 'fogpótlástanász')).resolves.toBe(true);

    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toMatch(/technikus/);
    expect(sql).not.toMatch(/role/);
    expect(sql).toMatch(/active = true/);
    expect(sql).toMatch(/intezmeny/);
    expect(params).toEqual([TECH_ID, INST]);
  });

  it('admin: intézménytől függetlenül, de csak aktív user', async () => {
    const { pool, query } = fakePool([{ '?column?': 1 }]);
    await expect(assertAssignableStaffUser(pool, TECH_ID, INST, 'admin')).resolves.toBe(true);

    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toMatch(/technikus/);
    expect(sql).not.toMatch(/intezmeny/);
    expect(sql).toMatch(/active = true/);
    expect(params).toEqual([TECH_ID]);
  });

  it('crossInstitution: nem admin is kioszthat más intézménybe (konzílium vetítés)', async () => {
    const { pool, query } = fakePool([{ '?column?': 1 }]);
    await expect(
      assertAssignableStaffUser(pool, TECH_ID, INST, 'beutalo_orvos', { crossInstitution: true }),
    ).resolves.toBe(true);
    expect(query.mock.calls[0][0]).not.toMatch(/intezmeny/);
  });

  it('inaktív / nem létező / más intézményű user → false', async () => {
    const { pool } = fakePool([]);
    await expect(assertAssignableStaffUser(pool, TECH_ID, INST, 'fogpótlástanász')).resolves.toBe(false);
  });
});

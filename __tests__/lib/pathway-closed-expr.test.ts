import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildPathwayClosedExpr,
  resetPathwayClosedExprCache,
  type DbQueryable,
} from '@/lib/pathway-closed-expr';

/** Séma-próbákra válaszoló mock: a hívás sorrendje tábla → oszlop. */
function makeDb(shape: { ewpTable: boolean; mergedIntoCol: boolean }) {
  const calls: string[] = [];
  const db: DbQueryable = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('information_schema.tables')) {
        return { rows: shape.ewpTable ? [{ '?column?': 1 }] : [] };
      }
      if (sql.includes('information_schema.columns')) {
        return { rows: shape.mergedIntoCol ? [{ '?column?': 1 }] : [] };
      }
      throw new Error(`Váratlan lekérdezés: ${sql}`);
    }),
  };
  return { db, calls };
}

beforeEach(() => resetPathwayClosedExprCache());

describe('buildPathwayClosedExpr', () => {
  it('nincs episode_work_phases tábla → konstans false', async () => {
    const { db } = makeDb({ ewpTable: false, mergedIntoCol: false });
    expect(await buildPathwayClosedExpr(db)).toBe('false AS "pathwayClosed"');
  });

  it('van tábla, nincs merged_into oszlop → egyszerű alak', async () => {
    const { db } = makeDb({ ewpTable: true, mergedIntoCol: false });
    const expr = await buildPathwayClosedExpr(db);
    expect(expr).toContain("ewp.status IN ('completed', 'skipped')");
    expect(expr).not.toContain('merged_into_episode_work_phase_id');
    expect(expr).toContain('AS "pathwayClosed"');
  });

  it('van merged_into oszlop → az ELSŐDLEGES fázis státusza dönt', async () => {
    const { db } = makeDb({ ewpTable: true, mergedIntoCol: true });
    const expr = await buildPathwayClosedExpr(db);
    expect(expr).toContain('COALESCE(ewp.merged_into_episode_work_phase_id, ewp.id)');
    expect(expr).toContain("prim.status IN ('completed', 'skipped')");
  });

  it('a megadott tábla-aliast használja', async () => {
    const { db } = makeDb({ ewpTable: true, mergedIntoCol: true });
    const expr = await buildPathwayClosedExpr(db, 'igeny');
    expect(expr).toContain('ewp.tooth_treatment_id = igeny.id');
  });

  it('a séma-próbákat csak egyszer futtatja (cache)', async () => {
    const { db, calls } = makeDb({ ewpTable: true, mergedIntoCol: true });
    await buildPathwayClosedExpr(db);
    const afterFirst = calls.length;
    await buildPathwayClosedExpr(db);
    expect(calls.length).toBe(afterFirst);
  });

  it('érvénytelen aliast elutasít (SQL-injekció ellen)', async () => {
    const { db } = makeDb({ ewpTable: true, mergedIntoCol: true });
    await expect(buildPathwayClosedExpr(db, 'tt; DROP TABLE patients--')).rejects.toThrow(
      /Érvénytelen tábla-alias/
    );
    await expect(buildPathwayClosedExpr(db, 'tt', 'a"b')).rejects.toThrow(
      /Érvénytelen oszlop-alias/
    );
  });
});

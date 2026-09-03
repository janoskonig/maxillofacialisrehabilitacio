/**
 * Paletta-sablonok a tábláról (valódi DB):
 *  - POST /api/step-catalog: gen_<slug> kód a magyar címkéből, ékezet nélkül;
 *    ütközésnél _2; addToPalette=false → palette_order NULL; legacy tükör;
 *  - PATCH /api/step-catalog/:code: paletteOrder / defaultDurationMinutes /
 *    defaultPool írható, a válasz hozza a paletta-mezőket;
 *  - GET /api/step-catalog a friss elemet a paletta-mezőkkel adja (cache
 *    érvénytelenítés).
 *
 * Route-handlereket hívunk → pool + afterEach takarítás (docs/INTEGRATION_TESTS.md).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { cleanupCreated, createTestUser } from './helpers/factories';
import { authedRequest, type TestAuthUser } from './helpers/auth';
import { GET as catalogGet, POST as catalogPost } from '@/app/api/step-catalog/route';
import { PATCH as catalogPatch } from '@/app/api/step-catalog/[stepCode]/route';

const created: string[] = [];

afterEach(async () => {
  const pool = getDbPool();
  if (created.length) {
    await pool.query(`DELETE FROM work_phase_catalog WHERE work_phase_code = ANY($1::text[])`, [created]);
    await pool
      .query(`DELETE FROM step_catalog WHERE step_code = ANY($1::text[])`, [created])
      .catch(() => undefined);
    created.length = 0;
  }
  await cleanupCreated();
});

async function authUser(): Promise<TestAuthUser> {
  const u = await createTestUser();
  return { id: u.id, email: u.email, role: 'fogpótlástanász' };
}

async function createItem(user: TestAuthUser, body: Record<string, unknown>) {
  const req = await authedRequest('http://localhost/api/step-catalog', { user, method: 'POST', body });
  const res = await catalogPost(req);
  const json = await res.json();
  if (json.item?.stepCode) created.push(json.item.stepCode);
  return { status: res.status, item: json.item as Record<string, unknown> | undefined, json };
}

describe('POST /api/step-catalog — sablon mentése a palettára', () => {
  it('gen_ kódot képez az ékezetes címkéből, a paletta végére teszi, a legacy tükröt is írja', async () => {
    const user = await authUser();
    const label = `Ideiglenes korona itest ${Date.now()}`;
    const r = await createItem(user, { labelHu: label });
    expect(r.status).toBe(201);
    expect(r.item?.stepCode).toMatch(/^gen_ideiglenes_korona_itest_\d+$/);
    expect(r.item?.labelHu).toBe(label);
    expect(typeof r.item?.paletteOrder).toBe('number');
    expect(r.item?.defaultDurationMinutes).toBe(30);
    expect(r.item?.defaultPool).toBe('work');

    const pool = getDbPool();
    const max = await pool.query(
      `SELECT MAX(palette_order) AS m FROM work_phase_catalog WHERE work_phase_code <> $1`,
      [r.item?.stepCode]
    );
    expect(Number(r.item?.paletteOrder)).toBeGreaterThan(Number(max.rows[0].m));
    const legacy = await pool.query(`SELECT label_hu FROM step_catalog WHERE step_code = $1`, [r.item?.stepCode]);
    expect(legacy.rows[0]?.label_hu).toBe(label);

    // GET (friss cache) hozza az elemet a paletta-mezőkkel
    const getRes = await catalogGet(await authedRequest('http://localhost/api/step-catalog', { user }));
    const list = (await getRes.json()).items as Array<Record<string, unknown>>;
    const found = list.find((i) => i.stepCode === r.item?.stepCode);
    expect(found?.paletteOrder).toBe(r.item?.paletteOrder);
  });

  it('ütköző címke → _2 utótag; addToPalette=false → nincs a palettán (paletteOrder null)', async () => {
    const user = await authUser();
    const label = `Próba sablon ${Date.now()}`;
    const a = await createItem(user, { labelHu: label, addToPalette: false, defaultDurationMinutes: 45, defaultPool: 'consult' });
    expect(a.status).toBe(201);
    expect(a.item?.paletteOrder).toBeNull();
    expect(a.item?.defaultDurationMinutes).toBe(45);
    expect(a.item?.defaultPool).toBe('consult');
    const b = await createItem(user, { labelHu: label });
    expect(b.status).toBe(201);
    expect(b.item?.stepCode).toBe(`${a.item?.stepCode}_2`);
  });

  it('érvénytelen body (üres címke) → 400; technikus → 403', async () => {
    const user = await authUser();
    const bad = await createItem(user, { labelHu: ' ' });
    expect(bad.status).toBe(400);
    const tech = await createTestUser(undefined, { role: 'technikus' });
    const res = await catalogPost(
      await authedRequest('http://localhost/api/step-catalog', {
        user: { id: tech.id, email: tech.email, role: 'technikus' },
        method: 'POST',
        body: { labelHu: 'Technikus próbál' },
      })
    );
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/step-catalog/:code — paletta-mezők', () => {
  it('paletteOrder null levesz a palettáról, szám visszatesz; időtartam és pool írható', async () => {
    const user = await authUser();
    const r = await createItem(user, { labelHu: `Vázpróba itest ${Date.now()}` });
    const code = r.item?.stepCode as string;

    const off = await catalogPatch(
      await authedRequest(`http://localhost/api/step-catalog/${code}`, { user, method: 'PATCH', body: { paletteOrder: null } }),
      { params: { stepCode: code } }
    );
    expect(off.status).toBe(200);
    expect((await off.json()).item.paletteOrder).toBeNull();

    const on = await catalogPatch(
      await authedRequest(`http://localhost/api/step-catalog/${code}`, {
        user, method: 'PATCH', body: { paletteOrder: 999, defaultDurationMinutes: 50, defaultPool: 'control' },
      }),
      { params: { stepCode: code } }
    );
    expect(on.status).toBe(200);
    const item = (await on.json()).item;
    expect(item.paletteOrder).toBe(999);
    expect(item.defaultDurationMinutes).toBe(50);
    expect(item.defaultPool).toBe('control');

    const pool = getDbPool();
    const row = await pool.query(
      `SELECT palette_order, default_duration_minutes, default_pool FROM work_phase_catalog WHERE work_phase_code = $1`,
      [code]
    );
    expect(row.rows[0]).toEqual({ palette_order: 999, default_duration_minutes: 50, default_pool: 'control' });
  });

  it('érvénytelen időtartam (2 perc) → 400', async () => {
    const user = await authUser();
    const r = await createItem(user, { labelHu: `Rossz perc itest ${Date.now()}` });
    const code = r.item?.stepCode as string;
    const res = await catalogPatch(
      await authedRequest(`http://localhost/api/step-catalog/${code}`, { user, method: 'PATCH', body: { defaultDurationMinutes: 2 } }),
      { params: { stepCode: code } }
    );
    expect(res.status).toBe(400);
  });
});

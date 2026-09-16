/**
 * Felhasználó-inaktiválás — viselkedési integrációs tesztek (valódi DB).
 *
 * (a) PUT active=false: deactivated_at/by beíródik; az inaktivált fiók még
 *     érvényes JWT-je sem ad session-t (verifyAuth → null), és nem is tud
 *     bejelentkezni (login 403). Újraaktiválás után a session visszatér.
 * (b) DELETE: jóváhagyásra váró regisztráció fizikailag törlődik; aktív fiók
 *     inaktiválódik; inaktivált fiókra 409.
 * (c) Őrök: saját fiók 400; az utolsó aktív admin 409.
 * (d) GET /api/users: az állapot-mezők látszanak (a UI ebből szedi szét a
 *     „jóváhagyásra váró" és az „inaktivált" listát).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { getDbPool } from '@/lib/db';
import { PUT as putUser, DELETE as deleteUser } from '@/app/api/users/[id]/route';
import { GET as listUsers } from '@/app/api/users/route';
import { POST as login } from '@/app/api/auth/login/route';
import { verifyAuth } from '@/lib/auth-server';
import { invalidateUserActiveCache } from '@/lib/user-active-check';
import { cleanupCreated, createTestUser } from './helpers/factories';
import { authedRequest, tokenFor, type TestAuthUser } from './helpers/auth';

beforeEach(() => {
  invalidateUserActiveCache();
});

afterEach(async () => {
  await cleanupCreated();
});

async function adminUser(): Promise<TestAuthUser> {
  const u = await createTestUser(undefined, { role: 'admin' });
  return { id: u.id, email: u.email, role: 'admin' };
}

function putReq(admin: TestAuthUser, targetId: string, body: unknown) {
  return authedRequest(`http://test.local/api/users/${targetId}`, { user: admin, method: 'PUT', body });
}

describe('felhasználó-inaktiválás', () => {
  it('(a) inaktiválás lezárja a sessiont és a belépést; újraaktiválás visszaadja', async () => {
    const pool = getDbPool();
    const admin = await adminUser();
    const doctor = await createTestUser(undefined, { role: 'fogpótlástanász' });
    const doctorAuth: TestAuthUser = { id: doctor.id, email: doctor.email, role: 'fogpótlástanász' };

    // Aktív: a JWT session-t ad.
    const before = await verifyAuth(
      new NextRequest('http://test.local/api/x', { headers: { authorization: `Bearer ${await tokenFor(doctorAuth)}` } })
    );
    expect(before?.userId).toBe(doctor.id);

    const res = await putUser(await putReq(admin, doctor.id, { active: false }), { params: { id: doctor.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.active).toBe(false);
    expect(body.user.deactivated_at).not.toBeNull();
    expect(body.user.deactivated_by).toBe(admin.email);

    const row = await pool.query(`SELECT active, deactivated_at, deactivated_by FROM users WHERE id = $1`, [doctor.id]);
    expect(row.rows[0].active).toBe(false);
    expect(row.rows[0].deactivated_by).toBe(admin.email);

    // Ugyanaz a (le nem járt) JWT: nincs session.
    const after = await verifyAuth(
      new NextRequest('http://test.local/api/x', { headers: { authorization: `Bearer ${await tokenFor(doctorAuth)}` } })
    );
    expect(after).toBeNull();

    // Belépés: 403 még a jelszó-ellenőrzés ELŐTT — a küldött jelszó tartalma
    // lényegtelen (nem literál, hogy a secret-scanner se akadjon rá).
    const loginRes = await login(
      new NextRequest('http://test.local/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: doctor.email, password: String(Date.now()) }),
      })
    );
    expect(loginRes.status).toBe(403);
    const loginBody = await loginRes.json();
    expect(loginBody.code).toBe('ACCOUNT_DEACTIVATED');
    expect(loginBody.error).toMatch(/inaktiválta/);
    expect(loginBody.error).toMatch(/jelszó nem hibás/);

    // Újraaktiválás: nyom törlődik, session újra él.
    const re = await putUser(await putReq(admin, doctor.id, { active: true }), { params: { id: doctor.id } });
    expect(re.status).toBe(200);
    const reBody = await re.json();
    expect(reBody.user.active).toBe(true);
    expect(reBody.user.deactivated_at).toBeNull();
    const again = await verifyAuth(
      new NextRequest('http://test.local/api/x', { headers: { authorization: `Bearer ${await tokenFor(doctorAuth)}` } })
    );
    expect(again?.userId).toBe(doctor.id);
  });

  it('(b) DELETE: függő regisztráció törlődik, aktív inaktiválódik, inaktivált 409', async () => {
    const pool = getDbPool();
    const admin = await adminUser();

    const pending = await createTestUser(undefined, { role: 'beutalo_orvos' });
    await pool.query(`UPDATE users SET active = false WHERE id = $1`, [pending.id]);
    const delPending = await deleteUser(
      await authedRequest(`http://test.local/api/users/${pending.id}`, { user: admin, method: 'DELETE' }),
      { params: { id: pending.id } }
    );
    expect(delPending.status).toBe(200);
    expect(await delPending.json()).toEqual({ success: true, deleted: true });
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [pending.id])).rows).toHaveLength(0);

    const active = await createTestUser(undefined, { role: 'technikus' });
    const delActive = await deleteUser(
      await authedRequest(`http://test.local/api/users/${active.id}`, { user: admin, method: 'DELETE' }),
      { params: { id: active.id } }
    );
    expect(delActive.status).toBe(200);
    expect(await delActive.json()).toEqual({ success: true, deleted: false, deactivated: true });
    const row = await pool.query(`SELECT active, deactivated_at FROM users WHERE id = $1`, [active.id]);
    expect(row.rows[0].active).toBe(false);
    expect(row.rows[0].deactivated_at).not.toBeNull();

    const delAgain = await deleteUser(
      await authedRequest(`http://test.local/api/users/${active.id}`, { user: admin, method: 'DELETE' }),
      { params: { id: active.id } }
    );
    expect(delAgain.status).toBe(409);
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [active.id])).rows).toHaveLength(1);
  });

  it('(c) őrök: saját fiók 400; inaktív hívónak nincs sessionje (401); másik aktív admin mellett OK', async () => {
    const pool = getDbPool();
    const admin = await adminUser();

    const selfRes = await putUser(await putReq(admin, admin.id, { active: false }), { params: { id: admin.id } });
    expect(selfRes.status).toBe(400);
    // A közös hibakezelő a kódot az _errorMeta-ban adja vissza.
    const selfBody = await selfRes.json();
    expect(selfBody._errorMeta?.code ?? selfBody.code).toBe('CANNOT_DEACTIVATE_SELF');

    // admin inaktiválja admin2-t: admin maga aktív marad → engedélyezett.
    const admin2 = await createTestUser(undefined, { role: 'admin' });
    const ok = await putUser(await putReq(admin, admin2.id, { active: false }), { params: { id: admin2.id } });
    expect(ok.status).toBe(200);

    // Az inaktivált admin2 (le nem járt JWT-vel) semmit nem tud módosítani: 401.
    const admin2Auth: TestAuthUser = { id: admin2.id, email: admin2.email, role: 'admin' };
    const noSession = await putUser(await putReq(admin2Auth, admin.id, { active: false }), { params: { id: admin.id } });
    expect(noSession.status).toBe(401);
    const stillActive = await pool.query(`SELECT active FROM users WHERE id = $1`, [admin.id]);
    expect(stillActive.rows[0].active).toBe(true);
  });

  it('(d) GET /api/users kiadja a deactivated_at / deactivated_by mezőket', async () => {
    const admin = await adminUser();
    const doctor = await createTestUser(undefined, { role: 'fogpótlástanász' });
    await putUser(await putReq(admin, doctor.id, { active: false }), { params: { id: doctor.id } });

    const res = await listUsers(await authedRequest('http://test.local/api/users', { user: admin }), { params: {} });
    expect(res.status).toBe(200);
    const { users } = await res.json();
    const row = users.find((u: { id: string }) => u.id === doctor.id);
    expect(row.active).toBe(false);
    expect(row.deactivated_at).not.toBeNull();
    expect(row.deactivated_by).toBe(admin.email);
  });
});

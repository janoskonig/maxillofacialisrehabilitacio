import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { getUserInstitution } from '@/lib/consilium';

export const dynamic = 'force-dynamic';

/** Minden aktív felhasználó (intézménytől függetlenül) — Konzílium jelenlévő választó. */
export const GET = authedHandler(async (_req, { auth }) => {
  await getUserInstitution(auth);

  const pool = getDbPool();
  const result = await pool.query(
    `SELECT
       u.id,
       u.email,
       u.doktor_neve as "doktorNeve",
       u.role,
       u.intezmeny as "intezmeny"
     FROM users u
     WHERE u.active = true
     ORDER BY
       (u.doktor_neve IS NULL OR btrim(u.doktor_neve) = '') ASC,
       lower(btrim(u.doktor_neve)) ASC NULLS LAST,
       lower(u.email) ASC`,
  );

  return NextResponse.json({ users: result.rows });
});

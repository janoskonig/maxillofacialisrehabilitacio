import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { invalidateCache } from '@/lib/catalog-cache';

export const dynamic = 'force-dynamic';

/**
 * Beutaló intézmények admin kezelése (referral_institutions törzs).
 * GET: teljes lista (inaktívakkal együtt); POST: új intézmény.
 */
export const GET = roleHandler(['admin', 'fogpótlástanász'], async () => {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT id, name, active, created_at AS "createdAt"
     FROM referral_institutions
     ORDER BY active DESC, name ASC`
  );
  return NextResponse.json({ institutions: result.rows });
});

export const POST = roleHandler(['admin', 'fogpótlástanász'], async (req, { auth }) => {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'Az intézmény neve kötelező' }, { status: 400 });
  }

  const pool = getDbPool();
  const result = await pool.query(
    `INSERT INTO referral_institutions (name, created_by)
     VALUES ($1, $2)
     ON CONFLICT ((lower(btrim(name)))) DO NOTHING
     RETURNING id, name, active, created_at AS "createdAt"`,
    [name, auth.email]
  );
  if (result.rows.length === 0) {
    return NextResponse.json({ error: 'Ez az intézmény már szerepel a listában' }, { status: 409 });
  }

  invalidateCache('institutions');
  return NextResponse.json({ institution: result.rows[0] }, { status: 201 });
});

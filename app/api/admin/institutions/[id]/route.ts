import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { invalidateCache } from '@/lib/catalog-cache';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/institutions/[id] — átnevezés és/vagy aktiválás/inaktiválás.
 * Hard delete szándékosan nincs: a meglévő beutalók szabad szöveges
 * hivatkozásai érintetlenek maradnak, az inaktív intézmény csak az
 * autocomplete-ből tűnik el.
 */
export const PATCH = roleHandler(['admin', 'fogpótlástanász'], async (req, { params }) => {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : undefined;
  const active = typeof body?.active === 'boolean' ? body.active : undefined;

  if (name === '') {
    return NextResponse.json({ error: 'Az intézmény neve nem lehet üres' }, { status: 400 });
  }
  if (name === undefined && active === undefined) {
    return NextResponse.json({ error: 'Nincs módosítandó mező' }, { status: 400 });
  }

  const pool = getDbPool();
  let result;
  try {
    result = await pool.query(
      `UPDATE referral_institutions
       SET name = COALESCE($2, name),
           active = COALESCE($3, active)
       WHERE id = $1
       RETURNING id, name, active, created_at AS "createdAt"`,
      [params.id, name ?? null, active ?? null]
    );
  } catch (err: any) {
    if (err?.code === '23505') {
      return NextResponse.json({ error: 'Ezzel a névvel már létezik intézmény' }, { status: 409 });
    }
    throw err;
  }
  if (result.rows.length === 0) {
    return NextResponse.json({ error: 'Intézmény nem található' }, { status: 404 });
  }

  invalidateCache('institutions');
  return NextResponse.json({ institution: result.rows[0] });
});

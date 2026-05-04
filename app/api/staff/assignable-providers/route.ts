import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

/** Orvosok, akikhez van hozzárendelt pathway-epizód (szűrőhöz). */
export const GET = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async () => {
  const pool = getDbPool();
  const r = await pool.query<{ id: string; name: string }>(
    `SELECT DISTINCT u.id::text AS id,
            COALESCE(NULLIF(TRIM(u.doktor_neve), ''), u.email) AS name
     FROM users u
     INNER JOIN patient_episodes pe ON pe.assigned_provider_id = u.id
     WHERE u.active IS DISTINCT FROM false
     ORDER BY name ASC`
  );
  return NextResponse.json({ providers: r.rows });
});

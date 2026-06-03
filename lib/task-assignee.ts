import type { getDbPool } from '@/lib/db';

type DbPool = ReturnType<typeof getDbPool>;

/**
 * Staff feladat címzett: aktív, nem technikus.
 * Admin bármely ilyen usert kioszthat; többi szerepkör csak saját intézményét.
 * `crossInstitution: true` esetén (pl. konzílium vetítés, ahol több intézmény
 * van jelen) bárki kiosztható intézménytől függetlenül.
 */
export async function assertAssignableStaffUser(
  pool: DbPool,
  userId: string,
  institutionId: string,
  actorRole: string,
  opts?: { crossInstitution?: boolean },
): Promise<boolean> {
  if (actorRole === 'admin' || opts?.crossInstitution) {
    const r = await pool.query(
      `SELECT 1 FROM users
       WHERE id = $1::uuid AND active = true AND role <> 'technikus'`,
      [userId],
    );
    return r.rows.length > 0;
  }

  const r = await pool.query(
    `SELECT 1 FROM users
     WHERE id = $1::uuid AND active = true AND role <> 'technikus'
       AND btrim(coalesce(intezmeny, '')) = btrim(coalesce($2::text, ''))`,
    [userId, institutionId],
  );
  return r.rows.length > 0;
}

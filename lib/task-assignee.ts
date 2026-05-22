import type { getDbPool } from '@/lib/db';

type DbPool = ReturnType<typeof getDbPool>;

/**
 * Staff feladat címzett: aktív, nem technikus.
 * Admin bármely ilyen usert kioszthat; többi szerepkör csak saját intézményét.
 */
export async function assertAssignableStaffUser(
  pool: DbPool,
  userId: string,
  institutionId: string,
  actorRole: string,
): Promise<boolean> {
  if (actorRole === 'admin') {
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

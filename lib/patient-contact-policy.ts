import type { Pool, PoolClient } from 'pg';
import { getDbPool } from '@/lib/db';

type Queryable = Pick<Pool | PoolClient, 'query'>;

/**
 * Központi beteg-kommunikációs kapu.
 *
 * Elhunyt (halal_datum != NULL) vagy már nem létező betegnek semmilyen
 * beteg-címzett kommunikációt nem szabad kiküldeni. Az adatbázis hibáját nem
 * nyeljük el: így a hívó küldési folyamata fail-closed módon megszakad.
 */
export async function canContactPatient(
  patientId: string,
  db: Queryable = getDbPool(),
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1
       FROM patients
      WHERE id = $1
        AND halal_datum IS NULL
      LIMIT 1`,
    [patientId],
  );

  return result.rows.length > 0;
}

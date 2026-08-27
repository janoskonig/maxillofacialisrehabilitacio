import type { PoolClient } from 'pg';
import { getDbPool } from '@/lib/db';

/**
 * Bármi, amin lehet query-zni: a pool maga vagy egy kivett client.
 * A factory-k ezt kapják, így ugyanaz a kód működik tranzakción belül
 * (withRollback) és azon kívül (commitolt adat + cleanup) is.
 */
export type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export function testPool(): Queryable {
  return getDbPool();
}

/**
 * Egy teszt = egy tranzakció, a végén mindig ROLLBACK (sikeres és hibás ágon is).
 * Ez a preferált izoláció a közvetlen SQL-t használó tesztekhez.
 *
 * FIGYELEM: route-handlereket meghívó tesztekhez NEM jó — a route-ok a poolból
 * saját kapcsolatot vesznek és maguk COMMIT-olnak, arra ez a tranzakció nem
 * terjed ki. Ott a factory-k cleanup-mechanizmusát használd (lásd factories.ts
 * és docs/INTEGRATION_TESTS.md).
 */
export async function withRollback<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    try {
      await client.query('ROLLBACK');
    } catch {
      // a kapcsolat már el is szállhatott; a release úgyis takarít
    }
    client.release();
  }
}

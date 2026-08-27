import { execFileSync } from 'child_process';
import path from 'path';
import { Client } from 'pg';
import { resolveTestDatabaseUrl } from './helpers/env';

/**
 * Egyszer fut a suite előtt (külön processzben — env-et NEM ad át a workereknek,
 * azt a setup-env.ts intézi). Feladata:
 *   1. ellenőrzi, hogy a teszt-DB elérhető és van sémája,
 *   2. lefuttatja a tracked migrációkat (idempotens, gyors), hogy egy WP-ben
 *      hozzáadott új migráció automatikusan felkerüljön a teszt-DB-re is.
 */
export default async function globalSetup(): Promise<void> {
  const url = resolveTestDatabaseUrl();
  const dbName = new URL(url).pathname.replace(/^\//, '');

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Nem érem el az integrációs teszt-DB-t ("${dbName}"). ` +
        'Építsd fel: npm run test:integration:setup — részletek: docs/INTEGRATION_TESTS.md. ' +
        `Eredeti hiba: ${(err as Error).message}`
    );
  }
  try {
    await client.query('SELECT 1 FROM node_migrations LIMIT 1');
  } catch {
    throw new Error(
      `A(z) "${dbName}" teszt-DB létezik, de nincs (teljes) sémája. ` +
        'Építsd újra: npm run test:integration:setup — részletek: docs/INTEGRATION_TESTS.md.'
    );
  } finally {
    await client.end();
  }

  const root = path.resolve(__dirname, '..', '..');
  execFileSync('node', [path.join(root, 'scripts', 'run-all-migrations.js')], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}

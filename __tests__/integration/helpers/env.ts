import fs from 'fs';
import path from 'path';

/**
 * Integrációs teszt-környezet feloldása.
 *
 * A teszt-DB URL-je:
 *   1. TEST_DATABASE_URL env változó, ha be van állítva (CI ezt használja), különben
 *   2. a .env.local DATABASE_URL-jéből származtatva, az adatbázisnevet
 *      `maxfac_test`-re cserélve.
 *
 * Biztonsági őr: az adatbázis nevének `_test`-re kell végződnie, hogy a suite
 * véletlenül se fusson dev/éles adatbázison.
 */

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Nem írunk felül már beállított env-et (CI-ben az explicit env nyer).
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadLocalEnv(): void {
  const root = path.resolve(__dirname, '..', '..', '..');
  loadEnvFile(path.join(root, '.env.local'));
  loadEnvFile(path.join(root, '.env'));
}

export function resolveTestDatabaseUrl(): string {
  loadLocalEnv();

  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const base = process.env.DATABASE_URL;
    if (!base) {
      throw new Error(
        'Sem TEST_DATABASE_URL, sem DATABASE_URL nincs beállítva — lásd docs/INTEGRATION_TESTS.md'
      );
    }
    const derived = new URL(base);
    derived.pathname = '/maxfac_test';
    url = derived.toString();
  }

  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Biztonsági őr: az integrációs teszt-DB nevének "_test"-re kell végződnie (kapott: "${dbName}"). ` +
        'Így nem futhat a suite véletlenül dev/éles adatbázison.'
    );
  }
  return url;
}

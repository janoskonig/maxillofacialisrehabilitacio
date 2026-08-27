import { afterAll } from 'vitest';
import { resolveTestDatabaseUrl } from './helpers/env';

// A worker-processben minden más import ELŐTT átirányítjuk a DATABASE_URL-t a
// teszt-DB-re, így a lib/db getDbPool() — és rajta keresztül minden route/lib —
// a teszt-adatbázison dolgozik.
process.env.DATABASE_URL = resolveTestDatabaseUrl();

// A tesztek soha nem küldhetnek levelet.
process.env.EMAIL_DRY_RUN = 'true';

afterAll(async () => {
  // A pool lezárása, hogy a vitest processz tisztán ki tudjon lépni.
  const { getDbPool } = await import('@/lib/db');
  try {
    await getDbPool().end();
  } catch {
    // ha a suite sosem nyitott poolt, nincs teendő
  }
});

# Integrációs tesztek

Valódi (eldobható) Postgres adatbázis ellen futó viselkedési tesztek. A cél,
hogy a terv/foglalás réteg hibái ne csússzanak át a source-regex jellegű unit
teszteken — lásd `docs/KEZELESI_TERV_FUL_REDESIGN_TERV.md` (WP-0.0).

## Gyorsstart (lokálisan)

```bash
# 1. Egyszeri (vagy séma-változás utáni) DB-felépítés — kb. 1-2 perc:
PGPASSWORD='<maxfac DB jelszó>' npm run test:integration:setup

# 2. Futtatás:
npm run test:integration
```

A suite a `maxfac_test` adatbázist használja. Az URL-t így oldja fel:

1. `TEST_DATABASE_URL` env változó, ha be van állítva (CI-ben így megy), különben
2. a `.env.local` `DATABASE_URL`-jéből származtatja, az adatbázisnevet
   `maxfac_test`-re cserélve.

**Biztonsági őr:** a DB nevének `_test`-re kell végződnie — e nélkül a suite el
sem indul, így véletlenül sem futhat a dev/éles adatbázison. A tesztek alatt az
`EMAIL_DRY_RUN` kényszerítetten `true`.

## Hogyan épül a séma? (pillanatkép-alapú)

A teszt-DB **nem** a legacy migrációs láncból épül — az friss DB-n
adat-konverziós zsákutcákba fut (kipróbáltuk: `TRIM(jsonb)`, hiányzó
denormalizált oszlopok). Helyette a terv által jóváhagyott alternatíva él:

- `database/integration/schema-snapshot.sql` — a dev DB `pg_dump --schema-only`
  pillanatképe (adatot nem tartalmaz, commitolva);
- `database/integration/node-migrations-data.sql` — a `node_migrations` tábla
  tartalma, hogy a tracked migrációk onnan folytatódjanak.

A felépítés útvonala (`npm run test:integration:setup`): `DROP/CREATE
maxfac_test` → pillanatkép visszatöltése → `node_migrations` adat →
`scripts/run-all-migrations.js` (az azóta született tracked migrációk) →
materialized view-k feltöltése.

## Mikor kell mit frissíteni?

- **Tracked migráció** (`database/migrations/`) hozzáadásakor **semmit** — a
  `global-setup` minden futás előtt lefuttatja a `run-all-migrations.js`-t a
  teszt-DB-n, így az új migráció magától felkerül. A pillanatképet sem kell
  újragenerálni.
- **Pillanatképen kívüli séma-változásnál** (kézi ALTER a dev DB-n, legacy SQL):
  `bash scripts/integration/refresh-schema-snapshot.sh` (új pillanatkép a dev
  DB-ről, commitold), majd `npm run test:integration:setup`.
- **Gyanús, inkonzisztens teszt-DB-nél**: `npm run test:integration:setup`
  (DROP + újraépítés, ~10 mp).

Helyi kényelmi wrapper (a jelszót a `.env.local`-ból veszi):
`bash scripts/integration/setup-test-db-local.sh`.

## CI

A `.github/workflows/ci.yml` `integration` jobja minden PR-ra lefut: eldobható
`postgres:16` service-konténeren építi fel a sémát ugyanazzal a setup scripttel,
majd `npm run test:integration`-t futtat. A CI-beli jelszó
(`maxfac_ci_throwaway`) nem titok — csak a konténer élettartamára létezik.

## Teszt-izoláció: két minta

**1. Közvetlen SQL-t használó teszt → `withRollback`** (preferált):

```ts
import { withRollback } from './helpers/db';
import { createTestPatient, createTestEpisode } from './helpers/factories';

it('…', async () => {
  await withRollback(async (client) => {
    const patient = await createTestPatient(client);
    const episode = await createTestEpisode(client, patient.id);
    // … assert a clienten keresztül …
  }); // itt minden visszagördül
});
```

**2. Route-handlert hívó teszt → commitolt adat + cleanup.** A route-ok a
poolból saját kapcsolatot vesznek és maguk COMMIT-olnak — erre a hívó
tranzakciója nem terjed ki, ezért itt a factory-kat pool-lal (db paraméter
nélkül) hívjuk, és `afterEach`-ben takarítunk:

```ts
import { afterEach } from 'vitest';
import { cleanupCreated, createTestPatient } from './helpers/factories';
import { authedRequest } from './helpers/auth';
import { POST } from '@/app/api/…/route';

afterEach(cleanupCreated);

it('…', async () => {
  const patient = await createTestPatient(); // pool-on, commitolva + trackelve
  const user = await createTestUser();
  const req = await authedRequest('http://test.local/api/…', {
    user: { ...user, role: 'fogpótlástanász' },
    method: 'POST',
    body: { … },
  });
  const res = await POST(req, { params: { id: … } });
  // … assert a DB-ben pool-lal …
});
```

> Megjegyzés: a terv eredetileg minden tesztre tranzakció+ROLLBACK izolációt írt
> elő. Route-handleres teszteknél ez technikailag lehetetlen (a route saját
> kapcsolaton COMMIT-ol), ezért ott a trackelt-cleanup minta a hivatalos út. A
> DB amúgy is eldobható.

## Konvenciók

- Tesztfájlok: `__tests__/integration/*.test.ts` — a unit futásból
  (`npm run test`) ki vannak zárva, csak az integrációs config szedi fel őket.
- A suite **egy szálon** futtatja a fájlokat (`singleFork`) — közös DB-n a
  párhuzamos suite-ok egymás adatait zavarnák.
- Új factory-t lehetőleg külön fájlba tegyél (`helpers/factories-<wp>.ts`),
  hogy a párhuzamos WP-branchek ne ütközzenek a közös `factories.ts`-en.
- Viselkedést tesztelj, ne forrásszöveget: ha egy esetet le lehet futtatni,
  **ne** source-regex tesztet írj rá.

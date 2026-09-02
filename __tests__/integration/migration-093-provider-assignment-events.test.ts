/**
 * 093 — provider_assignment_events garantálása. Élesben a legacy
 * event-partitioning migráció (nem tracked) hiányozhat: a WP-6.2 napló-INSERT
 * 42P01-gyel bukott, és vele az egy tranzakcióban lévő felelős-orvos UPDATE is.
 *
 *  - 092 hiányzó táblánál nem hibázik (nem torlaszolja el a tracked láncot);
 *  - 093 hiányzó táblánál létrehozza: partícionált, havi partíciók 2020-01 … 2028-12
 *    + DEFAULT, nullable new_user_id, indexek; a sor a hónap partíciójába, a távoli
 *    jövő a DEFAULT-ba kerül; a migráció idempotens (kétszer futtatva sem hibázik);
 *  - a meglévő (pillanatkép, legacy alakú) táblán a global-setup már lefuttatta:
 *    DEFAULT partíció + nullable new_user_id — ezt is ellenőrizzük.
 *
 * A meglévő táblacsaládot (szülő + partíciók) egy karantén-sémába költöztetjük,
 * hogy a public-ban „hiányozzon" — az indexnevek is a sémához kötöttek, így a 093
 * hűen (indexekkel együtt) tudja újraépíteni —, a végén visszaköltöztetjük. A suite
 * egy szálon fut (fileParallelism: false), más fájl közben nem nyúl hozzá.
 */
import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { cleanupCreated, createTestEpisode, createTestPatient, createTestUser } from './helpers/factories';

const MIGRATIONS = path.resolve(__dirname, '..', '..', 'database', 'migrations');
const readMigration = (name: string) => fs.readFileSync(path.join(MIGRATIONS, name), 'utf8');
const SQL_092 = readMigration('092_provider_assignment_events_nullable_new.sql');
const SQL_093 = readMigration('093_provider_assignment_events_ensure.sql');

const QUARANTINE = 'pae_093_test_quarantine';
const MONTHLY_PARTITIONS = 9 * 12; // 2020-01 … 2028-12

async function moveAuditTableToQuarantine(): Promise<void> {
  const pool = getDbPool();
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${QUARANTINE}`);
  await pool.query(`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT c.relname
          FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
         WHERE i.inhparent = 'public.provider_assignment_events'::regclass
      LOOP
        EXECUTE format('ALTER TABLE public.%I SET SCHEMA ${QUARANTINE}', r.relname);
      END LOOP;
      ALTER TABLE public.provider_assignment_events SET SCHEMA ${QUARANTINE};
    END
    $$`);
}

async function restoreAuditTableFromQuarantine(): Promise<void> {
  const pool = getDbPool();
  await pool.query('DROP TABLE IF EXISTS public.provider_assignment_events CASCADE');
  await pool.query(`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT c.relname
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = '${QUARANTINE}' AND c.relkind IN ('r', 'p')
      LOOP
        EXECUTE format('ALTER TABLE ${QUARANTINE}.%I SET SCHEMA public', r.relname);
      END LOOP;
    END
    $$`);
  await pool.query(`DROP SCHEMA IF EXISTS ${QUARANTINE}`);
}

async function tableMeta() {
  const pool = getDbPool();
  const { rows } = await pool.query(`
    SELECT c.relkind,
           NULLIF(p.partdefid, 0)::regclass::text AS default_partition,
           (SELECT count(*)::int FROM pg_inherits WHERE inhparent = c.oid) AS partitions,
           (SELECT is_nullable FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'provider_assignment_events'
               AND column_name = 'new_user_id') AS new_user_id_nullable,
           (SELECT array_agg(indexname::text ORDER BY indexname) FROM pg_indexes
             WHERE schemaname = 'public' AND tablename = 'provider_assignment_events') AS indexes
      FROM pg_class c
      LEFT JOIN pg_partitioned_table p ON p.partrelid = c.oid
     WHERE c.oid = to_regclass('public.provider_assignment_events')`);
  return rows[0] ?? null;
}

describe('093 provider_assignment_events — meglévő (legacy alakú) táblán', () => {
  it('a global-setup lefuttatta: DEFAULT partíció + nullable new_user_id, a havi partíciók megmaradtak', async () => {
    const meta = await tableMeta();
    expect(meta).toMatchObject({
      relkind: 'p',
      default_partition: 'provider_assignment_events_default',
      partitions: MONTHLY_PARTITIONS + 1,
      new_user_id_nullable: 'YES',
    });
  });
});

describe('093 provider_assignment_events — hiányzó táblán', () => {
  beforeAll(async () => {
    const pool = getDbPool();
    const leftover = await pool.query(`SELECT to_regclass($1) AS r`, [`${QUARANTINE}.provider_assignment_events`]);
    if (leftover.rows[0]?.r) {
      // egy korábbi, félbeszakadt futás maradványa: előbb visszaállítunk
      await restoreAuditTableFromQuarantine();
    }
    await moveAuditTableToQuarantine();
  });

  afterAll(async () => {
    await restoreAuditTableFromQuarantine();
    await cleanupCreated();
  });

  it('092: hiányzó táblánál nem hibázik, a tábla továbbra is hiányzik', async () => {
    const pool = getDbPool();
    await pool.query(SQL_092);
    expect(await tableMeta()).toBeNull();
  });

  it('093: létrehozza a táblát havi + DEFAULT partícióval, nullable new_user_id-vel, indexekkel', async () => {
    const pool = getDbPool();
    await pool.query(SQL_093);
    const meta = await tableMeta();
    expect(meta).toMatchObject({
      relkind: 'p',
      default_partition: 'provider_assignment_events_default',
      partitions: MONTHLY_PARTITIONS + 1,
      new_user_id_nullable: 'YES',
    });
    expect(meta.indexes).toEqual(
      expect.arrayContaining(['idx_provider_assignment_events_created', 'idx_provider_assignment_events_episode'])
    );
  });

  it('a sor a hónap partíciójába, a távoli jövő (nincs havi partíció) a DEFAULT-ba kerül; a lekapcsolás (NULL) is rögzül', async () => {
    const pool = getDbPool();
    const dr = await createTestUser(undefined, { doktorNeve: 'Dr. Partíció Pál' });
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const inserted = await pool.query(
      `INSERT INTO provider_assignment_events (episode_id, old_user_id, new_user_id, created_by, created_at)
       VALUES ($1, NULL, $2, 'test', '2026-09-02T14:00:00Z'),
              ($1, $2, NULL, 'test', '2035-06-15T10:00:00Z')
       RETURNING tableoid::regclass::text AS partition, new_user_id`,
      [episode.id, dr.id]
    );
    expect(inserted.rows[0]).toMatchObject({ partition: 'provider_assignment_events_2026_09', new_user_id: dr.id });
    expect(inserted.rows[1]).toMatchObject({ partition: 'provider_assignment_events_default', new_user_id: null });
  });

  it('093 idempotens: másodszor is lefut, a partíciók száma nem változik', async () => {
    const pool = getDbPool();
    await pool.query(SQL_093);
    expect((await tableMeta())?.partitions).toBe(MONTHLY_PARTITIONS + 1);
  });
});

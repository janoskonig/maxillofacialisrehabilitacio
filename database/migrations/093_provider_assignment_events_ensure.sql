BEGIN;

-- 093: provider_assignment_events — a tábla és a partíciói garantáltan létezzenek.
--
-- A felelős orvos váltás-naplója (WP-6.2, 092) a legacy
-- migration_event_partitioning.sql táblájára épült, de a legacy migrációk nem
-- tracked-ek: ahol az sosem futott le, a PATCH /api/episodes/:id INSERT-je
-- 42P01 (undefined_table) hibával elszállt — „Hiba történt" a felületen, és a
-- vele egy tranzakcióban lévő UPDATE miatt a felelős orvos sem állítódott át.
-- Ez a migráció idempotensen:
--   1. létrehozza a havonta partícionált táblát, ha hiányzik (a legacy alakjával,
--      de a new_user_id már nullable — a lekapcsolás is naplózható), a legacy
--      havi partícióival (2020-01 … 2028-12);
--   2. DEFAULT partíciót ad hozzá (meglévő táblához is), hogy 2029-től — vagy egy
--      hiányzó havi partíció esetén — se bukjon el az INSERT „no partition of
--      relation … found for row" (23514) hibával;
--   3. leoldja a NOT NULL-t a new_user_id-ről, ha még rajta van (a 092 hiányzó
--      tábla miatt kihagyhatta).
--
-- Meglévő táblához utólag NEM veszünk fel havi partíciót: a legacy a session
-- időzónájával képezte a határokat, egy más időzónával képzett új hónap a
-- szomszédos partíciókkal ütközhetne — ott a lyukakat a DEFAULT partíció fedi.
-- DEFAULT partíció mellett új havi partíció csak akkor vehető fel, ha a
-- DEFAULT-ban nincs abba a hónapba eső sor (Postgres-szabály). A retention
-- (drop_old_event_partitions) a _YYYY_MM végződés alapján dolgozik, a DEFAULT
-- partíciót nem érinti.

DO $$
DECLARE
  d DATE := DATE '2020-01-01';
BEGIN
  IF to_regclass('public.provider_assignment_events') IS NULL THEN
    CREATE TABLE provider_assignment_events (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
      old_user_id UUID REFERENCES users(id),
      new_user_id UUID REFERENCES users(id),
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by VARCHAR(255),
      PRIMARY KEY (id, created_at)
    ) PARTITION BY RANGE (created_at);

    -- IF NOT EXISTS: egy azonos nevű, idegen tábla (nem partíció) nem buktatja
    -- el a migrációt — annak a hónapnak a sorait a DEFAULT partíció fogadja.
    WHILE d <= DATE '2028-12-01' LOOP
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF provider_assignment_events FOR VALUES FROM (%L) TO (%L)',
        'provider_assignment_events_' || to_char(d, 'YYYY_MM'),
        d::timestamptz,
        (d + INTERVAL '1 month')::timestamptz
      );
      d := d + INTERVAL '1 month';
    END LOOP;
  END IF;

  -- DEFAULT partíció, ha még nincs (bármilyen néven). Nem partícionált (kézzel
  -- létrehozott) táblánál a SELECT NULL-t ad, az IF nem fut.
  IF (SELECT p.partdefid FROM pg_partitioned_table p
       WHERE p.partrelid = 'public.provider_assignment_events'::regclass) = 0 THEN
    CREATE TABLE provider_assignment_events_default
      PARTITION OF provider_assignment_events DEFAULT;
  END IF;

  ALTER TABLE provider_assignment_events ALTER COLUMN new_user_id DROP NOT NULL;
END
$$;

CREATE INDEX IF NOT EXISTS idx_provider_assignment_events_episode
  ON provider_assignment_events (episode_id);
CREATE INDEX IF NOT EXISTS idx_provider_assignment_events_created
  ON provider_assignment_events (created_at);

COMMENT ON TABLE provider_assignment_events IS
  'Immutable audit: az epizód felelős orvosának (assigned_provider_id) váltásai — old_user_id → new_user_id (NULL = lekapcsolás), reason, created_by. A PATCH /api/episodes/:id írja. Partitioned by month + DEFAULT (093); retention 3 years.';

COMMIT;

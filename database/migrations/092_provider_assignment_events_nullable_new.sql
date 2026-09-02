BEGIN;

-- 092: Felelős orvos váltás-naplója — a "lekapcsolás" is rögzíthető legyen.
--
-- A provider_assignment_events (legacy migration_event_partitioning.sql) az
-- epizód felelős orvosának (patient_episodes.assigned_provider_id) változásait
-- naplózná, de eddig senki nem írt bele. Mostantól a PATCH /api/episodes/:id
-- minden váltást rögzít (régi → új, indok, ki). A NOT NULL new_user_id miatt a
-- "nincs felelős orvos" állapotba váltás nem volt naplózható — ezt oldjuk fel.
--
-- Idempotens ÉS toleráns: a legacy migrációk nem tracked-ek, így ahol a
-- migration_event_partitioning.sql sosem futott le (pl. éles), a tábla hiányzik.
-- Ilyenkor ez a migráció nem hibázik (nem torlaszolja el a tracked láncot) —
-- a táblát a 093 hozza létre, már nullable new_user_id-vel.

DO $$
BEGIN
  IF to_regclass('public.provider_assignment_events') IS NULL THEN
    RAISE NOTICE 'provider_assignment_events hiányzik — a 093 hozza létre (nullable new_user_id-vel)';
    RETURN;
  END IF;

  ALTER TABLE provider_assignment_events ALTER COLUMN new_user_id DROP NOT NULL;

  COMMENT ON TABLE provider_assignment_events IS
    'Immutable audit: az epizód felelős orvosának (assigned_provider_id) váltásai — old_user_id → new_user_id (NULL = lekapcsolás), reason, created_by. A PATCH /api/episodes/:id írja. Partitioned by month; retention 3 years.';
END
$$;

COMMIT;

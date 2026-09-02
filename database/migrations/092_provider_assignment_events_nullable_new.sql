BEGIN;

-- 092: Felelős orvos váltás-naplója — a "lekapcsolás" is rögzíthető legyen.
--
-- A provider_assignment_events (legacy migration_event_partitioning.sql) az
-- epizód felelős orvosának (patient_episodes.assigned_provider_id) változásait
-- naplózná, de eddig senki nem írt bele. Mostantól a PATCH /api/episodes/:id
-- minden váltást rögzít (régi → új, indok, ki). A NOT NULL new_user_id miatt a
-- "nincs felelős orvos" állapotba váltás nem volt naplózható — ezt oldjuk fel.
-- Idempotens: a DROP NOT NULL többször is lefuttatható.

ALTER TABLE provider_assignment_events ALTER COLUMN new_user_id DROP NOT NULL;

COMMENT ON TABLE provider_assignment_events IS
  'Immutable audit: az epizód felelős orvosának (assigned_provider_id) váltásai — old_user_id → new_user_id (NULL = lekapcsolás), reason, created_by. A PATCH /api/episodes/:id írja. Partitioned by month; retention 3 years.';

COMMIT;

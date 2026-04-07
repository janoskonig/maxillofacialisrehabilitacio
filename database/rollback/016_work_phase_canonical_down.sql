-- Rollback for database/migrations/016_work_phase_canonical.sql (H0.1 / plan §6.3)
-- NOT registered in node_migrations — run manually on a DB clone first (syntax + FK order).
--
-- WARNING: After the app cutover, new clinical data may exist only in episode_work_phases /
-- work_phases_json. Dropping those objects without a backup causes data loss. Prefer forward
-- hotfix if production has already written to the canonical tables.
--
-- To re-apply 016 after this down migration, remove the migration record:
--   DELETE FROM node_migrations WHERE name = '016_work_phase_canonical.sql';
-- then run: npm run migrate:work-phase-canonical

BEGIN;

DROP TABLE IF EXISTS episode_work_phases CASCADE;

DROP TABLE IF EXISTS work_phase_catalog CASCADE;

ALTER TABLE care_pathways DROP COLUMN IF EXISTS work_phases_json;

COMMIT;

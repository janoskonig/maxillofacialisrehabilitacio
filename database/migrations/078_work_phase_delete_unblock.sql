BEGIN;

-- A kezelési terv sorai bármely státuszban törölhetők (2026-08-20 döntés):
-- a terv szerkesztésekor a felhasználó minden munkafázist elhagyhat, a foglalt
-- időpont pedig automatikusan lemondásra kerül (lásd lib/work-phase-delete.ts).
--
-- Két migrációs kori FK RESTRICT-be futott bele a DELETE, generikus 500-zal:
--   • episode_plan_items.legacy_episode_work_phase_id → RESTRICT
--   • migration_ewp_anomaly.episode_work_phase_id     → RESTRICT
--
-- Az alkalmazás a plan item-eket törlés előtt explicit archiválja (cancelled +
-- archived_at + legacy link NULL), ez a migráció csak azt biztosítja, hogy a
-- backfillelt környezetek se dobjanak 23503-at, ha valami mégis ott maradna.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_episode_plan_items_legacy_ewp') THEN
    ALTER TABLE episode_plan_items DROP CONSTRAINT fk_episode_plan_items_legacy_ewp;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'episode_work_phases'
  ) THEN
    ALTER TABLE episode_plan_items
      ADD CONSTRAINT fk_episode_plan_items_legacy_ewp
      FOREIGN KEY (legacy_episode_work_phase_id) REFERENCES episode_work_phases (id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_migration_ewp_anomaly_ewp') THEN
    ALTER TABLE migration_ewp_anomaly DROP CONSTRAINT fk_migration_ewp_anomaly_ewp;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'episode_work_phases'
  ) THEN
    ALTER TABLE migration_ewp_anomaly
      ADD CONSTRAINT fk_migration_ewp_anomaly_ewp
      FOREIGN KEY (episode_work_phase_id) REFERENCES episode_work_phases (id) ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;

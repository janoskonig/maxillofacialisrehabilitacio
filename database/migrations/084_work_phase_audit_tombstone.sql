BEGIN;

-- WP-0.3 (kódaudit #12): a munkafázis-audit ne törlődjön a fázissal együtt.
--
-- Eddig az episode_work_phase_audit.episode_work_phase_id FK-ja
-- ON DELETE CASCADE volt — az egyetlen CASCADE az episode_work_phases-ra
-- mutató FK-k között. Így a fázis törlésekor a frissen beszúrt
-- new_status='deleted' audit sor ÉS a fázis teljes előzménye is eltűnt,
-- még ugyanabban a tranzakcióban. A 2. fázis (változásnapló) erre a táblára
-- épül, ezért az audit sornak tombstone-ként túl kell élnie a fázist.
--
-- 1) episode_work_phase_id nullable + FK ON DELETE SET NULL.
--    Az episode_id marad a kapaszkodó — az ő CASCADE-je helyes: az epizód
--    törlésekor az audit is mehet.
ALTER TABLE episode_work_phase_audit
  ALTER COLUMN episode_work_phase_id DROP NOT NULL;

ALTER TABLE episode_work_phase_audit
  DROP CONSTRAINT IF EXISTS episode_work_phase_audit_episode_work_phase_id_fkey;
ALTER TABLE episode_work_phase_audit
  ADD CONSTRAINT episode_work_phase_audit_episode_work_phase_id_fkey
  FOREIGN KEY (episode_work_phase_id) REFERENCES episode_work_phases (id) ON DELETE SET NULL;

-- 2) Denormalizált snapshot oszlopok — a fázis törlése után ezek nélkül a
--    sor olvashatatlan (nem tudni, MELYIK fázisról szólt).
ALTER TABLE episode_work_phase_audit
  ADD COLUMN IF NOT EXISTS work_phase_code VARCHAR(80),
  ADD COLUMN IF NOT EXISTS custom_label VARCHAR(200),
  ADD COLUMN IF NOT EXISTS pool VARCHAR(20),
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

-- 3) Backfill a meglévő sorokra az élő EWP-kből (ahol még létezik a fázis).
--    A már törölt fázisok audit sorai a régi CASCADE miatt úgysem léteznek.
UPDATE episode_work_phase_audit a
   SET work_phase_code  = ewp.work_phase_code,
       custom_label     = ewp.custom_label,
       pool             = ewp.pool,
       duration_minutes = ewp.duration_minutes
  FROM episode_work_phases ewp
 WHERE a.episode_work_phase_id = ewp.id
   AND a.work_phase_code IS NULL;

COMMENT ON COLUMN episode_work_phase_audit.episode_work_phase_id IS
  'Az érintett fázis; NULL, ha a fázist azóta törölték (tombstone — a snapshot oszlopok őrzik, mi volt).';
COMMENT ON COLUMN episode_work_phase_audit.work_phase_code IS
  'Snapshot a fázisról a bejegyzés idején (084); NULL csak a 084 előtti, élő fázis nélküli sorokon lehet.';

COMMIT;

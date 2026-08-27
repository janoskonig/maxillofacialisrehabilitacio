-- 088: Gondozás (recall) — rugalmas kadencia, kézi sorok, epizód-rizikószint (WP-3.1)
--
--  1. A 081-es CHECK (recall_interval_days IN (180, 365)) feloldása: bármely
--     pozitív nap érvényes, így a rövid távú (pl. 1-3 hetes) visszarendelés is elfér.
--  2. Új oszlopok az episode_tasks-on: source ('auto' | 'manual', default 'auto'),
--     label (pl. „2 hetes sebgyógyulási kontroll"), created_by (users.id).
--  3. Az idx_episode_tasks_recall_interval_unique cseréje: az (episode_id,
--     recall_interval_days) unicitás csak az AUTOMATIKUSAN generált sorokra marad
--     (partiális index source='auto'-ra) — kézi sorból tetszőleges vehető fel.
--  4. patient_episodes.recall_risk_level ('low' | 'medium' | 'high', NULL = low
--     kadencia) — epizód-szinten, mert a rizikó epizódonként eltérhet.
--  5. Backfill: a meglévő recall sorok source='auto' (oszlop-default tölti) és
--     generált címkét kapnak.
--
-- IDEMPOTENS: IF EXISTS / IF NOT EXISTS őrökkel, ismételt futtatásra biztonságos.
--
-- DEPLOY-KÖTÉS — KÉTIRÁNYÚ, a kóddal szigorúan együtt jár:
--   * régi kód + ÚJ séma: az ensure ON CONFLICT-ja a régi (törölt) unique
--     indexet célozná → 42P10, a recall GET 500-zal hasal;
--   * új kód + RÉGI séma: a source/label/created_by oszlopok hiányoznak → 42703.
-- Ezért a 088-at ugyanabban a deployban, az új kód kiszolgálása ELŐTT kell
-- futtatni; rolling deploynál rövid hibaablak várható a recall GET-en.

BEGIN;

-- 2. Új oszlopok (a source default 'auto' a meglévő sorokat is feltölti)
ALTER TABLE episode_tasks
  ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS label VARCHAR(200),
  ADD COLUMN IF NOT EXISTS created_by UUID;

ALTER TABLE episode_tasks
  DROP CONSTRAINT IF EXISTS episode_tasks_source_check;
ALTER TABLE episode_tasks
  ADD CONSTRAINT episode_tasks_source_check
  CHECK (source IN ('auto', 'manual'));

-- 1. CHECK-feloldás: tetszőleges pozitív recall_interval_days
ALTER TABLE episode_tasks
  DROP CONSTRAINT IF EXISTS episode_tasks_recall_interval_days_check;
ALTER TABLE episode_tasks
  ADD CONSTRAINT episode_tasks_recall_interval_days_check
  CHECK (recall_interval_days IS NULL OR recall_interval_days > 0);

-- 5. Címke-backfill a meglévő (a régi CHECK miatt kizárólag 180/365 napos) sorokra.
--    A CASE-ágak a lib/recall-cadence.ts recallLabelForInterval kimenetével egyeznek.
UPDATE episode_tasks
   SET label = CASE recall_interval_days
                 WHEN 180 THEN '6 hónapos kontroll'
                 WHEN 365 THEN '12 hónapos kontroll'
                 ELSE recall_interval_days::text || ' napos kontroll'
               END
 WHERE task_type = 'recall_due'
   AND recall_interval_days IS NOT NULL
   AND label IS NULL;

-- 3. Unique index csere: az unicitás csak az auto-generált sorokra marad
DROP INDEX IF EXISTS idx_episode_tasks_recall_interval_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_episode_tasks_recall_interval_auto_unique
  ON episode_tasks (episode_id, recall_interval_days)
  WHERE task_type = 'recall_due' AND recall_interval_days IS NOT NULL AND source = 'auto';

-- 4. Epizód-szintű rizikószint (NULL = a mai 'low' viselkedés)
ALTER TABLE patient_episodes
  ADD COLUMN IF NOT EXISTS recall_risk_level VARCHAR(10);
ALTER TABLE patient_episodes
  DROP CONSTRAINT IF EXISTS patient_episodes_recall_risk_level_check;
ALTER TABLE patient_episodes
  ADD CONSTRAINT patient_episodes_recall_risk_level_check
  CHECK (recall_risk_level IS NULL OR recall_risk_level IN ('low', 'medium', 'high'));

COMMIT;

BEGIN;

ALTER TABLE episode_tasks
  ADD COLUMN IF NOT EXISTS recall_interval_days INT,
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL;

ALTER TABLE episode_tasks
  DROP CONSTRAINT IF EXISTS episode_tasks_recall_interval_days_check;
ALTER TABLE episode_tasks
  ADD CONSTRAINT episode_tasks_recall_interval_days_check
  CHECK (recall_interval_days IS NULL OR recall_interval_days IN (180, 365));

-- A régi létrehozó due_at sorrendben írta a 6/12 hónapos párt. A kanonikus
-- első két sort felcímkézzük; esetleges többletsor auditként megmarad, de az új
-- workflow és a kapacitásszámítás már nem tekinti aktív recallnak.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY episode_id ORDER BY due_at, created_at, id) AS rn
    FROM episode_tasks
   WHERE task_type = 'recall_due'
     AND recall_interval_days IS NULL
)
UPDATE episode_tasks et
   SET recall_interval_days = CASE ranked.rn WHEN 1 THEN 180 WHEN 2 THEN 365 END
  FROM ranked
 WHERE et.id = ranked.id
   AND ranked.rn <= 2;

CREATE UNIQUE INDEX IF NOT EXISTS idx_episode_tasks_recall_interval_unique
  ON episode_tasks (episode_id, recall_interval_days)
  WHERE task_type = 'recall_due' AND recall_interval_days IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_episode_tasks_recall_appointment_unique
  ON episode_tasks (appointment_id)
  WHERE appointment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_episode_tasks_recall_open_due
  ON episode_tasks (due_at)
  WHERE task_type = 'recall_due'
    AND recall_interval_days IS NOT NULL
    AND completed_at IS NULL;

COMMIT;

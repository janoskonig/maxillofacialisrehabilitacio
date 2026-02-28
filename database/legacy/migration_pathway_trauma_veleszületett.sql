-- Migration: Trauma + veleszületett pathway seed
-- Run after: migration_care_pathways_xor_fix.sql
-- Partial UNIQUE(reason) WHERE reason IS NOT NULL — UPSERT trauma + veleszületett

BEGIN;

-- Partial unique index: legfeljebb 1 pathway / reason (reason-os soroknál)
CREATE UNIQUE INDEX IF NOT EXISTS idx_care_pathways_reason_unique
  ON care_pathways (reason) WHERE reason IS NOT NULL;

-- UPSERT trauma + veleszületett — ugyanaz a steps_json sorrend mint onkológiai
INSERT INTO care_pathways (name, reason, treatment_type_id, steps_json, version, priority)
VALUES
  (
    'Traumás sérülés rehabilitáció',
    'traumás sérülés',
    NULL,
    '[
      {"step_code": "consult_1", "pool": "consult", "duration_minutes": 30, "default_days_offset": 0},
      {"step_code": "diagnostic", "pool": "work", "duration_minutes": 45, "default_days_offset": 14},
      {"step_code": "impression_1", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
      {"step_code": "try_in_1", "pool": "work", "duration_minutes": 30, "default_days_offset": 10},
      {"step_code": "try_in_2", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
      {"step_code": "delivery", "pool": "work", "duration_minutes": 45, "default_days_offset": 7, "requires_precommit": true},
      {"step_code": "control_6m", "pool": "control", "duration_minutes": 15, "default_days_offset": 180},
      {"step_code": "control_12m", "pool": "control", "duration_minutes": 15, "default_days_offset": 365}
    ]'::jsonb,
    1,
    0
  ),
  (
    'Veleszületett rendellenesség rehabilitáció',
    'veleszületett rendellenesség',
    NULL,
    '[
      {"step_code": "consult_1", "pool": "consult", "duration_minutes": 30, "default_days_offset": 0},
      {"step_code": "diagnostic", "pool": "work", "duration_minutes": 45, "default_days_offset": 14},
      {"step_code": "impression_1", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
      {"step_code": "try_in_1", "pool": "work", "duration_minutes": 30, "default_days_offset": 10},
      {"step_code": "try_in_2", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
      {"step_code": "delivery", "pool": "work", "duration_minutes": 45, "default_days_offset": 7, "requires_precommit": true},
      {"step_code": "control_6m", "pool": "control", "duration_minutes": 15, "default_days_offset": 180},
      {"step_code": "control_12m", "pool": "control", "duration_minutes": 15, "default_days_offset": 365}
    ]'::jsonb,
    1,
    0
  )
ON CONFLICT (reason) WHERE (reason IS NOT NULL)
DO UPDATE SET
  name = EXCLUDED.name,
  steps_json = EXCLUDED.steps_json,
  updated_at = now();

COMMIT;

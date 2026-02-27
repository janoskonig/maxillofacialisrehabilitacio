-- Migration: slot_intents step_seq + UNIQUE(episode_id, step_code, step_seq)
-- Run after: migration_scheduling_v2.sql
-- Fix: ismétlődő step_code (kontrollok, duplázott próbák) → intent létrehozás; governance cél

BEGIN;

-- 1) step_seq oszlop (steps_json index = hányadik előfordulás)
ALTER TABLE slot_intents ADD COLUMN IF NOT EXISTS step_seq INT NOT NULL DEFAULT 0;

-- 2) Backfill: ha vannak duplikátumok (episode_id, step_code), sorszámozzuk created_at szerint
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY episode_id, step_code ORDER BY created_at) - 1 AS rn
  FROM slot_intents
)
UPDATE slot_intents si SET step_seq = r.rn FROM ranked r WHERE si.id = r.id;

-- 3) UNIQUE constraint — régi (episode_id, step_code) csak, ha volt, nem volt; uj (episode_id, step_code, step_seq)
ALTER TABLE slot_intents DROP CONSTRAINT IF EXISTS uq_slot_intents_episode_step;
ALTER TABLE slot_intents DROP CONSTRAINT IF EXISTS uq_slot_intents_episode_step_seq;
ALTER TABLE slot_intents ADD CONSTRAINT uq_slot_intents_episode_step_seq
  UNIQUE (episode_id, step_code, step_seq);

COMMIT;

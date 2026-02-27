-- Migration: Multi-pathway episodes
-- Allows multiple care_pathways per episode via junction table.
-- Adds source tracking and global ordering (seq) to episode_steps.
-- Idempotent: safe to run multiple times.
-- Run with: psql -d <db> -f database/migration_multi_pathway_episodes.sql

BEGIN;

-- =============================================================================
-- 1. episode_pathways — junction table (episode ↔ care_pathway, N:M)
-- =============================================================================
CREATE TABLE IF NOT EXISTS episode_pathways (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    episode_id UUID NOT NULL REFERENCES patient_episodes(id) ON DELETE CASCADE,
    care_pathway_id UUID NOT NULL REFERENCES care_pathways(id) ON DELETE RESTRICT,
    ordinal INT NOT NULL DEFAULT 0,
    added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_episode_pathways_episode_pathway UNIQUE (episode_id, care_pathway_id)
);

CREATE INDEX IF NOT EXISTS idx_episode_pathways_episode
    ON episode_pathways (episode_id, ordinal);

COMMENT ON TABLE episode_pathways IS 'Junction: one episode can have N care_pathways. Steps generated per pathway, merged via episode_steps.seq.';

-- =============================================================================
-- 2. episode_steps — add source_episode_pathway_id + seq columns
-- =============================================================================
ALTER TABLE episode_steps ADD COLUMN IF NOT EXISTS source_episode_pathway_id UUID REFERENCES episode_pathways(id) ON DELETE SET NULL;
ALTER TABLE episode_steps ADD COLUMN IF NOT EXISTS seq INT;

CREATE INDEX IF NOT EXISTS idx_episode_steps_seq
    ON episode_steps (episode_id, seq) WHERE seq IS NOT NULL;

-- =============================================================================
-- 3. Backward-compat: migrate existing data
--    For every episode that has care_pathway_id set, create an episode_pathways row
--    and backfill source_episode_pathway_id + seq on episode_steps.
-- =============================================================================

-- 3a. Create episode_pathways rows from existing patient_episodes.care_pathway_id
INSERT INTO episode_pathways (episode_id, care_pathway_id, ordinal)
SELECT pe.id, pe.care_pathway_id, 0
FROM patient_episodes pe
WHERE pe.care_pathway_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM episode_pathways ep
    WHERE ep.episode_id = pe.id AND ep.care_pathway_id = pe.care_pathway_id
  );

-- 3b. Backfill source_episode_pathway_id on episode_steps
UPDATE episode_steps es
SET source_episode_pathway_id = ep.id
FROM episode_pathways ep
WHERE es.episode_id = ep.episode_id
  AND es.source_episode_pathway_id IS NULL;

-- 3c. Backfill seq = pathway_order_index where seq is null
UPDATE episode_steps
SET seq = pathway_order_index
WHERE seq IS NULL;

COMMIT;

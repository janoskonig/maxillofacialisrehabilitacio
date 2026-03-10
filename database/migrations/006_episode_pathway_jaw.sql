-- Migration: Add jaw designation to episode_pathways
-- Allows the same care_pathway to be assigned twice to an episode (once per jaw).
-- Run with: npm run migrate  (or node scripts/run-all-migrations.js)

BEGIN;

-- 1. Add jaw column (nullable: NULL = non-jaw-specific, e.g. arcot érinto)
ALTER TABLE episode_pathways
  ADD COLUMN IF NOT EXISTS jaw VARCHAR(10)
  CHECK (jaw IS NULL OR jaw IN ('felso', 'also'));

-- 2. Drop old unique constraint that prevents same pathway twice per episode
ALTER TABLE episode_pathways
  DROP CONSTRAINT IF EXISTS uq_episode_pathways_episode_pathway;

-- 3. Add new unique constraint: same pathway + jaw combination per episode
--    Use COALESCE to handle NULL jaw (treat NULL as '_none_' for uniqueness)
CREATE UNIQUE INDEX IF NOT EXISTS uq_episode_pathways_episode_pathway_jaw
  ON episode_pathways (episode_id, care_pathway_id, COALESCE(jaw, '_none_'));

COMMIT;

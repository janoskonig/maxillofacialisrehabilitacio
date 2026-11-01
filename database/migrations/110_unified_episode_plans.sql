-- Narrative and structured plans share the same immutable version history.
-- An incomplete narrative is a draft, never an invented clinical baseline.
BEGIN;
ALTER TABLE prosthesis_plan_versions ALTER COLUMN baseline_state_id DROP NOT NULL;
ALTER TABLE prosthesis_plan_versions ADD COLUMN IF NOT EXISTS episode_plan_version INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS prosthesis_plan_episode_revision
  ON prosthesis_plan_versions(episode_id,episode_plan_version) WHERE episode_plan_version IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='prosthesis_plan_versions'::regclass AND conname='approved_plan_has_baseline') THEN
    ALTER TABLE prosthesis_plan_versions ADD CONSTRAINT approved_plan_has_baseline
      CHECK (NOT approved OR baseline_state_id IS NOT NULL);
  END IF;
END $$;
COMMENT ON COLUMN prosthesis_plan_versions.episode_plan_version IS
  'Revision of the shared treatment editor; legacy separate clinical versions remain unchanged.';
COMMIT;

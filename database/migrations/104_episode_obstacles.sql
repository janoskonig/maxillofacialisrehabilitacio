BEGIN;

-- Unresolved obstacles stay active until explicitly resolved. The expected
-- response date is a follow-up date, not an automatic permission to proceed.
ALTER TABLE episode_blocks ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE episode_blocks
  ADD COLUMN IF NOT EXISTS waiting_on VARCHAR(250),
  ADD COLUMN IF NOT EXISTS waiting_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT;

UPDATE episode_blocks SET waiting_since = COALESCE(created_at, CURRENT_TIMESTAMP)
WHERE waiting_since IS NULL;
ALTER TABLE episode_blocks ALTER COLUMN waiting_since SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE episode_blocks ALTER COLUMN waiting_since SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_episode_obstacles_waiting_since
  ON episode_blocks (waiting_since, id) WHERE active = true;

COMMIT;

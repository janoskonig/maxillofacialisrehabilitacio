BEGIN;

ALTER TABLE consilium_sessions
  ADD COLUMN IF NOT EXISTS attendees JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE consilium_session_items
  ADD COLUMN IF NOT EXISTS discussed BOOLEAN;

UPDATE consilium_session_items
SET discussed = (discussion_status = 'discussed')
WHERE discussed IS NULL;

UPDATE consilium_session_items
SET discussed = false
WHERE discussed IS NULL;

ALTER TABLE consilium_session_items ALTER COLUMN discussed SET NOT NULL;
ALTER TABLE consilium_session_items ALTER COLUMN discussed SET DEFAULT false;

ALTER TABLE consilium_session_items DROP CONSTRAINT IF EXISTS consilium_session_items_discussion_status_check;
ALTER TABLE consilium_session_items DROP COLUMN IF EXISTS discussion_status;

COMMIT;

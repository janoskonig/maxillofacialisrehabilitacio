BEGIN;

ALTER TABLE consilium_session_items DROP COLUMN IF EXISTS presenter_notes;

COMMIT;

BEGIN;

ALTER TABLE consilium_item_prep_tokens
  ADD COLUMN IF NOT EXISTS raw_token TEXT NULL;

-- Legfeljebb egy aktív, újra-másolható (raw_tokenös) link konzílium-elemenként.
CREATE UNIQUE INDEX IF NOT EXISTS idx_consilium_prep_tokens_one_active_raw_per_item
  ON consilium_item_prep_tokens (item_id)
  WHERE revoked_at IS NULL AND raw_token IS NOT NULL;

COMMIT;

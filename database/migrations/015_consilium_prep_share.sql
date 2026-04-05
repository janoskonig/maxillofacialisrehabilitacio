BEGIN;

CREATE TABLE IF NOT EXISTS consilium_item_prep_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  session_id UUID NOT NULL REFERENCES consilium_sessions(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES consilium_session_items(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_consilium_prep_tokens_item
  ON consilium_item_prep_tokens (item_id);

CREATE INDEX IF NOT EXISTS idx_consilium_prep_tokens_session
  ON consilium_item_prep_tokens (session_id);

CREATE TABLE IF NOT EXISTS consilium_prep_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES consilium_sessions(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES consilium_session_items(id) ON DELETE CASCADE,
  checklist_key TEXT NOT NULL,
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_display TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consilium_prep_comments_body_len CHECK (char_length(body) <= 4000)
);

CREATE INDEX IF NOT EXISTS idx_consilium_prep_comments_item_key_created
  ON consilium_prep_comments (item_id, checklist_key, created_at ASC);

COMMIT;

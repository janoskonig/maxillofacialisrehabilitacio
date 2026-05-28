-- Fázis 2.2: full-text search on patient + doctor message tables.

BEGIN;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('hungarian', coalesce(subject, '')), 'A') ||
      setweight(to_tsvector('hungarian', coalesce(message, '')), 'B')
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_messages_search_vector
  ON messages USING GIN (search_vector);

ALTER TABLE doctor_messages
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('hungarian', coalesce(subject, '')), 'A') ||
      setweight(to_tsvector('hungarian', coalesce(message, '')), 'B')
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_doctor_messages_search_vector
  ON doctor_messages USING GIN (search_vector);

COMMENT ON COLUMN messages.search_vector IS
  'FTS index (hungarian) for subject + body — Fázis 2.2 keresés.';

COMMENT ON COLUMN doctor_messages.search_vector IS
  'FTS index (hungarian) for subject + body — Fázis 2.2 keresés.';

COMMIT;

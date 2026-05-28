-- Fázis 2.0: strukturált üzenet–entitás linkek + üzenet-audit napló (context link CRUD).

BEGIN;

CREATE TABLE IF NOT EXISTS message_audit_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    UUID NOT NULL,
  channel       TEXT NOT NULL CHECK (channel IN ('patient', 'doctor')),
  event_type    TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_audit_events_message
  ON message_audit_events (channel, message_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_audit_events_created_at
  ON message_audit_events (created_at DESC);

COMMENT ON TABLE message_audit_events IS
  'Append-only üzenet-mutáció audit (szerkesztés, törlés, context link, csatolmány, …).';

CREATE TABLE IF NOT EXISTS message_context_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel      TEXT NOT NULL CHECK (channel IN ('patient', 'doctor')),
  message_id   UUID NOT NULL,
  entity_type  TEXT NOT NULL CHECK (entity_type IN (
    'patient', 'episode', 'work_phase', 'appointment',
    'document', 'consilium_session', 'task'
  )),
  entity_id    UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT message_context_links_unique
    UNIQUE (channel, message_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_message_context_links_entity
  ON message_context_links (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_context_links_message
  ON message_context_links (channel, message_id, created_at ASC);

COMMENT ON TABLE message_context_links IS
  'Strukturált hivatkozások üzenetekből MaxRehab entitásokra (beteg, epizód, dokumentum, …).';

COMMIT;

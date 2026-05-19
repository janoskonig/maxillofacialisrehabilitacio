BEGIN;

-- Központi napló minden kimenő emailről (sikeres és sikertelen küldés egyaránt).
CREATE TABLE IF NOT EXISTS outbound_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_type VARCHAR(64) NOT NULL DEFAULT 'generic',
  recipient TEXT NOT NULL,
  subject TEXT,
  message_id TEXT,
  status VARCHAR(16) NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message TEXT,
  sent_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbound_email_log_type_created
  ON outbound_email_log (email_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_email_log_metadata_quote
  ON outbound_email_log ((metadata->>'quoteId'), created_at DESC)
  WHERE metadata->>'quoteId' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outbound_email_log_metadata_invitation
  ON outbound_email_log ((metadata->>'invitationId'), created_at DESC)
  WHERE metadata->>'invitationId' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outbound_email_log_metadata_patient
  ON outbound_email_log ((metadata->>'patientId'), created_at DESC)
  WHERE metadata->>'patientId' IS NOT NULL;

COMMENT ON TABLE outbound_email_log IS 'Kimenő email küldések naplója (sikeres és sikertelen)';

COMMIT;

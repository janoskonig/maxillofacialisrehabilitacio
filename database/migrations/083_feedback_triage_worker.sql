BEGIN;

-- Rövid életű, egyedi foglalás az automatikus Codex-triázshoz. A nyers
-- foglalási token soha nem kerül az adatbázisba, csak annak SHA-256 lenyomata.
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS triage_worker_claim_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS triage_worker_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS triage_worker_claim_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS triage_worker_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS triage_worker_last_result JSONB;

CREATE INDEX IF NOT EXISTS idx_feedback_triage_worker_queue
  ON feedback (priority_score DESC, created_at ASC)
  WHERE status = 'open' OR (
    status = 'in_progress' AND triage_worker_claim_expires_at IS NOT NULL
  );

COMMENT ON COLUMN feedback.triage_worker_claim_hash IS 'Az aktív worker-foglalás tokenjének SHA-256 lenyomata';
COMMENT ON COLUMN feedback.triage_worker_claimed_at IS 'A legutóbbi automatikus triázs-foglalás időpontja';
COMMENT ON COLUMN feedback.triage_worker_claim_expires_at IS 'Az aktív worker-foglalás lejárata; lejárat után újra foglalható';
COMMENT ON COLUMN feedback.triage_worker_attempts IS 'Automatikus triázs-foglalások száma';
COMMENT ON COLUMN feedback.triage_worker_last_result IS 'A legutóbbi automatikus triázs strukturált, belső eredménye';

COMMIT;

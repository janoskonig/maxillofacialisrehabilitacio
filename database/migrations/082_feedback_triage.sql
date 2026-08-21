BEGIN;

-- Auditálható, felülírható automatikus prioritás a feedback ticketekhez.
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS priority_score SMALLINT NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS priority_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feedback_priority_check'
  ) THEN
    ALTER TABLE feedback
      ADD CONSTRAINT feedback_priority_check
      CHECK (priority IN ('critical', 'high', 'medium', 'low'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feedback_priority_score_check'
  ) THEN
    ALTER TABLE feedback
      ADD CONSTRAINT feedback_priority_score_check
      CHECK (priority_score BETWEEN 0 AND 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_feedback_unresolved_priority
  ON feedback (priority_score DESC, created_at DESC)
  WHERE status IN ('open', 'in_progress');

-- Egyszeri backlog-reset: a migráció bevezetése előtti ticketek a döntés szerint
-- már nem relevánsak. A később érkező ticketek ismét az alapértelmezett `open`
-- státusszal jönnek létre.
UPDATE feedback
SET status = 'closed', updated_at = CURRENT_TIMESTAMP
WHERE status <> 'closed';

-- Naptári nap alapú állapot a napi egyszeri kritikus digesthez.
CREATE TABLE IF NOT EXISTS feedback_critical_digest_state (
  id INT PRIMARY KEY CHECK (id = 1),
  last_sent_on DATE,
  last_sent_at TIMESTAMPTZ
);

COMMENT ON COLUMN feedback.priority IS 'Automatikusan számított vagy admin által felülírt prioritás';
COMMENT ON COLUMN feedback.priority_score IS '0-100 közötti triage pontszám; nagyobb érték sürgősebb';
COMMENT ON COLUMN feedback.priority_reasons IS 'A prioritás számításának auditálható indokai';
COMMENT ON COLUMN feedback.triaged_at IS 'Az utolsó automatikus vagy kézi prioritás-megállapítás ideje';

COMMIT;

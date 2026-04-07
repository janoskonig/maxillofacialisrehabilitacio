-- Audit log for episode work phase status changes (canonical; legacy episode_step_audit retained).
CREATE TABLE IF NOT EXISTS episode_work_phase_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_work_phase_id UUID NOT NULL REFERENCES episode_work_phases (id) ON DELETE CASCADE,
  episode_id UUID NOT NULL REFERENCES patient_episodes (id) ON DELETE CASCADE,
  old_status VARCHAR(20) NOT NULL,
  new_status VARCHAR(20) NOT NULL,
  changed_by VARCHAR(255) NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_episode_work_phase_audit_episode
  ON episode_work_phase_audit (episode_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_episode_work_phase_audit_phase
  ON episode_work_phase_audit (episode_work_phase_id, created_at DESC);

COMMENT ON TABLE episode_work_phase_audit IS 'Append-only audit log for episode work phase status changes (skip/unskip/delete).';

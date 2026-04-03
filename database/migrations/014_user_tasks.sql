BEGIN;

CREATE TABLE IF NOT EXISTS user_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignee_kind TEXT NOT NULL,
  assignee_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assignee_patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  title TEXT NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  source_doctor_message_id UUID REFERENCES doctor_messages(id) ON DELETE SET NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_tasks_assignee_kind_check CHECK (assignee_kind IN ('staff', 'patient')),
  CONSTRAINT user_tasks_task_type_check CHECK (task_type IN ('document_upload', 'ohip14', 'manual', 'meeting_action')),
  CONSTRAINT user_tasks_status_check CHECK (status IN ('open', 'done', 'cancelled')),
  CONSTRAINT user_tasks_assignee_filled_check CHECK (
    (assignee_kind = 'staff' AND assignee_user_id IS NOT NULL AND assignee_patient_id IS NULL)
    OR (assignee_kind = 'patient' AND assignee_patient_id IS NOT NULL AND assignee_user_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_user_tasks_staff_open
  ON user_tasks (assignee_user_id, created_at DESC)
  WHERE status = 'open' AND assignee_kind = 'staff';

CREATE INDEX IF NOT EXISTS idx_user_tasks_patient_open
  ON user_tasks (assignee_patient_id, created_at DESC)
  WHERE status = 'open' AND assignee_kind = 'patient';

CREATE INDEX IF NOT EXISTS idx_user_tasks_patient_context
  ON user_tasks (patient_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_user_tasks_source_message
  ON user_tasks (source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_tasks_source_doctor_message
  ON user_tasks (source_doctor_message_id)
  WHERE source_doctor_message_id IS NOT NULL;

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS consilium_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  institution_id TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consilium_sessions_status_check CHECK (status IN ('draft', 'active', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_consilium_sessions_scheduled_at
  ON consilium_sessions (scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_consilium_sessions_institution_status
  ON consilium_sessions (institution_id, status);

CREATE TABLE IF NOT EXISTS consilium_session_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES consilium_sessions(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL,
  discussion_status TEXT NOT NULL DEFAULT 'pending',
  presenter_notes TEXT,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consilium_session_items_discussion_status_check
    CHECK (discussion_status IN ('pending', 'in_progress', 'discussed', 'deferred')),
  CONSTRAINT consilium_session_items_unique_patient UNIQUE (session_id, patient_id),
  CONSTRAINT consilium_session_items_unique_sort UNIQUE (session_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_consilium_session_items_session_sort
  ON consilium_session_items (session_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_consilium_session_items_patient
  ON consilium_session_items (patient_id);

UPDATE consilium_session_items
SET checklist = '[]'::jsonb
WHERE checklist IS NULL;

COMMIT;

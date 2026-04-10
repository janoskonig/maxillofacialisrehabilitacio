BEGIN;

ALTER TABLE user_tasks
  ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;

COMMENT ON COLUMN user_tasks.viewed_at IS 'When the assignee first opened the task list (staff); NULL means not yet seen.';

COMMIT;

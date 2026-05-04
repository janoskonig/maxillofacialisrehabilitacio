BEGIN;

-- Bővítjük a user_tasks.task_type CHECK constraint-et egy új típussal:
-- 'staff_registration_review' — admin felhasználók feladata egy új munkatárs
-- regisztrációs kérelmének jóváhagyására / elutasítására.

ALTER TABLE user_tasks
  DROP CONSTRAINT IF EXISTS user_tasks_task_type_check;

ALTER TABLE user_tasks
  ADD CONSTRAINT user_tasks_task_type_check
  CHECK (task_type IN (
    'document_upload',
    'ohip14',
    'manual',
    'meeting_action',
    'staff_registration_review'
  ));

COMMIT;

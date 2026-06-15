BEGIN;

-- Admin válasz + belső jegyzet a feedback (visszajelzés / bug) ticketekhez.
-- Eddig csak a `status` volt állítható; a bejelentővel nem lehetett kommunikálni.
--
--  admin_response : a bejelentőnek szánt válasz szövege (emailben is kiküldhető).
--  admin_note     : belső jegyzet, SOSEM megy ki a bejelentőnek.
--  responded_at   : az utolsó admin válasz időpontja.
--  responded_by   : az utoljára válaszoló admin email címe.
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS admin_response TEXT,
  ADD COLUMN IF NOT EXISTS admin_note     TEXT,
  ADD COLUMN IF NOT EXISTS responded_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS responded_by   TEXT;

COMMENT ON COLUMN feedback.admin_response IS 'Adminisztrátori válasz a bejelentőnek (emailben is kiküldhető)';
COMMENT ON COLUMN feedback.admin_note     IS 'Belső jegyzet, nem megy ki a bejelentőnek';
COMMENT ON COLUMN feedback.responded_at   IS 'Az utolsó admin válasz időpontja';
COMMENT ON COLUMN feedback.responded_by   IS 'Az utoljára válaszoló admin email címe';

COMMIT;

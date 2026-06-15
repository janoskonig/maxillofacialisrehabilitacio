BEGIN;

-- AI által javasolt válasz-piszkozat a feedback ticketekhez.
-- A triage-routine (admin loginnal) tölti ki, de SOHA nem küldi ki a bejelentőnek
-- és nem zárja a ticketet — csak javaslatot tesz. Az admin a UI-ból egy kattintással
-- jóváhagyja (átemeli a tényleges admin_response mezőbe és emailben kiküldi).
--
--  ai_draft_response : a Routine által javasolt válaszszöveg (piszkozat).
--  ai_draft_at       : mikor készült a legutóbbi piszkozat.
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS ai_draft_response TEXT,
  ADD COLUMN IF NOT EXISTS ai_draft_at       TIMESTAMPTZ;

COMMENT ON COLUMN feedback.ai_draft_response IS 'AI által javasolt válasz-piszkozat (emberi jóváhagyásra vár, nem megy ki automatikusan)';
COMMENT ON COLUMN feedback.ai_draft_at       IS 'Az utolsó AI-piszkozat időpontja';

COMMIT;

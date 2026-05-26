BEGIN;

-- Összesített számlálók az alkalom szintjén (gyors megjelenítéshez).
ALTER TABLE consilium_sessions
  ADD COLUMN IF NOT EXISTS invitation_send_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_at_change_count INT NOT NULL DEFAULT 0;

ALTER TABLE consilium_session_invitations
  ADD COLUMN IF NOT EXISTS send_count INT NOT NULL DEFAULT 0;

-- Korábbi kiküldések: legalább egyszer ment email (sent_at).
UPDATE consilium_session_invitations
SET send_count = 1
WHERE sent_at IS NOT NULL
  AND send_count = 0;

UPDATE consilium_sessions s
SET invitation_send_count = sub.cnt
FROM (
  SELECT session_id, COALESCE(SUM(send_count), 0)::int AS cnt
  FROM consilium_session_invitations
  GROUP BY session_id
) sub
WHERE s.id = sub.session_id
  AND s.invitation_send_count = 0
  AND sub.cnt > 0;

-- Időpont-változások naplója (régi → új).
CREATE TABLE IF NOT EXISTS consilium_session_schedule_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES consilium_sessions (id) ON DELETE CASCADE,
  old_scheduled_at TIMESTAMPTZ NOT NULL,
  new_scheduled_at TIMESTAMPTZ NOT NULL,
  changed_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consilium_schedule_audit_session
  ON consilium_session_schedule_audit (session_id, created_at DESC);

-- Sikeres email-küldések naplója (címzett + alkalom).
CREATE TABLE IF NOT EXISTS consilium_invitation_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES consilium_sessions (id) ON DELETE CASCADE,
  invitation_id UUID NOT NULL REFERENCES consilium_session_invitations (id) ON DELETE CASCADE,
  attendee_id TEXT NOT NULL,
  sent_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consilium_invitation_send_log_session
  ON consilium_invitation_send_log (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_consilium_invitation_send_log_invitation
  ON consilium_invitation_send_log (invitation_id, created_at DESC);

COMMENT ON COLUMN consilium_sessions.invitation_send_count IS
  'Összes sikeres konzílium-meghívó email-küldés az alkalomra (minden címzett, minden újraküldés).';
COMMENT ON COLUMN consilium_sessions.scheduled_at_change_count IS
  'Hányszor változott a scheduled_at (első létrehozás nem számít).';
COMMENT ON COLUMN consilium_session_invitations.send_count IS
  'Sikeres email-küldések száma ehhez a címzethez (aktuális meghívó sor).';

COMMIT;

BEGIN;

-- Konzílium meghívók: alkalom-szintű RSVP a hozzáadott jelenlévőknek.
-- Egyetlen aktív (visszavonatlan) meghívó címzettenként; az RSVP válasz
-- ('going' | 'late' | 'reschedule') a token egyszeri / többszöri használatával
-- frissíthető (a felhasználó meggondolhatja magát az értekezletig).
CREATE TABLE IF NOT EXISTS consilium_session_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES consilium_sessions(id) ON DELETE CASCADE,
  -- A users.id-vel egyező szöveges azonosító (consilium_sessions.attendees[].id).
  attendee_id TEXT NOT NULL,
  attendee_name TEXT NOT NULL,
  attendee_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  -- A nyers token tárolása lehetővé teszi az újra-küldést ugyanazon a linken,
  -- így az addigi RSVP válasz nem vész el. Csak a megosztó/címzettek látják
  -- (server-side, soha nem küldjük ki API-ban).
  raw_token TEXT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  responded_at TIMESTAMPTZ NULL,
  response TEXT NULL,
  proposed_at TIMESTAMPTZ NULL,
  proposed_note TEXT NULL,
  CONSTRAINT consilium_session_invitations_response_check
    CHECK (response IS NULL OR response IN ('going', 'late', 'reschedule')),
  CONSTRAINT consilium_session_invitations_proposed_consistency_check
    CHECK (
      response <> 'reschedule'
      OR proposed_at IS NOT NULL
    ),
  CONSTRAINT consilium_session_invitations_proposed_note_len
    CHECK (proposed_note IS NULL OR char_length(proposed_note) <= 1000)
);

-- Egy aktív meghívó címzettenként és alkalmanként.
CREATE UNIQUE INDEX IF NOT EXISTS idx_consilium_invitations_one_active_per_attendee
  ON consilium_session_invitations (session_id, attendee_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_consilium_invitations_session
  ON consilium_session_invitations (session_id);

CREATE INDEX IF NOT EXISTS idx_consilium_invitations_responded
  ON consilium_session_invitations (session_id, responded_at);

COMMIT;

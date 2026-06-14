-- Performance indexes for the messaging conversation-list hot paths.
-- Safe to run multiple times (IF NOT EXISTS).
-- Note: CONCURRENTLY omitted so this can run in a transaction (Node migration runner).
--
-- Háttér: a chat-nézet betöltésekor a beszélgetéslista lekérdezések futnak. A
-- meglévő egy-oszlopos indexek (patient_id / sender_id / recipient_id /
-- created_at) nem szolgálják ki jól a "beszélgetésenként az utolsó üzenet"
-- (DISTINCT ON ... ORDER BY ... created_at DESC) és a kétirányú 1:1 mintát.

-- Beteg↔orvos: /api/messages/conversations
--   SELECT DISTINCT ON (m.patient_id) ... ORDER BY m.patient_id, m.created_at DESC
CREATE INDEX IF NOT EXISTS idx_messages_patient_created
  ON messages (patient_id, created_at DESC);

-- Orvos↔orvos: lib/doctor-communication.getDoctorConversations
--   utolsó üzenet: ((sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1))
--                  AND group_id IS NULL ORDER BY created_at DESC LIMIT 1
--   olvasatlan:    recipient_id=$1 AND sender_id=$2 AND read_at IS NULL AND group_id IS NULL
-- A partial (group_id IS NULL) kicsi és pontosan az 1:1 szálakra illik.
CREATE INDEX IF NOT EXISTS idx_doctor_messages_sender_recipient_created
  ON doctor_messages (sender_id, recipient_id, created_at DESC)
  WHERE group_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_doctor_messages_recipient_sender_created
  ON doctor_messages (recipient_id, sender_id, created_at DESC)
  WHERE group_id IS NULL;

-- Doctor messages table for doctor-to-doctor communication
-- Run with: psql -d <db> -f database/migration_doctor_messages.sql

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS doctor_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_email TEXT NOT NULL, -- Email cím a küldőnek (audit trail)
    sender_name TEXT, -- Orvos neve (doktor_neve)
    subject TEXT, -- Opcionális tárgy
    message TEXT NOT NULL, -- Az üzenet tartalma
    read_at TIMESTAMPTZ, -- Mikor olvasták el
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_doctor_messages_sender_id ON doctor_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_doctor_messages_recipient_id ON doctor_messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_doctor_messages_created_at ON doctor_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_doctor_messages_read_at ON doctor_messages(read_at) WHERE read_at IS NULL; -- Partial index for unread messages

-- Comments
COMMENT ON TABLE doctor_messages IS 'Üzenetek az orvosok között';
COMMENT ON COLUMN doctor_messages.sender_id IS 'Küldő orvos ID-ja (users.id)';
COMMENT ON COLUMN doctor_messages.recipient_id IS 'Címzett orvos ID-ja (users.id)';
COMMENT ON COLUMN doctor_messages.sender_email IS 'Küldő email címe (audit trail)';
COMMENT ON COLUMN doctor_messages.sender_name IS 'Küldő orvos neve (doktor_neve)';
COMMENT ON COLUMN doctor_messages.read_at IS 'Mikor olvasták el az üzenetet (NULL = olvasatlan)';


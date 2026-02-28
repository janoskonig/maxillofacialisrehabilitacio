-- Messages table for doctor-patient communication
-- Run with: psql -d <db> -f database/migration_messages.sql

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create ENUM type for sender type
DO $$ BEGIN
    CREATE TYPE sender_type_enum AS ENUM ('doctor', 'patient');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    sender_type sender_type_enum NOT NULL,
    sender_id UUID NOT NULL, -- References users.id (if doctor) or patients.id (if patient)
    sender_email TEXT NOT NULL, -- Email cím a küldőnek (audit trail)
    subject TEXT, -- Opcionális tárgy
    message TEXT NOT NULL, -- Az üzenet tartalma
    read_at TIMESTAMPTZ, -- Mikor olvasták el
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_patient_id ON messages(patient_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_type ON messages(sender_type);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_read_at ON messages(read_at) WHERE read_at IS NULL; -- Partial index for unread messages
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);

-- Comments
COMMENT ON TABLE messages IS 'Üzenetek az orvosok és betegek között';
COMMENT ON COLUMN messages.sender_type IS 'Küldő típusa: doctor vagy patient';
COMMENT ON COLUMN messages.sender_id IS 'Küldő ID-ja (users.id ha doctor, patients.id ha patient)';
COMMENT ON COLUMN messages.sender_email IS 'Küldő email címe (audit trail)';
COMMENT ON COLUMN messages.read_at IS 'Mikor olvasták el az üzenetet (NULL = olvasatlan)';


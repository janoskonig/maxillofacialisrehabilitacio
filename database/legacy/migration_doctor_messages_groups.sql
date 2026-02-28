-- Doctor messages groups migration
-- Adds support for group chats (multiple doctors in one conversation)
-- Run with: psql -d <db> -f database/migration_doctor_messages_groups.sql

BEGIN;

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Csoportos beszélgetések táblája
CREATE TABLE IF NOT EXISTS doctor_message_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT, -- Opcionális csoport név
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Résztvevők a csoportokban
CREATE TABLE IF NOT EXISTS doctor_message_group_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES doctor_message_groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, user_id)
);

-- doctor_messages tábla módosítása: group_id mező hozzáadása és recipient_id opcionálissá tétele
ALTER TABLE doctor_messages 
ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES doctor_message_groups(id) ON DELETE CASCADE;

-- recipient_id opcionálissá tétele (csoportos beszélgetésnél NULL lehet)
ALTER TABLE doctor_messages 
ALTER COLUMN recipient_id DROP NOT NULL;

-- Indexek a gyors kereséshez
CREATE INDEX IF NOT EXISTS idx_doctor_messages_group_id ON doctor_messages(group_id);
CREATE INDEX IF NOT EXISTS idx_group_participants_group_id ON doctor_message_group_participants(group_id);
CREATE INDEX IF NOT EXISTS idx_group_participants_user_id ON doctor_message_group_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_message_groups_created_by ON doctor_message_groups(created_by);

-- Comments
COMMENT ON TABLE doctor_message_groups IS 'Csoportos beszélgetések az orvosok között';
COMMENT ON COLUMN doctor_message_groups.name IS 'Opcionális csoport név';
COMMENT ON COLUMN doctor_message_groups.created_by IS 'A csoportot létrehozó orvos ID-ja';
COMMENT ON TABLE doctor_message_group_participants IS 'Résztvevők a csoportos beszélgetésekben';
COMMENT ON COLUMN doctor_messages.group_id IS 'Csoport ID-ja (NULL = egy-egy beszélgetés)';

COMMIT;


-- Doctor message reads migration
-- Adds support for tracking who read which message in group chats
-- Run with: psql -d <db> -f database/migration_doctor_message_reads.sql

BEGIN;

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Tábla az üzenetek olvasásának követésére (group chat-ekhez)
CREATE TABLE IF NOT EXISTS doctor_message_reads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES doctor_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, user_id)
);

-- Indexek a gyors kereséshez
CREATE INDEX IF NOT EXISTS idx_doctor_message_reads_message_id ON doctor_message_reads(message_id);
CREATE INDEX IF NOT EXISTS idx_doctor_message_reads_user_id ON doctor_message_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_doctor_message_reads_read_at ON doctor_message_reads(read_at);

-- Comments
COMMENT ON TABLE doctor_message_reads IS 'Üzenetek olvasásának követése (group chat-ekhez)';
COMMENT ON COLUMN doctor_message_reads.message_id IS 'Az üzenet ID-ja';
COMMENT ON COLUMN doctor_message_reads.user_id IS 'Az olvasó orvos ID-ja';
COMMENT ON COLUMN doctor_message_reads.read_at IS 'Mikor olvasta el az üzenetet';

COMMIT;

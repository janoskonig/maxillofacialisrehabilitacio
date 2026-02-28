-- Migration: Push subscriptions table for web push notifications
-- Run with: psql -d <db> -f database/migration_push_subscriptions.sql

BEGIN;

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, endpoint)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_push_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_push_subscriptions_updated_at
    BEFORE UPDATE ON push_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_push_subscriptions_updated_at();

-- Comments
COMMENT ON TABLE push_subscriptions IS 'Web push notification subscriptions for users';
COMMENT ON COLUMN push_subscriptions.user_id IS 'User ID who subscribed to push notifications';
COMMENT ON COLUMN push_subscriptions.endpoint IS 'Push subscription endpoint URL';
COMMENT ON COLUMN push_subscriptions.p256dh IS 'P256DH public key for encryption';
COMMENT ON COLUMN push_subscriptions.auth IS 'Auth secret for encryption';
COMMENT ON COLUMN push_subscriptions.user_agent IS 'User agent string for audit purposes';

COMMIT;

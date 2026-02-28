-- Feature flags for scheduling (overbooking, auto-convert, auto-rebalance, strict one-hard-next)
-- Run with: psql -d <db> -f database/migration_scheduling_feature_flags.sql

BEGIN;

CREATE TABLE IF NOT EXISTS scheduling_feature_flags (
    key VARCHAR(80) PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scheduling_feature_flags_enabled ON scheduling_feature_flags(enabled) WHERE enabled = true;

-- Seed default flags (all disabled for safe rollout)
INSERT INTO scheduling_feature_flags (key, enabled) VALUES
    ('overbooking', false),
    ('auto_convert_intents', false),
    ('auto_rebalance', false),
    ('strict_one_hard_next', false)
ON CONFLICT (key) DO NOTHING;

COMMIT;

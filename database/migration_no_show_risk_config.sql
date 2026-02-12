-- Migration: No-show risk config (tunable coefficients for Level 1 calibration)
-- Run with: psql -d <db> -f database/migration_no_show_risk_config.sql

BEGIN;

CREATE TABLE IF NOT EXISTS no_show_risk_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(80) NOT NULL UNIQUE,
    value NUMERIC(10,4) NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO no_show_risk_config (key, value, description) VALUES
('base_risk', 0.05, 'Base risk (0-1)'),
('no_show_1_penalty', 0.15, 'Add if patient_no_shows_last_12m >= 1'),
('no_show_2_penalty', 0.10, 'Add if patient_no_shows_last_12m >= 2'),
('lead_time_penalty', 0.05, 'Add if lead_time_days > 21'),
('early_morning_penalty', 0.05, 'Add if appointment 7-9h'),
('requires_confirmation_threshold', 0.20, 'risk >= this => requires_confirmation'),
('short_hold_threshold', 0.35, 'risk >= this => hold 24h, else 48h')
ON CONFLICT (key) DO NOTHING;

COMMIT;

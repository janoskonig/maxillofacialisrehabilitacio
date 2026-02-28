-- Migration: Pathway analytics for forecast calibration (Level 1)
-- Run with: psql -d <db> -f database/migration_pathway_analytics.sql

BEGIN;

CREATE TABLE IF NOT EXISTS care_pathway_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    care_pathway_id UUID NOT NULL REFERENCES care_pathways(id) ON DELETE CASCADE,
    recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    episodes_completed INT NOT NULL DEFAULT 0,
    median_visits NUMERIC(10,2),
    p80_visits NUMERIC(10,2),
    median_cadence_days NUMERIC(10,2),
    p80_cadence_days NUMERIC(10,2),
    no_show_rate NUMERIC(5,4)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_care_pathway_analytics_pathway_unique ON care_pathway_analytics(care_pathway_id);


COMMENT ON TABLE care_pathway_analytics IS 'Calibrated pathway analytics: median/p80 visits, cadence, no-show rate. Used for Level 1 forecast.';

COMMIT;

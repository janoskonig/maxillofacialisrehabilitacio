-- Up: Materialized view for DMFT statistics (avoids repeated jsonb_each scans)

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dmft_stats AS
SELECT
  p.id AS patient_id,
  key::int AS fog_szam,
  value->>'status' AS status
FROM patients p,
LATERAL jsonb_each(p.meglevo_fogak)
WHERE p.meglevo_fogak IS NOT NULL AND p.meglevo_fogak != '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS mv_dmft_stats_pk ON mv_dmft_stats (patient_id, fog_szam);
CREATE INDEX IF NOT EXISTS mv_dmft_stats_status ON mv_dmft_stats (status);

-- Down: DROP MATERIALIZED VIEW IF EXISTS mv_dmft_stats;

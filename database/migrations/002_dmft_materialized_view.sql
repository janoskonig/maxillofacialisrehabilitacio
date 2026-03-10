-- Up: Materialized view for DMFT statistics (avoids repeated jsonb_each scans)
-- Only created if patients.meglevo_fogak exists (skipped when schema is not yet applied).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patients' AND column_name = 'meglevo_fogak'
  ) THEN
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dmft_stats AS
    SELECT
      p.id AS patient_id,
      (t.key)::int AS fog_szam,
      (t.value->>'status') AS status
    FROM patients p,
    LATERAL jsonb_each(p.meglevo_fogak) AS t(key, value)
    WHERE p.meglevo_fogak IS NOT NULL AND p.meglevo_fogak != '{}'::jsonb;

    CREATE UNIQUE INDEX IF NOT EXISTS mv_dmft_stats_pk ON mv_dmft_stats (patient_id, fog_szam);
    CREATE INDEX IF NOT EXISTS mv_dmft_stats_status ON mv_dmft_stats (status);
  END IF;
END $$;

-- Down: DROP MATERIALIZED VIEW IF EXISTS mv_dmft_stats;

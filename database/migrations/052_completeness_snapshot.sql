BEGIN;

-- Napi adat-teljességi pillanatkép a trend-követéshez. Egy sor / nap (a
-- snapshot_date az elsődleges kulcs → idempotens upsert). A vezetői nézet ebből
-- rajzolja a pontszám időbeli alakulását.

CREATE TABLE IF NOT EXISTS data_completeness_snapshot (
  snapshot_date DATE PRIMARY KEY,
  total INTEGER NOT NULL,
  avg_score INTEGER NOT NULL,
  clinical_complete INTEGER NOT NULL,
  research_ready INTEGER NOT NULL,
  with_warnings INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;

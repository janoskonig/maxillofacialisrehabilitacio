BEGIN;

-- Generikus PRO (Patient-Reported Outcome) tároló — több validált mérőeszközhöz
-- (kezdetben UW-QOL v4), a meglévő OHIP-14 timepoint-logikával összhangban.
-- A doménenkénti 0–100 pontszámokat (answers) és a számolt összegzőket (scores,
-- composite_score) tároljuk; a védett kérdés-/opció-szöveget NEM.

CREATE TABLE IF NOT EXISTS pro_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  episode_id UUID,
  instrument VARCHAR(32) NOT NULL,                 -- pl. 'UWQOL'
  timepoint VARCHAR(4) NOT NULL,                   -- T0..T3
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,       -- domén-kulcs → 0..100
  scores JSONB NOT NULL DEFAULT '{}'::jsonb,        -- alskálák / kompozit
  composite_score NUMERIC,                          -- kényelmi mező az elemzéshez
  completed_by_patient BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pro_responses_timepoint_check CHECK (timepoint IN ('T0', 'T1', 'T2', 'T3')),
  CONSTRAINT pro_responses_unique UNIQUE (patient_id, episode_id, instrument, timepoint)
);

CREATE INDEX IF NOT EXISTS idx_pro_responses_patient_instrument
  ON pro_responses (patient_id, instrument, timepoint);

COMMIT;

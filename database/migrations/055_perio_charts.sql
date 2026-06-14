BEGIN;

-- Parodontális státusz (perio chart) — opcionális, a felhasználó által bekapcsolható
-- felvétel a beteg fogazatáról. Egy aktuális chart per beteg (upsert); a teljes
-- mérés JSONB-ben, mert mindig egészként olvassuk/írjuk (fogonként 6 mérőpont
-- × több metrika ~ sok érték; külön sorokra bontás itt nem hozna előnyt).
--
-- data alak:
-- {
--   "teeth": {
--     "16": {
--       "buccal":  { "pd":[3,2,3], "rec":[0,0,1], "bop":[false,true,false], "plaque":[false,false,true] },
--       "oral":    { "pd":[3,3,2], "rec":[0,1,0], "bop":[false,false,false], "plaque":[true,false,false] },
--       "mobility": 0,
--       "furcation": 0
--     }
--   }
-- }
CREATE TABLE IF NOT EXISTS perio_charts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Egy aktuális felvétel per beteg (upsert). A felvétel-történet a 3. fázis
  -- bővítése lehet (ekkor a UNIQUE feloldandó és recorded_at szerint sorozat).
  CONSTRAINT perio_charts_one_per_patient UNIQUE (patient_id)
);

CREATE INDEX IF NOT EXISTS idx_perio_charts_patient ON perio_charts (patient_id);

COMMIT;

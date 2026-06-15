BEGIN;

-- A fogazati státusz időbeli alakulása: datált pillanatfelvételek a beteg
-- odontogramjáról, hogy a "kiindulási státusz → kezelési terv → státusz egy adott
-- napon" idővonal visszanézhető legyen.
--
--   * kind = 'baseline' : a kiindulási (felvételkori) állapot. Betegenként egy.
--   * kind = 'status'   : egy datált státusz (pl. amikor egy kezelés elkészült és
--                         ezzel változott az adott fog alapállapota).
--
-- A "kezelési terv" réteg NEM itt tárolódik: a tooth_treatments nyitott
-- (még nem completed) igényeiből származtatott overlay adja.
--
-- A fogak JSONB szerkezete azonos a patient_dental_status.meglevo_fogak
-- alakjával: { "16": { "base": "filled", "caries": false, ... }, ... }.
CREATE TABLE IF NOT EXISTS dental_status_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('baseline', 'status')),
  effective_date DATE NOT NULL,
  fogak JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT,
  source_tooth_treatment_id UUID NULL REFERENCES tooth_treatments(id) ON DELETE SET NULL,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Betegenként legfeljebb egy kiindulási felvétel.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dental_status_snapshots_one_baseline
  ON dental_status_snapshots (patient_id)
  WHERE kind = 'baseline';

CREATE INDEX IF NOT EXISTS idx_dental_status_snapshots_patient
  ON dental_status_snapshots (patient_id, effective_date);

COMMIT;

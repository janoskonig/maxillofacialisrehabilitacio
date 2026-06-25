BEGIN;

-- Adat-teljességi kapu felülbírálások naplója.
--
-- A kötelező klinikai minimum (8 mező + OP-röntgen) hiányában bizonyos klinikai
-- mérföldkövek (jelenleg: új epizód indítása) blokkolnak. A kezelőorvos / admin
-- indokkal felülbírálhatja a kaput — minden ilyen felülbírálást ide naplózunk,
-- hogy később számon kérhető legyen, ki és miért indított hiányos beteget.

CREATE TABLE IF NOT EXISTS completeness_gate_override (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  -- Melyik kapun történt a felülbírálás (pl. 'new_episode').
  gate TEXT NOT NULL,
  -- Ki bírálta felül (a felülbírálásra jogosult kezelőorvos / admin).
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  missing_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_completeness_gate_override_patient
  ON completeness_gate_override (patient_id, created_at DESC);

COMMIT;

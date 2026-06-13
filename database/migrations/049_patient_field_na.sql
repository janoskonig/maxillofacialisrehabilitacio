BEGIN;

-- N/A ("nem értelmezhető / nem ismert / nem mérték fel") mezőjelölés.
--
-- A statisztikai feldolgozhatósághoz külön kell tudni választani a VALÓDI hiányt
-- attól, amikor egy (feltételes kutatási) mező az adott betegre nem értelmezhető
-- vagy nem ismert. Egy mező akkor "rendezett" az adat-teljességi logikában, ha
-- VAGY ki van töltve, VAGY itt explicit N/A-ként meg van jelölve.
--
-- Additív / nem törő: nem kell az egyes oszlopok enum/CHECK constraintjeit
-- bővíteni. Csak a feltételes kutatási mezőkre alkalmazzuk (a klinikai minimum
-- mezői — név, TAJ, email stb. — nem lehetnek N/A).

CREATE TABLE IF NOT EXISTS patient_field_na (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  reason TEXT,
  set_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT patient_field_na_unique UNIQUE (patient_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_patient_field_na_patient
  ON patient_field_na (patient_id);

COMMIT;

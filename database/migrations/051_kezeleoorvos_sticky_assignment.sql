-- Kezelőorvos: kézi, „ragadós" elköteleződés a beteg szintjén.
--
-- Háttér: a `patients.kezeleoorvos_user_id`-t eddig a recompute (lib/recompute-
-- kezeleoorvos.ts) automatikusan számolta az aktív epizód provideréből / a
-- legközelebbi időpontból, és minden eseménynél felülírta. Ez nem jelentett
-- elköteleződést → delegált beteget nehéz volt számon kérni.
--
-- Innentől a kezelőorvos lehet KÉZZEL rögzített, és ha az, a recompute nem
-- írja felül. Ennek a jelzője az `assigned_at` (nem null = kézi elköteleződés).

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS kezeleoorvos_assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kezeleoorvos_assigned_by UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN patients.kezeleoorvos_assigned_at IS
  'Kézi kezelőorvos-hozzárendelés időpontja. NEM NULL → a recompute nem írja felül (ragadós elköteleződés). NULL → seedelhető automatikusan.';
COMMENT ON COLUMN patients.kezeleoorvos_assigned_by IS
  'Ki rendelte hozzá kézzel a kezelőorvost (users.id). NULL, ha a befagyasztott migrált értékről van szó vagy a hozzárendelő user törlődött.';

-- Befagyasztás: akinek MOST van számolt kezelőorvosa, annak ez lesz a kezdeti
-- kézi hozzárendelése → azonnal megszűnik a drift, senki nem veszti el az
-- orvosát. assigned_by NULL = rendszer általi migrált érték (nem személyhez kötött).
UPDATE patients
   SET kezeleoorvos_assigned_at = COALESCE(updated_at, created_at, NOW())
 WHERE kezeleoorvos_user_id IS NOT NULL
   AND kezeleoorvos_assigned_at IS NULL;

-- Munkalista-lekérdezésekhez: „adott orvos delegált betegei".
CREATE INDEX IF NOT EXISTS idx_patients_kezeleoorvos_assigned
  ON patients (kezeleoorvos_user_id)
  WHERE kezeleoorvos_user_id IS NOT NULL;

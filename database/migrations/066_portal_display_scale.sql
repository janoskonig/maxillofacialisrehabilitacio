BEGIN;

-- Betegportál „kényelmi mód” (betűméret / érintési célok) beállítás.
--
-- Az idős, kevésbé gyakorlott betegeknek szánt megjelenítési fokozat
-- (normal / nagy / extra) szerver-oldalon él, hogy eszközváltáskor is
-- kövesse a beteget. Nem klinikai adat: az írása a 062-es skip-flaggel
-- történik, hogy ne bumpolja az optimista zár updated_at tokenjét.

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS portal_display_scale TEXT NOT NULL DEFAULT 'normal';

ALTER TABLE patients
  DROP CONSTRAINT IF EXISTS patients_portal_display_scale_check;

ALTER TABLE patients
  ADD CONSTRAINT patients_portal_display_scale_check
  CHECK (portal_display_scale IN ('normal', 'nagy', 'extra'));

COMMIT;

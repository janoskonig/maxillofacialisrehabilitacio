-- 117: Beteg inaktiválása (nem célközönség, máshová irányítva stb.).
--
-- Egy beteg rekordja nem törlődik, csak „inaktív" lesz:
--   • a beteglistán alapból nem látszik (külön „Inaktív" szűrővel elérhető),
--   • kimarad a munkalistákból, a dashboard/stádium nézetekből,
--   • nem kap automatikus emlékeztetőt / nudge-ot (OHIP-14, consent,
--     önkitöltés, hiányzó adat, recall), és nem kerül a kutatási exportba.
-- A karton közvetlen linkkel továbbra is megnyitható, és bármikor
-- újraaktiválható. Az elhunyt betegeket továbbra is a `halal_datum` jelöli.
--
-- Az olvasó oldal oszlop-toleráns (`to_jsonb(p) ->> 'inaktivalva_at'`),
-- így a deploy megelőzheti ezt a migrációt.

BEGIN;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS inaktivalva_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inaktivalas_oka VARCHAR(40),
  ADD COLUMN IF NOT EXISTS inaktivalas_megjegyzes TEXT,
  ADD COLUMN IF NOT EXISTS inaktivalta_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_inaktivalas_oka_check;
ALTER TABLE patients ADD CONSTRAINT patients_inaktivalas_oka_check CHECK (
  inaktivalas_oka IS NULL
  OR inaktivalas_oka IN ('nem_celcsoport', 'mashova_iranyitva', 'beteg_visszalepett', 'duplikatum', 'egyeb')
);

-- Inaktív betegnek mindig van oka; aktívnak nincs.
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_inaktivalas_konzisztens;
ALTER TABLE patients ADD CONSTRAINT patients_inaktivalas_konzisztens CHECK (
  (inaktivalva_at IS NULL AND inaktivalas_oka IS NULL)
  OR (inaktivalva_at IS NOT NULL AND inaktivalas_oka IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_patients_inaktivalva_at
  ON patients (inaktivalva_at) WHERE inaktivalva_at IS NOT NULL;

COMMENT ON COLUMN patients.inaktivalva_at IS
  'Inaktiválás időpontja; NULL = aktív beteg. Inaktív beteg kimarad a listákból és az automatikus emlékeztetőkből (lib/patient-inactivation.ts).';
COMMENT ON COLUMN patients.inaktivalas_oka IS
  'nem_celcsoport | mashova_iranyitva | beteg_visszalepett | duplikatum | egyeb';

COMMIT;

-- 079 — Protetikai szerepek a fog-kezelési katalógusban
--
-- A kezelési terv eddig semmit nem vetített az odontogramra, mert a protetikai terv
-- állcsont-szintű (`patient_treatment_plans.kezelesi_terv_felso/_also`), fogszám nincs
-- benne. A fog-szintű lánc viszont pontosan ezt tudja:
--   tooth_treatments → TREATMENT_OUTCOME_RULES → projectFogakWithTreatments →
--   „Kezelés utáni vetítés" idősík.
-- Hiányzott hozzá, hogy a protetikai szerepek felvehető kódok legyenek. Ez a
-- migráció ezt a rést zárja — új tábla és új tervezési entitás nélkül.
--
-- Futtatás: npm run migrate
--   (vagy: node scripts/run-all-migrations.js 079_protetikai_szerepek.sql)
--
-- HÁZIREND, amiért ez a fájl így néz ki:
--
-- 1) `IF EXISTS` táblalét-guard. A `tooth_treatment_catalog` NEM tracked migrációban
--    jön létre, hanem a `database/legacy/migration_tooth_treatments.sql`-ben. Guard
--    nélkül ez a migráció minden olyan környezetben elszállna (friss dev DB, CI),
--    ahol a legacy script nem futott. Ugyanezt teszi a 007-es migráció is.
--
-- 2) Új kódokra `DO NOTHING`, nem `DO UPDATE`. A katalógus admin felületről
--    szerkeszthető (components/admin/ToothTreatmentCatalogEditor.tsx), és egy
--    `DO UPDATE SET label_hu` felülírná a kézzel beállított címkéket. Idempotens
--    marad: ismételt futtatás nem ír semmit.
--
-- 3) A `hid_pillerkezeles` átcímkézése FELTÉTELES: csak akkor, ha az érték még a
--    seedelt 'Híd pillerkezelés'. Az „Horgonykorona (hídpillér)" a klinikailag
--    pontos név, de ha valaki már átírta az adminban, azt nem bántjuk.
--
-- 2026-08-15

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tooth_treatment_catalog'
  ) THEN

    -- Új protetikai szerepek. A `sort_order` a meglévő 9 kód (1–9) után folytatódik.
    -- A kódok illeszkednek a tábla `code ~ '^[a-z0-9_]+$'` CHECK-jéhez.
    INSERT INTO tooth_treatment_catalog (code, label_hu, sort_order) VALUES
      ('hezagfog',             'Hézagfog (hídtest)',                10),
      ('kapocstarto_korona',   'Kapocstartó korona frézelt vállal', 11),
      ('kapocstarto_tamfog',   'Kapocstartó támfog',                12),
      ('rejtett_elhorgonyzas', 'Rejtett elhorgonyzási elem',        13),
      ('mufog',                'Kivehető pótlás műfoga',            14)
    ON CONFLICT (code) DO NOTHING;

    -- Meglévő kód pontosabb néven — csak érintetlen (seedelt) címke esetén.
    UPDATE tooth_treatment_catalog
       SET label_hu = 'Horgonykorona (hídpillér)'
     WHERE code = 'hid_pillerkezeles'
       AND label_hu = 'Híd pillerkezelés';

  END IF;
END $$;

COMMIT;

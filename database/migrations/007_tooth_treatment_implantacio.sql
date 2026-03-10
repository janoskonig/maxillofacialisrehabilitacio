-- Migration: Add Implantáció to tooth_treatment_catalog
-- Fogak helyére implantáció lehetőség a tömés, gyökérkezelés, húzás mellett.
-- Run with: npm run migrate  (or node scripts/run-all-migrations.js 007_tooth_treatment_implantacio.sql)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tooth_treatment_catalog') THEN
    INSERT INTO tooth_treatment_catalog (code, label_hu, sort_order)
    VALUES ('implantacio', 'Implantáció', 4)
    ON CONFLICT (code) DO UPDATE SET label_hu = EXCLUDED.label_hu, sort_order = EXCLUDED.sort_order;

    UPDATE tooth_treatment_catalog SET sort_order = 5 WHERE code = 'korona';
    UPDATE tooth_treatment_catalog SET sort_order = 6 WHERE code = 'csiszolas';
    UPDATE tooth_treatment_catalog SET sort_order = 7 WHERE code = 'hid_pillerkezeles';
    UPDATE tooth_treatment_catalog SET sort_order = 8 WHERE code = 'devitalizalas';
    UPDATE tooth_treatment_catalog SET sort_order = 9 WHERE code = 'csonk_felepites';
  END IF;
END $$;

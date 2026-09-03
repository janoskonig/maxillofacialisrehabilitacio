BEGIN;

-- 095: Paletta-szókincs igazítás a praxis nyelvéhez + hiányzó generikus fázisok.
--
-- A felhasználó „fogelőkészítés"-t mond (a sablon-katalógus is így hívja), a
-- 091 „Csonkpreparálás"-ként vette fel — a címke mindkettőt hordozza, a
-- keresés mindkét szóra talál. Új generikus elemek a praxis meglévő sablon-
-- fázisaiból: lenyomat gyári / egyéni kanállal, primerpróba és gyűjtőlenyomat.
-- Idempotens.

UPDATE work_phase_catalog
SET label_hu = 'Fogelőkészítés (csonkpreparálás)', updated_at = now()
WHERE work_phase_code = 'gen_csonkpreparalas' AND label_hu = 'Csonkpreparálás';

INSERT INTO work_phase_catalog
  (work_phase_code, label_hu, label_en, is_active, palette_order, default_duration_minutes, default_pool)
VALUES
  ('gen_lenyomat_gyari_kanallal',     'Lenyomat gyári kanállal',        'Impression with stock tray',   true, 72, 30, 'work'),
  ('gen_lenyomat_egyeni_kanallal',    'Lenyomat egyéni kanállal',       'Impression with custom tray',  true, 74, 30, 'work'),
  ('gen_primerproba_gyujtolenyomat',  'Primerpróba és gyűjtőlenyomat',  'Primary try-in and pick-up impression', true, 115, 30, 'work')
ON CONFLICT (work_phase_code) DO UPDATE SET
  palette_order = EXCLUDED.palette_order,
  default_duration_minutes = EXCLUDED.default_duration_minutes,
  default_pool = EXCLUDED.default_pool,
  is_active = true,
  updated_at = now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'step_catalog'
  ) THEN
    INSERT INTO step_catalog (step_code, label_hu, label_en, is_active, updated_at)
    SELECT work_phase_code, label_hu, label_en, is_active, now()
    FROM work_phase_catalog
    WHERE work_phase_code IN ('gen_lenyomat_gyari_kanallal', 'gen_lenyomat_egyeni_kanallal', 'gen_primerproba_gyujtolenyomat')
    ON CONFLICT (step_code) DO NOTHING;
    UPDATE step_catalog SET label_hu = 'Fogelőkészítés (csonkpreparálás)', updated_at = now()
    WHERE step_code = 'gen_csonkpreparalas' AND label_hu = 'Csonkpreparálás';
  END IF;
END $$;

COMMIT;

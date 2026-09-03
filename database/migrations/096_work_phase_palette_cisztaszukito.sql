BEGIN;

-- 096: „Cisztaszűkítős lenyomat" generikus fázis a palettára (felhasználói kérés).
-- A lenyomat-blokkba illeszkedik (gyári/egyéni kanál után, a lenyomati fejek
-- sínezése előtt). Idempotens.

INSERT INTO work_phase_catalog
  (work_phase_code, label_hu, label_en, is_active, palette_order, default_duration_minutes, default_pool)
VALUES
  ('gen_cisztaszukitos_lenyomat', 'Cisztaszűkítős lenyomat', 'Impression for cyst-reduction appliance', true, 76, 30, 'work')
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
    WHERE work_phase_code = 'gen_cisztaszukitos_lenyomat'
    ON CONFLICT (step_code) DO NOTHING;
  END IF;
END $$;

COMMIT;

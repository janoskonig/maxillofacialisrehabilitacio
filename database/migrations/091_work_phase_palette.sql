BEGIN;

-- 091: Generikus munkafázis-paletta a vizit-alapú kezelési tervhez.
--
-- A terv-fül bal hasábja („Kezelések") általános, sablonfüggetlen
-- munkafázisokat kínál (csonkpreparálás, precíziós-szituációs lenyomatvétel,
-- átadás, …), amelyeket a jobb oldali alkalmakba („vizitekbe") lehet pakolni.
-- A work_phase_catalog eddig csak sablon-specifikus, előtagos kódokat
-- tartalmazott (pl. fedolemezes_atadas) — a UI ezekből nem tud tiszta, rövid
-- listát adni (11× „Átadás").
--
-- Új oszlopok (nullable — a régi sorokat nem érinti):
--   • palette_order            : a bal hasáb sorrendje; NULL = nem paletta-elem
--                                (csak keresésben érhető el)
--   • default_duration_minutes : alapértelmezett időtartam hozzáadáskor
--   • default_pool             : alapértelmezett slot-pool (consult | work | control)
--
-- Kód-konvenció: gen_* előtag. Az átadás kódja `gen_atadas` — szándékosan
-- illeszkedik a stádium-motor mintáira (isDeliveryStepCode: endsWith('_atadas');
-- stage-reducer: LIKE '%_atadas'). A sebészi sablon átadása ezért `_atadasa`
-- végű, hogy NE számítson protetikai átadásnak.
--
-- Idempotens: ADD COLUMN IF NOT EXISTS + ON CONFLICT (a címkét meglévő sornál
-- nem írja felül, csak a paletta-mezőket).

ALTER TABLE work_phase_catalog
  ADD COLUMN IF NOT EXISTS palette_order INT,
  ADD COLUMN IF NOT EXISTS default_duration_minutes INT,
  ADD COLUMN IF NOT EXISTS default_pool VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_phase_catalog_default_pool_check'
      AND conrelid = 'work_phase_catalog'::regclass
  ) THEN
    ALTER TABLE work_phase_catalog
      ADD CONSTRAINT work_phase_catalog_default_pool_check
      CHECK (default_pool IS NULL OR default_pool IN ('consult', 'work', 'control'));
  END IF;
END $$;

COMMENT ON COLUMN work_phase_catalog.palette_order IS
  'A kezelési terv bal hasábjának (generikus paletta) sorrendje; NULL = nem paletta-elem, csak keresésből érhető el.';
COMMENT ON COLUMN work_phase_catalog.default_duration_minutes IS
  'Alapértelmezett időtartam percben, amikor a fázist a palettáról adják a tervhez.';
COMMENT ON COLUMN work_phase_catalog.default_pool IS
  'Alapértelmezett slot-pool a palettáról hozzáadott fázishoz (consult | work | control).';

INSERT INTO work_phase_catalog
  (work_phase_code, label_hu, label_en, is_active, palette_order, default_duration_minutes, default_pool)
VALUES
  ('gen_konzultacio',                     'Konzultáció',                          'Consultation',                       true, 10,  30, 'consult'),
  ('gen_diagnosztika_tervezes',           'Diagnosztika, tervezés',               'Diagnostics & planning',             true, 20,  30, 'work'),
  ('gen_anatomiai_lenyomat',              'Anatómiai lenyomat',                   'Anatomical impression',              true, 30,  30, 'work'),
  ('gen_egyeni_kanal_funkcios_lenyomat',  'Egyéni kanál, funkciós lenyomat',      'Custom tray, functional impression', true, 40,  45, 'work'),
  ('gen_csonkpreparalas',                 'Csonkpreparálás',                      'Tooth preparation',                  true, 50,  60, 'work'),
  ('gen_precizios_szituacios_lenyomat',   'Precíziós-szituációs lenyomatvétel',   'Precision / situational impression', true, 60,  45, 'work'),
  ('gen_lenyomatvetel',                   'Lenyomatvétel',                        'Impression',                         true, 70,  30, 'work'),
  ('gen_lenyomati_fejek_sinezese',        'Lenyomati fejek sínezése',             'Splinting of impression copings',    true, 80,  30, 'work'),
  ('gen_harapasregisztracio',             'Harapásregisztráció',                  'Bite registration',                  true, 90,  30, 'work'),
  ('gen_vazproba',                        'Vázpróba',                             'Framework try-in',                   true, 100, 30, 'work'),
  ('gen_femlemezproba',                   'Fémlemezpróba',                        'Metal base try-in',                  true, 110, 30, 'work'),
  ('gen_mattproba',                       'Mattpróba',                            'Bisque try-in',                      true, 120, 30, 'work'),
  ('gen_fogproba',                        'Fogpróba',                             'Tooth try-in',                       true, 130, 30, 'work'),
  ('gen_gyujtolenyomat',                  'Gyűjtőlenyomat',                       'Pick-up impression',                 true, 140, 30, 'work'),
  ('gen_ideiglenes_potlas',               'Ideiglenes pótlás',                    'Provisional restoration',            true, 150, 45, 'work'),
  ('gen_sebeszi_sablon_atadasa',          'Sebészi sablon átadása',               'Surgical guide delivery',            true, 160, 30, 'work'),
  ('gen_atadas',                          'Átadás',                               'Delivery',                           true, 170, 30, 'work'),
  ('gen_alabeleles',                      'Alábélelés',                           'Relining',                           true, 180, 30, 'work'),
  ('gen_javitas_korrekcio',               'Javítás, korrekció',                   'Repair / adjustment',                true, 190, 30, 'work'),
  ('gen_kontroll',                        'Kontroll',                             'Check-up',                           true, 200, 15, 'work')
ON CONFLICT (work_phase_code) DO UPDATE SET
  palette_order = EXCLUDED.palette_order,
  default_duration_minutes = EXCLUDED.default_duration_minutes,
  default_pool = EXCLUDED.default_pool,
  is_active = true,
  updated_at = now();

-- Legacy tükör (step_catalog) — a PATCH /api/step-catalog/:code is ide szinkronizál.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'step_catalog'
  ) THEN
    INSERT INTO step_catalog (step_code, label_hu, label_en, is_active, updated_at)
    SELECT work_phase_code, label_hu, label_en, is_active, now()
    FROM work_phase_catalog
    WHERE work_phase_code LIKE 'gen\_%'
    ON CONFLICT (step_code) DO NOTHING;
  END IF;
END $$;

COMMIT;

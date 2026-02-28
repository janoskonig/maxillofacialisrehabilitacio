-- Migration: Kezeléstípus-specifikus pathway-ok (step_catalog + care_pathways)
-- Run after: migration_reason_treatment_type.sql, migration_pathway_trauma_veleszületett.sql, migration_step_catalog.sql
-- Forrás: database/treatment_type_steps_spec.csv
-- step_code konvenció: {db_code}_{slug}

BEGIN;

-- 1) Partial unique index: legfeljebb 1 pathway / treatment_type_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_care_pathways_treatment_type_unique
  ON care_pathways (treatment_type_id) WHERE treatment_type_id IS NOT NULL;

-- 2) step_catalog — minden egyedi step_code → label_hu (CSV-ből, user code → DB code mapping)
INSERT INTO step_catalog (step_code, label_hu) VALUES
  ('teljes_lemez_anat_lenyomat', 'Anatómiai lenyomat'),
  ('teljes_lemez_egyeni_kanal_befunkcionalasa', 'Egyéni kanál befunkcionálása'),
  ('teljes_lemez_funkcios_lenyomat', 'Funkciós lenyomat'),
  ('teljes_lemez_harapasregisztracio', 'Harapásregisztráció'),
  ('teljes_lemez_fogproba', 'Fogpróba'),
  ('teljes_lemez_atadas', 'Átadás'),
  ('teljes_lemez_kontroll_1', 'Kontroll 1'),
  ('teljes_lemez_kontroll_2', 'Kontroll 2'),
  ('teljes_lemez_kontroll_3', 'Kontroll 3'),
  ('kapocselhorgonyzasu_reszleges_lenyomat_gyari_kanallal', 'Lenyomat gyári kanállal'),
  ('kapocselhorgonyzasu_reszleges_lenyomat_egyeni_kanallal', 'Lenyomat egyéni kanállal'),
  ('kapocselhorgonyzasu_reszleges_femlemezproba', 'Fémlemezpróba'),
  ('kapocselhorgonyzasu_reszleges_fogproba', 'Fogpróba'),
  ('kapocselhorgonyzasu_reszleges_atadas', 'Átadás'),
  ('kapocselhorgonyzasu_reszleges_kontroll_1', 'Kontroll 1'),
  ('kapocselhorgonyzasu_reszleges_kontroll_2', 'Kontroll 2'),
  ('kapocselhorgonyzasu_reszleges_kontroll_3', 'Kontroll 3'),
  ('reszleges_akrilat_lenyomat_gyari_kanallal', 'Lenyomat gyári kanállal'),
  ('reszleges_akrilat_harapasregisztracio', 'Harapásregisztráció'),
  ('reszleges_akrilat_fogproba', 'Fogpróba'),
  ('reszleges_akrilat_atadas', 'Átadás'),
  ('reszleges_akrilat_kontroll_1', 'Kontroll 1'),
  ('reszleges_akrilat_kontroll_2', 'Kontroll 2'),
  ('reszleges_akrilat_kontroll_3', 'Kontroll 3'),
  ('rogzitett_fogakon_fogelokeszites', 'Fogelőkészítés'),
  ('rogzitett_fogakon_precizios_szituacios_lenyomat', 'Precíziós-szituációs lenyomat'),
  ('rogzitett_fogakon_vazproba', 'Vázpróba'),
  ('rogzitett_fogakon_mattproba', 'Mattpróba'),
  ('rogzitett_fogakon_atadas', 'Átadás'),
  ('rogzitett_fogakon_kontroll_1', 'Kontroll 1'),
  ('rogzitett_fogakon_kontroll_2', 'Kontroll 2'),
  ('rogzitett_fogakon_kontroll_3', 'Kontroll 3'),
  ('csavarozott_implant_lenyomati_fejek_sinezese', 'Lenyomati fejek sínezése'),
  ('csavarozott_implant_lenyomatvetel', 'Lenyomatvétel'),
  ('csavarozott_implant_harapasregisztracio', 'Harapásregisztráció'),
  ('csavarozott_implant_vazproba', 'Vázpróba'),
  ('csavarozott_implant_mattproba', 'Mattpróba'),
  ('csavarozott_implant_atadas', 'Átadás'),
  ('csavarozott_implant_kontroll_1', 'Kontroll 1'),
  ('csavarozott_implant_kontroll_2', 'Kontroll 2'),
  ('csavarozott_implant_kontroll_3', 'Kontroll 3'),
  ('cementezett_implant_lenyomati_fejek_sinezese', 'Lenyomati fejek sínezése'),
  ('cementezett_implant_lenyomatvetel', 'Lenyomatvétel'),
  ('cementezett_implant_harapasregisztracio', 'Harapásregisztráció'),
  ('cementezett_implant_vazproba', 'Vázpróba'),
  ('cementezett_implant_mattproba', 'Mattpróba'),
  ('cementezett_implant_atadas', 'Átadás'),
  ('cementezett_implant_kontroll_1', 'Kontroll 1'),
  ('cementezett_implant_kontroll_2', 'Kontroll 2'),
  ('cementezett_implant_kontroll_3', 'Kontroll 3'),
  ('sebeszi_sablon_lenyomat_gyari_kanallal', 'Lenyomat gyári kanállal'),
  ('sebeszi_sablon_harapasregisztracio', 'Harapásregisztráció'),
  ('sebeszi_sablon_fogproba', 'Fogpróba'),
  ('sebeszi_sablon_atadas', 'Átadás'),
  ('kombinalt_kapoccsal_fogelokeszites', 'Fogelőkészítés'),
  ('kombinalt_kapoccsal_precizios_szituacios_lenyomat', 'Precíziós-szituációs lenyomat'),
  ('kombinalt_kapoccsal_vazproba', 'Vázpróba'),
  ('kombinalt_kapoccsal_mattproba_es_gyujtolenyomat', 'Mattpróba és gyűjtőlenyomat'),
  ('kombinalt_kapoccsal_femlemezproba', 'Fémlemezpróba'),
  ('kombinalt_kapoccsal_harapasregisztracio', 'Harapásregisztráció'),
  ('kombinalt_kapoccsal_fogproba', 'Fogpróba'),
  ('kombinalt_kapoccsal_atadas', 'Átadás'),
  ('kombinalt_kapoccsal_kontroll_1', 'Kontroll 1'),
  ('kombinalt_kapoccsal_kontroll_2', 'Kontroll 2'),
  ('kombinalt_kapoccsal_kontroll_3', 'Kontroll 3'),
  ('kombinalt_rejtett_fogelokeszites', 'Fogelőkészítés'),
  ('kombinalt_rejtett_precizios_szituacios_lenyomat', 'Precíziós-szituációs lenyomat'),
  ('kombinalt_rejtett_vazproba', 'Vázpróba'),
  ('kombinalt_rejtett_mattproba_es_gyujtolenyomat', 'Mattpróba és gyűjtőlenyomat'),
  ('kombinalt_rejtett_femlemezproba', 'Fémlemezpróba'),
  ('kombinalt_rejtett_harapasregisztracio', 'Harapásregisztráció'),
  ('kombinalt_rejtett_fogproba', 'Fogpróba'),
  ('kombinalt_rejtett_atadas', 'Átadás'),
  ('kombinalt_rejtett_kontroll_1', 'Kontroll 1'),
  ('kombinalt_rejtett_kontroll_2', 'Kontroll 2'),
  ('kombinalt_rejtett_kontroll_3', 'Kontroll 3'),
  ('fedolemezes_fogelokeszites', 'Fogelőkészítés'),
  ('fedolemezes_precizios_szituacios_lenyomat', 'Precíziós-szituációs lenyomat'),
  ('fedolemezes_harapasregisztracio', 'Harapásregisztráció'),
  ('fedolemezes_harapasregisztracio_2', 'Harapásregisztráció'),
  ('fedolemezes_primerproba_es_gyujtolenyomat', 'Primerpróba és gyűjtőlenyomat'),
  ('fedolemezes_fogproba', 'Fogpróba'),
  ('fedolemezes_atadas', 'Átadás'),
  ('fedolemezes_kontroll_1', 'Kontroll 1'),
  ('fedolemezes_kontroll_2', 'Kontroll 2'),
  ('fedolemezes_kontroll_3', 'Kontroll 3'),
  ('zarolemez_lenyomatvetel', 'Lenyomatvétel'),
  ('zarolemez_atadas', 'Átadás')
ON CONFLICT (step_code) DO UPDATE SET
  label_hu = EXCLUDED.label_hu,
  updated_at = now();

-- 3) care_pathways — minden treatment_type-hoz (INSERT via SELECT, UPSERT)
-- default_days_offset: work 7, control 90/180/365; Átadás requires_precommit: true

INSERT INTO care_pathways (name, reason, treatment_type_id, steps_json, version, priority)
SELECT tt.label_hu, NULL, tt.id,
  '[
    {"step_code": "teljes_lemez_anat_lenyomat", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "teljes_lemez_egyeni_kanal_befunkcionalasa", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "teljes_lemez_funkcios_lenyomat", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "teljes_lemez_harapasregisztracio", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "teljes_lemez_fogproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "teljes_lemez_atadas", "pool": "work", "duration_minutes": 30, "default_days_offset": 7, "requires_precommit": true},
    {"step_code": "teljes_lemez_kontroll_1", "pool": "control", "duration_minutes": 15, "default_days_offset": 90},
    {"step_code": "teljes_lemez_kontroll_2", "pool": "control", "duration_minutes": 15, "default_days_offset": 180},
    {"step_code": "teljes_lemez_kontroll_3", "pool": "control", "duration_minutes": 15, "default_days_offset": 365}
  ]'::jsonb,
  1, 0
FROM treatment_types tt WHERE tt.code = 'teljes_lemez'
ON CONFLICT (treatment_type_id) WHERE (treatment_type_id IS NOT NULL)
DO UPDATE SET name = EXCLUDED.name, steps_json = EXCLUDED.steps_json, updated_at = now();

INSERT INTO care_pathways (name, reason, treatment_type_id, steps_json, version, priority)
SELECT tt.label_hu, NULL, tt.id,
  '[
    {"step_code": "kapocselhorgonyzasu_reszleges_lenyomat_gyari_kanallal", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kapocselhorgonyzasu_reszleges_lenyomat_egyeni_kanallal", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kapocselhorgonyzasu_reszleges_femlemezproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kapocselhorgonyzasu_reszleges_fogproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kapocselhorgonyzasu_reszleges_atadas", "pool": "work", "duration_minutes": 30, "default_days_offset": 7, "requires_precommit": true},
    {"step_code": "kapocselhorgonyzasu_reszleges_kontroll_1", "pool": "control", "duration_minutes": 15, "default_days_offset": 90},
    {"step_code": "kapocselhorgonyzasu_reszleges_kontroll_2", "pool": "control", "duration_minutes": 15, "default_days_offset": 180},
    {"step_code": "kapocselhorgonyzasu_reszleges_kontroll_3", "pool": "control", "duration_minutes": 15, "default_days_offset": 365}
  ]'::jsonb,
  1, 0
FROM treatment_types tt WHERE tt.code = 'kapocselhorgonyzasu_reszleges'
ON CONFLICT (treatment_type_id) WHERE (treatment_type_id IS NOT NULL)
DO UPDATE SET name = EXCLUDED.name, steps_json = EXCLUDED.steps_json, updated_at = now();

INSERT INTO care_pathways (name, reason, treatment_type_id, steps_json, version, priority)
SELECT tt.label_hu, NULL, tt.id,
  '[
    {"step_code": "reszleges_akrilat_lenyomat_gyari_kanallal", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "reszleges_akrilat_harapasregisztracio", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "reszleges_akrilat_fogproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "reszleges_akrilat_atadas", "pool": "work", "duration_minutes": 30, "default_days_offset": 7, "requires_precommit": true},
    {"step_code": "reszleges_akrilat_kontroll_1", "pool": "control", "duration_minutes": 15, "default_days_offset": 90},
    {"step_code": "reszleges_akrilat_kontroll_2", "pool": "control", "duration_minutes": 15, "default_days_offset": 180},
    {"step_code": "reszleges_akrilat_kontroll_3", "pool": "control", "duration_minutes": 15, "default_days_offset": 365}
  ]'::jsonb,
  1, 0
FROM treatment_types tt WHERE tt.code = 'reszleges_akrilat'
ON CONFLICT (treatment_type_id) WHERE (treatment_type_id IS NOT NULL)
DO UPDATE SET name = EXCLUDED.name, steps_json = EXCLUDED.steps_json, updated_at = now();

INSERT INTO care_pathways (name, reason, treatment_type_id, steps_json, version, priority)
SELECT tt.label_hu, NULL, tt.id,
  '[
    {"step_code": "rogzitett_fogakon_fogelokeszites", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "rogzitett_fogakon_precizios_szituacios_lenyomat", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "rogzitett_fogakon_vazproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "rogzitett_fogakon_mattproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "rogzitett_fogakon_atadas", "pool": "work", "duration_minutes": 30, "default_days_offset": 7, "requires_precommit": true},
    {"step_code": "rogzitett_fogakon_kontroll_1", "pool": "control", "duration_minutes": 15, "default_days_offset": 90},
    {"step_code": "rogzitett_fogakon_kontroll_2", "pool": "control", "duration_minutes": 15, "default_days_offset": 180},
    {"step_code": "rogzitett_fogakon_kontroll_3", "pool": "control", "duration_minutes": 15, "default_days_offset": 365}
  ]'::jsonb,
  1, 0
FROM treatment_types tt WHERE tt.code = 'rogzitett_fogakon'
ON CONFLICT (treatment_type_id) WHERE (treatment_type_id IS NOT NULL)
DO UPDATE SET name = EXCLUDED.name, steps_json = EXCLUDED.steps_json, updated_at = now();

INSERT INTO care_pathways (name, reason, treatment_type_id, steps_json, version, priority)
SELECT tt.label_hu, NULL, tt.id,
  '[
    {"step_code": "csavarozott_implant_lenyomati_fejek_sinezese", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "csavarozott_implant_lenyomatvetel", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "csavarozott_implant_harapasregisztracio", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "csavarozott_implant_vazproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "csavarozott_implant_mattproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "csavarozott_implant_atadas", "pool": "work", "duration_minutes": 30, "default_days_offset": 7, "requires_precommit": true},
    {"step_code": "csavarozott_implant_kontroll_1", "pool": "control", "duration_minutes": 15, "default_days_offset": 90},
    {"step_code": "csavarozott_implant_kontroll_2", "pool": "control", "duration_minutes": 15, "default_days_offset": 180},
    {"step_code": "csavarozott_implant_kontroll_3", "pool": "control", "duration_minutes": 15, "default_days_offset": 365}
  ]'::jsonb,
  1, 0
FROM treatment_types tt WHERE tt.code = 'csavarozott_implant'
ON CONFLICT (treatment_type_id) WHERE (treatment_type_id IS NOT NULL)
DO UPDATE SET name = EXCLUDED.name, steps_json = EXCLUDED.steps_json, updated_at = now();

INSERT INTO care_pathways (name, reason, treatment_type_id, steps_json, version, priority)
SELECT tt.label_hu, NULL, tt.id,
  '[
    {"step_code": "cementezett_implant_lenyomati_fejek_sinezese", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "cementezett_implant_lenyomatvetel", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "cementezett_implant_harapasregisztracio", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "cementezett_implant_vazproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "cementezett_implant_mattproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "cementezett_implant_atadas", "pool": "work", "duration_minutes": 30, "default_days_offset": 7, "requires_precommit": true},
    {"step_code": "cementezett_implant_kontroll_1", "pool": "control", "duration_minutes": 15, "default_days_offset": 90},
    {"step_code": "cementezett_implant_kontroll_2", "pool": "control", "duration_minutes": 15, "default_days_offset": 180},
    {"step_code": "cementezett_implant_kontroll_3", "pool": "control", "duration_minutes": 15, "default_days_offset": 365}
  ]'::jsonb,
  1, 0
FROM treatment_types tt WHERE tt.code = 'cementezett_implant'
ON CONFLICT (treatment_type_id) WHERE (treatment_type_id IS NOT NULL)
DO UPDATE SET name = EXCLUDED.name, steps_json = EXCLUDED.steps_json, updated_at = now();

INSERT INTO care_pathways (name, reason, treatment_type_id, steps_json, version, priority)
SELECT tt.label_hu, NULL, tt.id,
  '[
    {"step_code": "sebeszi_sablon_lenyomat_gyari_kanallal", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "sebeszi_sablon_harapasregisztracio", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "sebeszi_sablon_fogproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "sebeszi_sablon_atadas", "pool": "work", "duration_minutes": 30, "default_days_offset": 7, "requires_precommit": true}
  ]'::jsonb,
  1, 0
FROM treatment_types tt WHERE tt.code = 'sebeszi_sablon'
ON CONFLICT (treatment_type_id) WHERE (treatment_type_id IS NOT NULL)
DO UPDATE SET name = EXCLUDED.name, steps_json = EXCLUDED.steps_json, updated_at = now();

INSERT INTO care_pathways (name, reason, treatment_type_id, steps_json, version, priority)
SELECT tt.label_hu, NULL, tt.id,
  '[
    {"step_code": "kombinalt_kapoccsal_fogelokeszites", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kombinalt_kapoccsal_precizios_szituacios_lenyomat", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kombinalt_kapoccsal_vazproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kombinalt_kapoccsal_mattproba_es_gyujtolenyomat", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kombinalt_kapoccsal_femlemezproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kombinalt_kapoccsal_harapasregisztracio", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kombinalt_kapoccsal_fogproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kombinalt_kapoccsal_atadas", "pool": "work", "duration_minutes": 30, "default_days_offset": 7, "requires_precommit": true},
    {"step_code": "kombinalt_kapoccsal_kontroll_1", "pool": "control", "duration_minutes": 15, "default_days_offset": 90},
    {"step_code": "kombinalt_kapoccsal_kontroll_2", "pool": "control", "duration_minutes": 15, "default_days_offset": 180},
    {"step_code": "kombinalt_kapoccsal_kontroll_3", "pool": "control", "duration_minutes": 15, "default_days_offset": 365}
  ]'::jsonb,
  1, 0
FROM treatment_types tt WHERE tt.code = 'kombinalt_kapoccsal'
ON CONFLICT (treatment_type_id) WHERE (treatment_type_id IS NOT NULL)
DO UPDATE SET name = EXCLUDED.name, steps_json = EXCLUDED.steps_json, updated_at = now();

INSERT INTO care_pathways (name, reason, treatment_type_id, steps_json, version, priority)
SELECT tt.label_hu, NULL, tt.id,
  '[
    {"step_code": "kombinalt_rejtett_fogelokeszites", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kombinalt_rejtett_precizios_szituacios_lenyomat", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kombinalt_rejtett_vazproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kombinalt_rejtett_mattproba_es_gyujtolenyomat", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kombinalt_rejtett_femlemezproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kombinalt_rejtett_harapasregisztracio", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kombinalt_rejtett_fogproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "kombinalt_rejtett_atadas", "pool": "work", "duration_minutes": 30, "default_days_offset": 7, "requires_precommit": true},
    {"step_code": "kombinalt_rejtett_kontroll_1", "pool": "control", "duration_minutes": 15, "default_days_offset": 90},
    {"step_code": "kombinalt_rejtett_kontroll_2", "pool": "control", "duration_minutes": 15, "default_days_offset": 180},
    {"step_code": "kombinalt_rejtett_kontroll_3", "pool": "control", "duration_minutes": 15, "default_days_offset": 365}
  ]'::jsonb,
  1, 0
FROM treatment_types tt WHERE tt.code = 'kombinalt_rejtett'
ON CONFLICT (treatment_type_id) WHERE (treatment_type_id IS NOT NULL)
DO UPDATE SET name = EXCLUDED.name, steps_json = EXCLUDED.steps_json, updated_at = now();

INSERT INTO care_pathways (name, reason, treatment_type_id, steps_json, version, priority)
SELECT tt.label_hu, NULL, tt.id,
  '[
    {"step_code": "fedolemezes_fogelokeszites", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "fedolemezes_precizios_szituacios_lenyomat", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "fedolemezes_harapasregisztracio", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "fedolemezes_primerproba_es_gyujtolenyomat", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "fedolemezes_harapasregisztracio_2", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "fedolemezes_fogproba", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "fedolemezes_atadas", "pool": "work", "duration_minutes": 30, "default_days_offset": 7, "requires_precommit": true},
    {"step_code": "fedolemezes_kontroll_1", "pool": "control", "duration_minutes": 15, "default_days_offset": 90},
    {"step_code": "fedolemezes_kontroll_2", "pool": "control", "duration_minutes": 15, "default_days_offset": 180},
    {"step_code": "fedolemezes_kontroll_3", "pool": "control", "duration_minutes": 15, "default_days_offset": 365}
  ]'::jsonb,
  1, 0
FROM treatment_types tt WHERE tt.code = 'fedolemezes'
ON CONFLICT (treatment_type_id) WHERE (treatment_type_id IS NOT NULL)
DO UPDATE SET name = EXCLUDED.name, steps_json = EXCLUDED.steps_json, updated_at = now();

INSERT INTO care_pathways (name, reason, treatment_type_id, steps_json, version, priority)
SELECT tt.label_hu, NULL, tt.id,
  '[
    {"step_code": "zarolemez_lenyomatvetel", "pool": "work", "duration_minutes": 30, "default_days_offset": 7},
    {"step_code": "zarolemez_atadas", "pool": "work", "duration_minutes": 30, "default_days_offset": 7, "requires_precommit": true}
  ]'::jsonb,
  1, 0
FROM treatment_types tt WHERE tt.code = 'zarolemez'
ON CONFLICT (treatment_type_id) WHERE (treatment_type_id IS NOT NULL)
DO UPDATE SET name = EXCLUDED.name, steps_json = EXCLUDED.steps_json, updated_at = now();

COMMIT;

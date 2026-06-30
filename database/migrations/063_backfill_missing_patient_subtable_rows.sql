-- 063_backfill_missing_patient_subtable_rows.sql
--
-- Néhány betegnek (patient) hiányzik a sora a normalizált al-táblákban
-- (patient_referral, patient_anamnesis, patient_dental_status,
-- patient_treatment_plans). Történetileg ez NÉMA adatvesztést okozott
-- mentéskor; ezt már mérsékli az UPSERT az
-- app/api/patients/[id]/route.ts executePatientUpdate-ben, amely a következő
-- mentésnél magától helyreáll. Ez a migráció proaktívan, defenzív jelleggel
-- pótolja a hiányzó sorokat, hogy az adatintegritás a mentéstől függetlenül
-- helyreálljon.
--
-- Minden al-táblában a patient_id a PRIMARY KEY, és az összes többi oszlop
-- NULL-olható / van alapértéke, így elég csak a patient_id-t beszúrni.
--
-- Olvasáskor ez nem változtat semmin: a patients_full VIEW LEFT JOIN-nal
-- amúgy is működik. A 2026-06-27-i helyi DB-n a hiányzó sorok száma:
--   patient_referral: 1, patient_anamnesis: 11,
--   patient_dental_status: 11, patient_treatment_plans: 11.
--
-- Idempotens: a LEFT JOIN ... IS NULL szűrő miatt ismételt futtatáskor nincs
-- mit beszúrni (a már létező sorokat kihagyja), így nem hoz létre duplikátumot.

BEGIN;

INSERT INTO patient_referral (patient_id)
SELECT p.id FROM patients p
LEFT JOIN patient_referral r ON r.patient_id = p.id
WHERE r.patient_id IS NULL;

INSERT INTO patient_anamnesis (patient_id)
SELECT p.id FROM patients p
LEFT JOIN patient_anamnesis a ON a.patient_id = p.id
WHERE a.patient_id IS NULL;

INSERT INTO patient_dental_status (patient_id)
SELECT p.id FROM patients p
LEFT JOIN patient_dental_status d ON d.patient_id = p.id
WHERE d.patient_id IS NULL;

INSERT INTO patient_treatment_plans (patient_id)
SELECT p.id FROM patients p
LEFT JOIN patient_treatment_plans t ON t.patient_id = p.id
WHERE t.patient_id IS NULL;

COMMIT;

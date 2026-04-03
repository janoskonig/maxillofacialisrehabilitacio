-- Backfill: maradék patient_stages → patient_episodes (árva episode_id) + stage_events
-- Futtatás: psql -d <db> -f database/legacy/backfill_remaining_patient_stages_to_stage_events.sql
-- Feltétel: stage_events, patient_episodes, patient_stages táblák léteznek.
--
-- 1) Árva episode_id: patient_stages-ban szerepel, de nincs patient_episodes sor → szintetikus epizód
-- 2) stage_events beszúrás, ha még nincs ugyanilyen (patient_id, episode_id, stage_code, at)

BEGIN;

-- Árva epizódok létrehozása (egy episode_id = egy sor patient_episodes-ban)
INSERT INTO patient_episodes (
  id,
  patient_id,
  reason,
  chief_complaint,
  status,
  opened_at,
  closed_at,
  created_by
)
SELECT
  d.episode_id,
  d.patient_id,
  CASE
    WHEN trim(coalesce(d.anamnesis_reason, '')) IN (
      'traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot'
    ) THEN trim(d.anamnesis_reason)
    ELSE 'onkológiai kezelés utáni állapot'
  END,
  'Migráció: régi stádium napló (árva episode_id)',
  'closed',
  d.opened_at,
  d.closed_at,
  'system'
FROM (
  SELECT
    ps.episode_id,
    ps.patient_id,
    MIN(ps.stage_date) AS opened_at,
    MAX(ps.stage_date) AS closed_at,
    MAX(a.kezelesre_erkezes_indoka) AS anamnesis_reason
  FROM patient_stages ps
  LEFT JOIN patient_anamnesis a ON a.patient_id = ps.patient_id
  WHERE NOT EXISTS (SELECT 1 FROM patient_episodes pe WHERE pe.id = ps.episode_id)
  GROUP BY ps.episode_id, ps.patient_id
) d;

-- stage_events beszúrás (deduplikáció: ne legyen dupla ugyanazzal a hármassal)
INSERT INTO stage_events (patient_id, episode_id, stage_code, at, note, created_by)
SELECT
  ps.patient_id,
  ps.episode_id,
  CASE ps.stage
    WHEN 'uj_beteg' THEN 'STAGE_0'
    WHEN 'onkologiai_kezeles_kesz' THEN 'STAGE_0'
    WHEN 'arajanlatra_var' THEN 'STAGE_2'
    WHEN 'implantacios_sebeszi_tervezesre_var' THEN 'STAGE_2'
    WHEN 'fogpotlasra_var' THEN 'STAGE_5'
    WHEN 'fogpotlas_keszul' THEN 'STAGE_5'
    WHEN 'fogpotlas_kesz' THEN 'STAGE_6'
    WHEN 'gondozas_alatt' THEN 'STAGE_7'
    ELSE 'STAGE_0'
  END,
  ps.stage_date,
  ps.notes,
  ps.created_by
FROM patient_stages ps
WHERE EXISTS (SELECT 1 FROM patient_episodes pe WHERE pe.id = ps.episode_id)
  AND NOT EXISTS (
    SELECT 1
    FROM stage_events se
    WHERE se.patient_id = ps.patient_id
      AND se.episode_id = ps.episode_id
      AND se.stage_code = (
        CASE ps.stage
          WHEN 'uj_beteg' THEN 'STAGE_0'
          WHEN 'onkologiai_kezeles_kesz' THEN 'STAGE_0'
          WHEN 'arajanlatra_var' THEN 'STAGE_2'
          WHEN 'implantacios_sebeszi_tervezesre_var' THEN 'STAGE_2'
          WHEN 'fogpotlasra_var' THEN 'STAGE_5'
          WHEN 'fogpotlas_keszul' THEN 'STAGE_5'
          WHEN 'fogpotlas_kesz' THEN 'STAGE_6'
          WHEN 'gondozas_alatt' THEN 'STAGE_7'
          ELSE 'STAGE_0'
        END
      )
      AND se.at = ps.stage_date
  );

COMMIT;

BEGIN;

-- Recall (kontroll) lépések eltávolítása a kezelési terv sablonokból.
--
-- Döntés (2026-08-13): a recall/kontroll időpontok nem a kezelési terv részei —
-- foglalásuk a betegkarton terv-hub „Gyors foglalás” blokkjában történik, terv
-- nélkül. A sablonokban hagyott 90/180/365 napos kontroll-lépések a hátralévő-
-- vizit forecastot és a „Becsült befejezés” dátumot is évekre széthúzták.
--
-- Hatókör: CSAK a sablonok (care_pathways.work_phases_json + steps_json).
-- A már legenerált epizód-munkafázisokhoz (episode_work_phases) nem nyúlunk —
-- azok epizódonként kezelhetők (Átugrom / Elhagyom). Kontroll-lépés kézzel
-- (egyedi munkafázisként) továbbra is felvehető egy tervbe.
--
-- Audit: pathway-nként egy care_pathway_change_events sor a törölt lépésekkel;
-- version bump + updated_at a szerkesztő optimista lockja miatt.

WITH affected AS (
  SELECT
    cp.id,
    (SELECT COALESCE(jsonb_agg(e.value), '[]'::jsonb)
       FROM jsonb_array_elements(cp.work_phases_json) AS e
      WHERE e.value->>'pool' = 'control') AS removed_work_phases
  FROM care_pathways cp
  WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(cp.work_phases_json) AS e
                 WHERE e.value->>'pool' = 'control')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(cp.steps_json) AS e
                 WHERE e.value->>'pool' = 'control')
)
INSERT INTO care_pathway_change_events (pathway_id, changed_by, change_type, change_details)
SELECT
  id,
  'migration:075_remove_control_steps_from_pathway_templates',
  'update',
  jsonb_build_object(
    'action', 'remove_control_steps',
    'reason', 'Recall a Gyors foglalás blokkban foglalandó, nem a terv része',
    'removed_work_phases', removed_work_phases
  )
FROM affected;

UPDATE care_pathways cp
SET
  work_phases_json = COALESCE(
    (SELECT jsonb_agg(t.elem ORDER BY t.ord)
       FROM jsonb_array_elements(cp.work_phases_json) WITH ORDINALITY AS t(elem, ord)
      WHERE t.elem->>'pool' IS DISTINCT FROM 'control'),
    '[]'::jsonb
  ),
  steps_json = COALESCE(
    (SELECT jsonb_agg(t.elem ORDER BY t.ord)
       FROM jsonb_array_elements(cp.steps_json) WITH ORDINALITY AS t(elem, ord)
      WHERE t.elem->>'pool' IS DISTINCT FROM 'control'),
    '[]'::jsonb
  ),
  version = cp.version + 1,
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(cp.work_phases_json) AS e
               WHERE e.value->>'pool' = 'control')
   OR EXISTS (SELECT 1 FROM jsonb_array_elements(cp.steps_json) AS e
               WHERE e.value->>'pool' = 'control');

COMMIT;

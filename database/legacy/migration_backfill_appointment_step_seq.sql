-- Migration: Backfill appointments.step_seq from linked slot_intents
-- Fixes: Worklist bookings created without step_seq cause the Treatment Plan
-- timeline to show all steps as "Tervezett" instead of "Foglalt"/"Teljesítve".
-- Run with: psql -d <db> -f database/migration_backfill_appointment_step_seq.sql

BEGIN;

-- 1) Appointments linked to a slot_intent: copy step_seq from the intent
UPDATE appointments a
SET step_seq = si.step_seq
FROM slot_intents si
WHERE a.slot_intent_id = si.id
  AND a.step_seq IS NULL
  AND si.step_seq IS NOT NULL;

-- 2) Appointments with step_code but no step_seq and no intent link:
--    infer step_seq from the first matching pathway step position (0-indexed).
--    Uses episode_pathways (multi-pathway) with fallback to legacy care_pathway_id.
UPDATE appointments a
SET step_seq = sub.inferred_seq
FROM (
  SELECT a2.id AS appointment_id,
         (elem.ordinality - 1) AS inferred_seq
  FROM appointments a2
  JOIN patient_episodes pe ON a2.episode_id = pe.id
  LEFT JOIN LATERAL (
    SELECT cp.steps_json
    FROM episode_pathways ep
    JOIN care_pathways cp ON ep.care_pathway_id = cp.id
    WHERE ep.episode_id = pe.id
    ORDER BY ep.ordinal
    LIMIT 1
  ) mp ON true
  LEFT JOIN care_pathways cp_legacy ON pe.care_pathway_id = cp_legacy.id
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(mp.steps_json, cp_legacy.steps_json)
  ) WITH ORDINALITY AS elem(step, ordinality)
  WHERE a2.step_seq IS NULL
    AND a2.step_code IS NOT NULL
    AND a2.slot_intent_id IS NULL
    AND a2.episode_id IS NOT NULL
    AND (elem.step->>'step_code') = a2.step_code
) sub
WHERE a.id = sub.appointment_id
  AND a.step_seq IS NULL;

COMMIT;

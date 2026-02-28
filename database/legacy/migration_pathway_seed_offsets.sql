-- Migration: Pathway seed offset finomhangolás (care pathway review 5. pont)
-- Run after: migration_scheduling_v2.sql
-- try_in_1: 14 → 10 nap (lenyomat → próba: 5–10 nap javaslat)

BEGIN;

-- Update care_pathways steps_json: try_in_1 default_days_offset 14 → 10
UPDATE care_pathways cp
SET steps_json = sub.updated::jsonb
FROM (
  SELECT
    cp2.id,
    jsonb_agg(
      CASE
        WHEN (elem->>'step_code') = 'try_in_1'
        THEN jsonb_set(elem, '{default_days_offset}', '10'::jsonb)
        ELSE elem
      END
      ORDER BY ord
    ) AS updated
  FROM care_pathways cp2,
    jsonb_array_elements(cp2.steps_json::jsonb) WITH ORDINALITY AS t(elem, ord)
  WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(cp2.steps_json::jsonb) AS e
    WHERE e->>'step_code' = 'try_in_1'
  )
  GROUP BY cp2.id
) sub
WHERE cp.id = sub.id;

COMMIT;

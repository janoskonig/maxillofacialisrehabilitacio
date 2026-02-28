-- Migration: Backfill inline labels into care_pathways.steps_json
-- Adds a "label" field to each step object using step_catalog.label_hu.
-- Falls back to step_code if no catalog entry exists.
-- Safe to re-run (idempotent: overwrites label each time from catalog).

BEGIN;

UPDATE care_pathways
SET steps_json = (
  SELECT COALESCE(
    jsonb_agg(
      elem || jsonb_build_object(
        'label',
        COALESCE(sc.label_hu, elem->>'step_code')
      )
      ORDER BY idx
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(steps_json) WITH ORDINALITY AS t(elem, idx)
  LEFT JOIN step_catalog sc ON sc.step_code = elem->>'step_code'
),
updated_at = CURRENT_TIMESTAMP
WHERE steps_json IS NOT NULL
  AND jsonb_array_length(steps_json) > 0;

COMMIT;

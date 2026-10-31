-- Keep construction-plan history when either jaw's clinical plan changes.
-- Existing original_plan snapshots stay unchanged; no retrospective baseline is invented.
BEGIN;

CREATE OR REPLACE FUNCTION capture_prosthesis_workload_history() RETURNS trigger AS $$
DECLARE old_row JSONB; new_row JSONB; ep UUID; entity_key TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  IF TG_TABLE_NAME = 'patient_episodes' THEN
    ep := COALESCE(new_row->>'id', old_row->>'id')::uuid;
    IF old_row->'treatment_plan' IS NOT DISTINCT FROM new_row->'treatment_plan'
      AND old_row->'treatment_plan_upper' IS NOT DISTINCT FROM new_row->'treatment_plan_upper'
      AND old_row->'treatment_plan_lower' IS NOT DISTINCT FROM new_row->'treatment_plan_lower' THEN RETURN NEW; END IF;
  ELSE
    ep := COALESCE(new_row->>'episode_id', old_row->>'episode_id')::uuid;
  END IF;
  IF TG_TABLE_NAME IN ('patient_episodes', 'episode_work_phases') AND NOT EXISTS
    (SELECT 1 FROM prostheses WHERE episode_id = ep) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  entity_key := COALESCE(new_row->>'id', old_row->>'id', new_row->>'prosthesis_id', old_row->>'prosthesis_id');
  INSERT INTO prosthesis_workload_history(entity, entity_id, episode_id, operation, old_data, new_data, changed_by)
  VALUES (TG_TABLE_NAME, entity_key, ep, TG_OP, old_row, new_row,
    NULLIF(current_setting('app.aftercare_actor', true), ''));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS capture_prosthesis_workload ON patient_episodes;
CREATE TRIGGER capture_prosthesis_workload
  AFTER UPDATE OF treatment_plan, treatment_plan_upper, treatment_plan_lower ON patient_episodes
  FOR EACH ROW EXECUTE FUNCTION capture_prosthesis_workload_history();

COMMIT;

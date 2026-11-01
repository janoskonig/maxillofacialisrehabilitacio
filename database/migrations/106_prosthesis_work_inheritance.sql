BEGIN;
CREATE OR REPLACE FUNCTION inherit_prosthesis_work_scope() RETURNS trigger AS $$
DECLARE p episode_pathways%ROWTYPE; previous_id UUID;
BEGIN
  SELECT * INTO p FROM episode_pathways WHERE id=NEW.source_episode_pathway_id;
  IF p.prosthesis_id IS NOT NULL THEN
    INSERT INTO work_phase_prostheses(work_phase_id,prosthesis_id,goal_id)
      VALUES(NEW.id,p.prosthesis_id,p.prosthesis_goal_id) ON CONFLICT DO NOTHING;
    UPDATE episode_work_phases SET clinical_scope='prosthesis' WHERE id=NEW.id;
    -- Sequence only within this concrete job. The other jaw is independent.
    SELECT id INTO previous_id FROM episode_work_phases
      WHERE source_episode_pathway_id=NEW.source_episode_pathway_id
        AND pathway_order_index<NEW.pathway_order_index
      ORDER BY pathway_order_index DESC LIMIT 1;
    IF previous_id IS NOT NULL THEN
      INSERT INTO clinical_work_dependencies(work_phase_id,requires_phase_id)
        VALUES(NEW.id,previous_id) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION validate_prosthesis_goal_context() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM prostheses p JOIN patient_episodes e ON e.id=p.episode_id
    WHERE p.id=NEW.definitive_prosthesis_id AND p.patient_id=NEW.patient_id
      AND e.patient_id=NEW.patient_id AND e.id=NEW.episode_id AND p.jaw=NEW.jaw
      AND p.role='definitive' AND p.origin='local') THEN
    RAISE EXCEPTION 'A pótlási cél beteg-, epizód-, állcsont- vagy szerepkapcsolata érvénytelen' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS validate_prosthesis_goal_context ON episode_prosthesis_goals;
CREATE TRIGGER validate_prosthesis_goal_context BEFORE INSERT OR UPDATE ON episode_prosthesis_goals
  FOR EACH ROW EXECUTE FUNCTION validate_prosthesis_goal_context();
COMMIT;

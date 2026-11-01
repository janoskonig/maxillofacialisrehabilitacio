-- Revised clinical rule: one jaw / one appliance per construction episode,
-- including provisional appliances. Every repair has its own new episode.
BEGIN;
CREATE TABLE IF NOT EXISTS prosthesis_episode_links (
  episode_id UUID PRIMARY KEY REFERENCES patient_episodes(id),
  prosthesis_id UUID NOT NULL REFERENCES prostheses(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('construction','repair')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE prosthesis_repair_cases ADD COLUMN IF NOT EXISTS episode_id UUID UNIQUE REFERENCES patient_episodes(id);
-- Unambiguous existing single-appliance episodes may be linked. Shared legacy
-- episodes remain intact and marked for explicit reconciliation.
INSERT INTO prosthesis_episode_links(episode_id,prosthesis_id,purpose)
  SELECT episode_id,(array_agg(id))[1],'construction' FROM prostheses
  WHERE episode_id IS NOT NULL AND origin='local'
  GROUP BY episode_id HAVING count(*)=1 ON CONFLICT DO NOTHING;
UPDATE prostheses SET mapping_review_required=true WHERE episode_id IN
  (SELECT episode_id FROM prostheses WHERE episode_id IS NOT NULL GROUP BY episode_id HAVING count(*)>1);
CREATE OR REPLACE FUNCTION link_single_prosthesis_episode() RETURNS trigger AS $$
BEGIN
  IF NEW.origin='local' AND NEW.episode_id IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM prosthesis_episode_links WHERE episode_id=NEW.episode_id AND prosthesis_id<>NEW.id)
      OR EXISTS(SELECT 1 FROM prostheses WHERE episode_id=NEW.episode_id AND id<>NEW.id) THEN
      RAISE EXCEPTION 'Egy epizód csak egy állcsont egy fogpótlásához tartozhat' USING ERRCODE='23514';
    END IF;
    INSERT INTO prosthesis_episode_links(episode_id,prosthesis_id,purpose) VALUES(NEW.episode_id,NEW.id,'construction') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS link_single_prosthesis_episode ON prostheses;
CREATE TRIGGER link_single_prosthesis_episode AFTER INSERT OR UPDATE OF episode_id,origin ON prostheses
  FOR EACH ROW EXECUTE FUNCTION link_single_prosthesis_episode();
CREATE OR REPLACE FUNCTION validate_prosthesis_goal_context() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM prostheses p JOIN prosthesis_episode_links l ON l.prosthesis_id=p.id
    WHERE p.id=NEW.definitive_prosthesis_id AND p.patient_id=NEW.patient_id
      AND l.episode_id=NEW.episode_id AND l.purpose='construction' AND p.jaw=NEW.jaw) THEN
    RAISE EXCEPTION 'Az epizód saját fogpótlását válassza (ideiglenes vagy végleges)' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION guard_prosthesis_episode_closure() RETURNS trigger AS $$
DECLARE link prosthesis_episode_links%ROWTYPE;
BEGIN
  IF NEW.status='closed' AND OLD.status IS DISTINCT FROM 'closed'
    AND NOT EXISTS(SELECT 1 FROM patients WHERE id=NEW.patient_id AND halal_datum IS NOT NULL) THEN
    SELECT * INTO link FROM prosthesis_episode_links WHERE episode_id=NEW.id;
    IF link.purpose='construction' AND NOT EXISTS(SELECT 1 FROM prosthesis_active_events
      WHERE prosthesis_id=link.prosthesis_id AND kind='accepted') THEN
      RAISE EXCEPTION 'Az epizód fogpótlásának klinikai elfogadása szükséges' USING ERRCODE='23514';
    END IF;
    IF link.purpose='repair' AND NOT EXISTS(SELECT 1 FROM prosthesis_repair_cases r JOIN prosthesis_active_events e
      ON e.payload->'command'->>'repairCaseId'=r.id::text
      WHERE r.episode_id=NEW.id AND e.kind IN ('repair_completed','remake_decided')) THEN
      RAISE EXCEPTION 'A javítási epizód eredményének rögzítése szükséges' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DO $$ DECLARE r RECORD; ep UUID; reason_text TEXT; completion_day DATE;
BEGIN
  FOR r IN SELECT c.*,p.episode_id AS original_episode,e.occurred_on,e.recorded_by,pr.reason AS original_reason
    FROM prosthesis_repair_cases c JOIN prostheses p ON p.id=c.prosthesis_id
    JOIN prosthesis_clinical_events e ON e.id=c.opened_event_id
    LEFT JOIN patient_episodes pr ON pr.id=p.episode_id WHERE c.episode_id IS NULL LOOP
    reason_text:=COALESCE(r.original_reason,(SELECT reason FROM patient_episodes WHERE patient_id=r.patient_id ORDER BY opened_at DESC LIMIT 1));
    IF reason_text IS NULL THEN CONTINUE; END IF;
    INSERT INTO patient_episodes(patient_id,reason,chief_complaint,case_title,status,opened_at,parent_episode_id,trigger_type,created_by)
      VALUES(r.patient_id,reason_text,left(r.reason,500),'Javítási epizód','open',r.occurred_on::timestamp AT TIME ZONE 'Europe/Budapest',r.original_episode,'egyeb',r.recorded_by::text) RETURNING id INTO ep;
    INSERT INTO prosthesis_episode_links(episode_id,prosthesis_id,purpose) VALUES(ep,r.prosthesis_id,'repair');
    UPDATE prosthesis_repair_cases SET episode_id=ep WHERE id=r.id;
    SELECT min(occurred_on) INTO completion_day FROM prosthesis_active_events
      WHERE payload->'command'->>'repairCaseId'=r.id::text AND kind IN ('repair_completed','remake_decided');
    IF completion_day IS NOT NULL THEN UPDATE patient_episodes SET status='closed',closed_at=completion_day::timestamp AT TIME ZONE 'Europe/Budapest' WHERE id=ep; END IF;
  END LOOP;
END $$;
COMMIT;

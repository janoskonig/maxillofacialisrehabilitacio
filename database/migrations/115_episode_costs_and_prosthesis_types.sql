-- Multiple fixed appliances and one removable appliance per jaw; preserve old identities and observations.
BEGIN;
ALTER TABLE patient_dental_status ADD COLUMN IF NOT EXISTS felso_fogpotlas_tipusok JSONB;
ALTER TABLE patient_dental_status ADD COLUMN IF NOT EXISTS also_fogpotlas_tipusok JSONB;
DO $$ DECLARE definition TEXT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='patients_full' AND column_name='felso_fogpotlas_tipusok') THEN
    SELECT pg_get_viewdef('patients_full'::regclass,true) INTO definition;
    EXECUTE 'CREATE OR REPLACE VIEW patients_full AS SELECT previous.*, d.felso_fogpotlas_tipusok, d.also_fogpotlas_tipusok FROM (' || rtrim(definition, E';\n ') || ') previous LEFT JOIN patient_dental_status d ON d.patient_id=previous.id';
  END IF;
END $$;
ALTER TABLE episode_financing_events ADD COLUMN IF NOT EXISTS cost_breakdown JSONB CHECK(cost_breakdown IS NULL OR jsonb_typeof(cost_breakdown)='object');
ALTER TABLE prosthesis_episode_links DROP CONSTRAINT IF EXISTS episode_one_prosthesis_per_jaw;
ALTER TABLE episode_prosthesis_goals DROP CONSTRAINT IF EXISTS episode_prosthesis_goals_episode_id_jaw_key;
ALTER TABLE episode_prosthesis_goals ADD CONSTRAINT episode_goal_appliance UNIQUE(episode_id,definitive_prosthesis_id);
CREATE OR REPLACE FUNCTION validate_episode_prosthesis_link() RETURNS trigger AS $$
DECLARE p prostheses%ROWTYPE; owner UUID;
BEGIN
  SELECT patient_id INTO owner FROM patient_episodes WHERE id=NEW.episode_id FOR UPDATE;
  SELECT * INTO p FROM prostheses WHERE id=NEW.prosthesis_id;
  IF owner IS NULL OR p.id IS NULL OR owner<>p.patient_id THEN
    RAISE EXCEPTION 'Az epizód és a fogpótlás ugyanahhoz a beteghez tartozzon' USING ERRCODE='23514';
  END IF;
  IF NEW.jaw IS NOT NULL AND NEW.jaw<>p.jaw THEN
    RAISE EXCEPTION 'Az epizódkapcsolat állcsontja eltér a készüléktől' USING ERRCODE='23514';
  END IF;
  NEW.jaw:=p.jaw;
  IF EXISTS(SELECT 1 FROM prosthesis_episode_links l JOIN prostheses other ON other.id=l.prosthesis_id WHERE l.episode_id=NEW.episode_id
      AND l.prosthesis_id<>NEW.prosthesis_id AND l.jaw=NEW.jaw
      AND (NEW.purpose='repair' OR (p.prosthesis_type NOT IN ('fixed','screw_retained_implant_bridge') AND other.prosthesis_type NOT IN ('fixed','screw_retained_implant_bridge')))) THEN
    RAISE EXCEPTION 'Állcsontonként legfeljebb egy kivehető fogpótlás kapcsolható; rögzítettből több is lehet' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM prosthesis_episode_links WHERE episode_id=NEW.episode_id
      AND prosthesis_id<>NEW.prosthesis_id AND purpose<>NEW.purpose) THEN
    RAISE EXCEPTION 'A javítás saját epizódhoz tartozik' USING ERRCODE='23514';
  END IF;
  IF NEW.purpose='construction' AND (p.origin<>'local' OR p.episode_id IS DISTINCT FROM NEW.episode_id) THEN
    RAISE EXCEPTION 'Csak az epizódban készülő fogpótlás kapcsolható elkészítési célként' USING ERRCODE='23514';
  END IF;
  IF NEW.purpose='repair' AND p.episode_id=NEW.episode_id THEN
    RAISE EXCEPTION 'A javításhoz az elkészítéstől külön epizód szükséges' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS validate_episode_prosthesis_link ON prosthesis_episode_links;
CREATE TRIGGER validate_episode_prosthesis_link BEFORE INSERT OR UPDATE ON prosthesis_episode_links
  FOR EACH ROW EXECUTE FUNCTION validate_episode_prosthesis_link();

CREATE OR REPLACE FUNCTION link_episode_prosthesis() RETURNS trigger AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM prosthesis_episode_links l JOIN patient_episodes e ON e.id=l.episode_id
      WHERE l.prosthesis_id=NEW.id AND e.patient_id<>NEW.patient_id) THEN
    RAISE EXCEPTION 'A fogpótlás epizódkapcsolatai másik beteghez tartoznak' USING ERRCODE='23514';
  END IF;
  IF NEW.origin='local' AND NEW.episode_id IS NOT NULL THEN
    PERFORM 1 FROM patient_episodes WHERE id=NEW.episode_id FOR UPDATE;
    -- Unreconciled old records also reserve their jaw; never hide or reassign
    -- an ambiguous legacy appliance to make room for a new registration.
    IF EXISTS(SELECT 1 FROM prostheses WHERE episode_id=NEW.episode_id
        AND id<>NEW.id AND jaw=NEW.jaw AND NEW.prosthesis_type NOT IN ('fixed','screw_retained_implant_bridge')
        AND prosthesis_type NOT IN ('fixed','screw_retained_implant_bridge')) THEN
      RAISE EXCEPTION 'Állcsontonként legfeljebb egy kivehető fogpótlás kapcsolható; rögzítettből több is lehet' USING ERRCODE='23514';
    END IF;
  END IF;
  DELETE FROM prosthesis_episode_links WHERE prosthesis_id=NEW.id AND purpose='construction'
    AND (NEW.origin<>'local' OR episode_id IS DISTINCT FROM NEW.episode_id);
  IF NEW.origin='local' AND NEW.episode_id IS NOT NULL THEN
    INSERT INTO prosthesis_episode_links(episode_id,prosthesis_id,purpose,jaw)
      VALUES(NEW.episode_id,NEW.id,'construction',NEW.jaw)
      ON CONFLICT(episode_id,prosthesis_id) DO UPDATE SET jaw=EXCLUDED.jaw;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS link_episode_prosthesis ON prostheses;
CREATE TRIGGER link_episode_prosthesis AFTER INSERT OR UPDATE OF episode_id,origin,jaw,patient_id,prosthesis_type ON prostheses
  FOR EACH ROW EXECUTE FUNCTION link_episode_prosthesis();


COMMENT ON TABLE prosthesis_episode_links IS 'Multiple fixed appliances and at most one removable appliance per jaw; each repair retains a separate episode.';
COMMIT;

-- An episode may contain one upper and one lower appliance. Existing appliance
-- identities, episode assignments, plan versions and closure history stay intact.
BEGIN;
ALTER TABLE prosthesis_episode_links ADD COLUMN IF NOT EXISTS jaw TEXT;
UPDATE prosthesis_episode_links l SET jaw=p.jaw FROM prostheses p
  WHERE p.id=l.prosthesis_id AND l.jaw IS NULL;
ALTER TABLE prosthesis_episode_links ALTER COLUMN jaw SET NOT NULL;
ALTER TABLE prosthesis_episode_links DROP CONSTRAINT prosthesis_episode_links_pkey;
ALTER TABLE prosthesis_episode_links ADD PRIMARY KEY (episode_id,prosthesis_id);
ALTER TABLE prosthesis_episode_links ADD CONSTRAINT episode_prosthesis_jaw
  CHECK(jaw IN ('felso','also'));
ALTER TABLE prosthesis_episode_links ADD CONSTRAINT episode_one_prosthesis_per_jaw
  UNIQUE(episode_id,jaw);

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
  IF EXISTS(SELECT 1 FROM prosthesis_episode_links WHERE episode_id=NEW.episode_id
      AND prosthesis_id<>NEW.prosthesis_id AND jaw=NEW.jaw) THEN
    RAISE EXCEPTION 'Egy epizódban állcsontonként legfeljebb egy fogpótlás lehet' USING ERRCODE='23514';
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
        AND id<>NEW.id AND jaw=NEW.jaw) THEN
      RAISE EXCEPTION 'Egy epizódban állcsontonként legfeljebb egy fogpótlás lehet' USING ERRCODE='23514';
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
DROP TRIGGER link_single_prosthesis_episode ON prostheses;
CREATE TRIGGER link_episode_prosthesis AFTER INSERT OR UPDATE OF episode_id,origin,jaw,patient_id ON prostheses
  FOR EACH ROW EXECUTE FUNCTION link_episode_prosthesis();
DROP FUNCTION link_single_prosthesis_episode();

CREATE OR REPLACE FUNCTION guard_prosthesis_episode_closure() RETURNS trigger AS $$
BEGIN
  IF NEW.status='closed' AND OLD.status IS DISTINCT FROM 'closed'
    AND NOT EXISTS(SELECT 1 FROM patients WHERE id=NEW.patient_id AND halal_datum IS NOT NULL) THEN
    IF EXISTS(SELECT 1 FROM (
        SELECT prosthesis_id FROM prosthesis_episode_links WHERE episode_id=NEW.id AND purpose='construction'
        UNION SELECT id FROM prostheses WHERE episode_id=NEW.id AND origin='local'
      ) devices WHERE NOT EXISTS(SELECT 1 FROM prosthesis_active_events
        WHERE prosthesis_id=devices.prosthesis_id AND kind='accepted')) THEN
      RAISE EXCEPTION 'Az epizód minden fogpótlásának klinikai elfogadása szükséges' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM prosthesis_episode_links l WHERE l.episode_id=NEW.id AND l.purpose='repair'
      AND NOT EXISTS(SELECT 1 FROM prosthesis_repair_cases r JOIN prosthesis_active_events e
        ON e.payload->'command'->>'repairCaseId'=r.id::text
        WHERE r.episode_id=NEW.id AND r.prosthesis_id=l.prosthesis_id AND e.kind IN ('repair_completed','remake_decided'))) THEN
      RAISE EXCEPTION 'A javítási epizód eredményének rögzítése szükséges' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
COMMENT ON TABLE prosthesis_episode_links IS
  'At most one appliance per jaw (two per episode); repairs keep appliance identity in a new episode. Legacy assignments are not automatically merged.';
COMMIT;

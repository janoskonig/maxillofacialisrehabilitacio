-- Financing decisions are dated, immutable records tied to an episode and
-- optionally an exact plan version. No funding is inferred for old patients.
BEGIN;
CREATE TABLE IF NOT EXISTS episode_financing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE REFERENCES prosthesis_clinical_events(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  episode_id UUID NOT NULL REFERENCES patient_episodes(id),
  prosthesis_id UUID REFERENCES prostheses(id),
  plan_version_id UUID REFERENCES prosthesis_plan_versions(id),
  version INTEGER NOT NULL CHECK(version>0),
  effective_on DATE NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('unknown','neak','equity','self_pay','mixed','other')),
  status TEXT NOT NULL CHECK(status IN ('unknown','pending','approved','rejected','withdrawn')),
  payer TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL CHECK(currency IN ('HUF','EUR')),
  total_amount NUMERIC(14,2) CHECK(total_amount>=0),
  funded_amount NUMERIC(14,2) CHECK(funded_amount>=0),
  patient_amount NUMERIC(14,2) CHECK(patient_amount>=0),
  reason TEXT NOT NULL CHECK(length(trim(reason))>0),
  decision_reference TEXT NOT NULL DEFAULT '',
  document_ids UUID[] NOT NULL DEFAULT '{}',
  corrects_id UUID UNIQUE REFERENCES episode_financing_events(id),
  UNIQUE(episode_id,version),
  CHECK(status<>'approved' OR (plan_version_id IS NOT NULL AND mode<>'unknown')),
  CHECK(mode<>'other' OR length(trim(payer))>0),
  CHECK(mode<>'self_pay' OR funded_amount IS NULL OR funded_amount=0),
  CHECK(total_amount IS NULL OR funded_amount IS NULL OR funded_amount<=total_amount),
  CHECK(total_amount IS NULL OR patient_amount IS NULL OR patient_amount<=total_amount),
  CHECK(total_amount IS NULL OR funded_amount IS NULL OR patient_amount IS NULL OR funded_amount+patient_amount=total_amount)
);
CREATE INDEX IF NOT EXISTS episode_financing_effective ON episode_financing_events(episode_id,effective_on DESC,version DESC);
DROP TRIGGER IF EXISTS immutable_episode_financing ON episode_financing_events;
CREATE TRIGGER immutable_episode_financing BEFORE UPDATE ON episode_financing_events
  FOR EACH ROW EXECUTE FUNCTION immutable_clinical_record();
CREATE OR REPLACE FUNCTION validate_episode_financing_context() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM patient_episodes WHERE id=NEW.episode_id AND patient_id=NEW.patient_id)
    OR NOT EXISTS(SELECT 1 FROM prosthesis_clinical_events WHERE id=NEW.event_id AND patient_id=NEW.patient_id AND episode_id=NEW.episode_id AND kind='financing_changed')
    OR (NEW.plan_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM prosthesis_plan_versions WHERE id=NEW.plan_version_id AND episode_id=NEW.episode_id AND patient_id=NEW.patient_id))
    OR (NEW.prosthesis_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM prosthesis_episode_links WHERE episode_id=NEW.episode_id AND prosthesis_id=NEW.prosthesis_id))
    OR (NEW.corrects_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM episode_financing_events WHERE id=NEW.corrects_id AND episode_id=NEW.episode_id AND patient_id=NEW.patient_id)) THEN
    RAISE EXCEPTION 'A finanszírozás beteg-, epizód-, terv- vagy fogpótláskapcsolata érvénytelen' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS validate_episode_financing_context ON episode_financing_events;
CREATE TRIGGER validate_episode_financing_context BEFORE INSERT ON episode_financing_events
  FOR EACH ROW EXECUTE FUNCTION validate_episode_financing_context();
COMMIT;

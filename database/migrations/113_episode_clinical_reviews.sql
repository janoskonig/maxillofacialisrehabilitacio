-- No historical backfill: today's chart is not evidence of a past examination.
BEGIN;
CREATE TABLE IF NOT EXISTS episode_clinical_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  episode_id UUID NOT NULL REFERENCES patient_episodes(id),
  version INT NOT NULL CHECK(version>0),
  event_id UUID NOT NULL UNIQUE REFERENCES prosthesis_clinical_events(id),
  effective_on DATE NOT NULL,
  source TEXT NOT NULL CHECK(length(trim(source))>0),
  note TEXT NOT NULL DEFAULT '',
  content JSONB NOT NULL CHECK(jsonb_typeof(content)='object'),
  source_review_id UUID REFERENCES episode_clinical_reviews(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by UUID NOT NULL REFERENCES users(id),
  UNIQUE(episode_id,version)
);
CREATE INDEX IF NOT EXISTS episode_clinical_reviews_timeline ON episode_clinical_reviews(episode_id,effective_on DESC,version DESC);
CREATE INDEX IF NOT EXISTS episode_clinical_reviews_patient ON episode_clinical_reviews(patient_id,effective_on DESC);
DROP TRIGGER IF EXISTS immutable_clinical_record ON episode_clinical_reviews;
CREATE TRIGGER immutable_clinical_record BEFORE UPDATE ON episode_clinical_reviews FOR EACH ROW EXECUTE FUNCTION immutable_clinical_record();
CREATE OR REPLACE FUNCTION check_episode_clinical_review_owner() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM patient_episodes WHERE id=NEW.episode_id AND patient_id=NEW.patient_id)
    OR NOT EXISTS(SELECT 1 FROM prosthesis_clinical_events WHERE id=NEW.event_id AND patient_id=NEW.patient_id AND episode_id=NEW.episode_id)
    OR (NEW.source_review_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM episode_clinical_reviews WHERE id=NEW.source_review_id AND patient_id=NEW.patient_id))
  THEN RAISE EXCEPTION 'Episode clinical review ownership mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS check_episode_clinical_review_owner ON episode_clinical_reviews;
CREATE TRIGGER check_episode_clinical_review_owner BEFORE INSERT ON episode_clinical_reviews FOR EACH ROW EXECUTE FUNCTION check_episode_clinical_review_owner();
COMMIT;

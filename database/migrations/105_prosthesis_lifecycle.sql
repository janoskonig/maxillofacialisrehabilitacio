-- Clinical time is independent of entry time. Existing prosthesis IDs are retained.
BEGIN;
ALTER TABLE prostheses ALTER COLUMN episode_id DROP NOT NULL;
ALTER TABLE prostheses ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'unknown' CHECK (origin IN ('local','external','unknown'));
ALTER TABLE prostheses ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'unknown' CHECK (role IN ('provisional','definitive','unknown'));
ALTER TABLE prostheses ADD COLUMN IF NOT EXISTS specification JSONB NOT NULL DEFAULT '{}';
ALTER TABLE prostheses ADD COLUMN IF NOT EXISTS positions JSONB NOT NULL DEFAULT '[]';
ALTER TABLE prostheses ADD COLUMN IF NOT EXISTS replaces_id UUID REFERENCES prostheses(id);
ALTER TABLE prostheses ADD COLUMN IF NOT EXISTS mapping_review_required BOOLEAN NOT NULL DEFAULT true;
-- The old check required a booked slot even for a historical delivery.
DO $$ DECLARE c RECORD; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='prostheses'::regclass
    AND contype='c' AND pg_get_constraintdef(oid) LIKE '%delivery_date%delivery_appointment_id%'
  LOOP EXECUTE format('ALTER TABLE prostheses DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS prosthesis_clinical_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  episode_id UUID REFERENCES patient_episodes(id),
  prosthesis_id UUID REFERENCES prostheses(id),
  kind TEXT NOT NULL,
  occurred_on DATE NOT NULL,
  occurred_at TIMESTAMPTZ,
  time_precision TEXT NOT NULL CHECK (time_precision IN ('day','exact')),
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  note TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by UUID NOT NULL REFERENCES users(id),
  request_key UUID NOT NULL,
  supersedes_id UUID UNIQUE REFERENCES prosthesis_clinical_events(id),
  UNIQUE(patient_id,request_key),
  CHECK ((time_precision='exact') = (occurred_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS prosthesis_events_timeline ON prosthesis_clinical_events(patient_id,occurred_on,occurred_at,recorded_at);
CREATE OR REPLACE VIEW prosthesis_active_events AS
  SELECT e.* FROM prosthesis_clinical_events e WHERE NOT EXISTS
    (SELECT 1 FROM prosthesis_clinical_events n WHERE n.supersedes_id=e.id);

CREATE TABLE IF NOT EXISTS clinical_dental_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  event_id UUID NOT NULL UNIQUE REFERENCES prosthesis_clinical_events(id),
  mode TEXT NOT NULL CHECK (mode IN ('assessment','change')),
  layers JSONB NOT NULL CHECK (jsonb_typeof(layers)='object'),
  expected_before JSONB,
  legacy_snapshot_id UUID REFERENCES dental_status_snapshots(id)
);
CREATE TABLE IF NOT EXISTS episode_prosthesis_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  episode_id UUID NOT NULL REFERENCES patient_episodes(id),
  jaw TEXT NOT NULL CHECK (jaw IN ('felso','also')),
  definitive_prosthesis_id UUID NOT NULL REFERENCES prostheses(id),
  baseline_state_id UUID REFERENCES clinical_dental_states(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(episode_id,jaw)
);
CREATE TABLE IF NOT EXISTS prosthesis_repair_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  prosthesis_id UUID NOT NULL REFERENCES prostheses(id),
  baseline_state_id UUID NOT NULL REFERENCES clinical_dental_states(id),
  opened_event_id UUID NOT NULL UNIQUE REFERENCES prosthesis_clinical_events(id),
  reason TEXT NOT NULL,
  plan TEXT NOT NULL,
  documents JSONB NOT NULL DEFAULT '[]',
  laboratory_tasks JSONB NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS prosthesis_plan_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  episode_id UUID NOT NULL REFERENCES patient_episodes(id),
  baseline_state_id UUID NOT NULL REFERENCES clinical_dental_states(id),
  version INT NOT NULL,
  event_id UUID NOT NULL UNIQUE REFERENCES prosthesis_clinical_events(id),
  content JSONB NOT NULL,
  approved BOOLEAN NOT NULL,
  UNIQUE(episode_id,version)
);
ALTER TABLE episode_pathways ADD COLUMN IF NOT EXISTS prosthesis_id UUID REFERENCES prostheses(id);
ALTER TABLE episode_pathways ADD COLUMN IF NOT EXISTS prosthesis_goal_id UUID REFERENCES episode_prosthesis_goals(id);
ALTER TABLE episode_work_phases ADD COLUMN IF NOT EXISTS clinical_scope TEXT NOT NULL DEFAULT 'review' CHECK (clinical_scope IN ('episode','prosthesis','review'));
ALTER TABLE episode_work_phases ADD COLUMN IF NOT EXISTS repair_case_id UUID REFERENCES prosthesis_repair_cases(id);
CREATE TABLE IF NOT EXISTS work_phase_prostheses (
  work_phase_id UUID NOT NULL REFERENCES episode_work_phases(id) ON DELETE CASCADE,
  prosthesis_id UUID NOT NULL REFERENCES prostheses(id),
  goal_id UUID REFERENCES episode_prosthesis_goals(id),
  PRIMARY KEY(work_phase_id,prosthesis_id)
);
CREATE TABLE IF NOT EXISTS clinical_work_dependencies (
  work_phase_id UUID NOT NULL REFERENCES episode_work_phases(id) ON DELETE CASCADE,
  requires_phase_id UUID NOT NULL REFERENCES episode_work_phases(id) ON DELETE CASCADE,
  PRIMARY KEY(work_phase_id,requires_phase_id), CHECK(work_phase_id<>requires_phase_id)
);
CREATE OR REPLACE FUNCTION inherit_prosthesis_work_scope() RETURNS trigger AS $$
DECLARE p episode_pathways%ROWTYPE;
BEGIN
  SELECT * INTO p FROM episode_pathways WHERE id=NEW.source_episode_pathway_id;
  IF p.prosthesis_id IS NOT NULL THEN
    INSERT INTO work_phase_prostheses(work_phase_id,prosthesis_id,goal_id)
      VALUES(NEW.id,p.prosthesis_id,p.prosthesis_goal_id) ON CONFLICT DO NOTHING;
    UPDATE episode_work_phases SET clinical_scope='prosthesis' WHERE id=NEW.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS inherit_prosthesis_work_scope ON episode_work_phases;
CREATE TRIGGER inherit_prosthesis_work_scope AFTER INSERT ON episode_work_phases
  FOR EACH ROW EXECUTE FUNCTION inherit_prosthesis_work_scope();

CREATE TABLE IF NOT EXISTS clinical_followup_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  prosthesis_id UUID NOT NULL REFERENCES prostheses(id),
  goal_id UUID REFERENCES episode_prosthesis_goals(id),
  source_event_id UUID NOT NULL REFERENCES prosthesis_clinical_events(id),
  due_on DATE NOT NULL,
  purpose TEXT NOT NULL,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  completed_event_id UUID REFERENCES prosthesis_clinical_events(id),
  UNIQUE(source_event_id,prosthesis_id,purpose)
);
CREATE TABLE IF NOT EXISTS clinical_episode_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES patient_episodes(id),
  event_id UUID NOT NULL UNIQUE REFERENCES prosthesis_clinical_events(id),
  acceptance_events JSONB NOT NULL,
  previous_closed_at TIMESTAMPTZ
);
-- Applies to old and new close paths. Aftercare never reopens construction.
CREATE OR REPLACE FUNCTION guard_prosthesis_episode_closure() RETURNS trigger AS $$
BEGIN
  IF NEW.status='closed' AND OLD.status IS DISTINCT FROM 'closed'
    AND EXISTS(SELECT 1 FROM episode_prosthesis_goals WHERE episode_id=NEW.id)
    AND NOT EXISTS(SELECT 1 FROM patients WHERE id=NEW.patient_id AND halal_datum IS NOT NULL)
    AND EXISTS(SELECT 1 FROM episode_prosthesis_goals g WHERE g.episode_id=NEW.id
      AND NOT EXISTS(SELECT 1 FROM prosthesis_active_events e
        WHERE e.prosthesis_id=g.definitive_prosthesis_id AND e.kind='accepted')) THEN
    RAISE EXCEPTION 'Minden kijelölt végleges fogpótlás klinikai elfogadása szükséges' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS guard_prosthesis_episode_closure ON patient_episodes;
CREATE TRIGGER guard_prosthesis_episode_closure BEFORE UPDATE OF status ON patient_episodes
  FOR EACH ROW EXECUTE FUNCTION guard_prosthesis_episode_closure();

-- Exact bytes, including uploaded files, are retained, not mutable FTP references.
CREATE TABLE IF NOT EXISTS clinical_document_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  episode_id UUID REFERENCES patient_episodes(id),
  plan_version_id UUID REFERENCES prosthesis_plan_versions(id),
  status_state_id UUID REFERENCES clinical_dental_states(id),
  prosthesis_ids UUID[] NOT NULL DEFAULT '{}',
  supplements_id UUID REFERENCES clinical_document_packages(id),
  request_key UUID NOT NULL,
  manifest JSONB NOT NULL,
  archive BYTEA NOT NULL,
  sha256 TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(patient_id,request_key)
);
CREATE OR REPLACE FUNCTION immutable_clinical_record() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'A kiadott klinikai változat nem írható felül; új változat szükséges' USING ERRCODE='23514'; END $$ LANGUAGE plpgsql;
DO $$ DECLARE tab TEXT; BEGIN
  FOREACH tab IN ARRAY ARRAY['prosthesis_clinical_events','clinical_dental_states','prosthesis_plan_versions','clinical_episode_closures','clinical_document_packages'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS immutable_clinical_record ON %I',tab);
    EXECUTE format('CREATE TRIGGER immutable_clinical_record BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_clinical_record()',tab);
  END LOOP;
END $$;
-- Legacy records stay reviewable: no jaw-only identity matching or manufactured dates.
COMMENT ON COLUMN prostheses.mapping_review_required IS 'Explicit clinical review needed for legacy origin, role and episode mapping.';
COMMIT;

-- Delivery-linked clinical workload. No historical delivery dates are inferred.
BEGIN;

CREATE TABLE IF NOT EXISTS prostheses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  episode_id UUID NOT NULL REFERENCES patient_episodes(id),
  jaw TEXT NOT NULL CHECK (jaw IN ('felso', 'also')),
  prosthesis_type TEXT NOT NULL CHECK (prosthesis_type IN
    ('removable', 'fixed', 'combined_fixed_removable', 'screw_retained_implant_bridge', 'obturator', 'other')),
  label VARCHAR(160) NOT NULL,
  baseline JSONB NOT NULL,
  original_plan JSONB NOT NULL,
  delivery_date DATE,
  delivery_appointment_id UUID REFERENCES appointments(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((delivery_date IS NULL) = (delivery_appointment_id IS NULL))
);
CREATE INDEX IF NOT EXISTS prostheses_patient_idx ON prostheses(patient_id, episode_id);

CREATE TABLE IF NOT EXISTS prosthesis_care_encounters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  appointment_id UUID NOT NULL UNIQUE REFERENCES appointments(id),
  phase TEXT NOT NULL CHECK (phase IN ('construction', 'aftercare')),
  occurred_on DATE NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  clinician_email TEXT NOT NULL,
  clinical_minutes INT CHECK (clinical_minutes BETWEEN 1 AND 1440),
  construction_activities TEXT[] NOT NULL DEFAULT '{}',
  plan_deviation VARCHAR(1000) NOT NULL DEFAULT '',
  delay_reason TEXT NOT NULL DEFAULT 'none' CHECK (delay_reason IN ('none', 'capacity', 'laboratory', 'clinical', 'patient')),
  note VARCHAR(1000) NOT NULL DEFAULT '',
  return_after_days INT CHECK (return_after_days BETWEEN 1 AND 730),
  -- Each link has its own assessed problems, interventions, result and next action.
  links JSONB NOT NULL CHECK (jsonb_typeof(links) = 'array' AND jsonb_array_length(links) > 0),
  version INT NOT NULL DEFAULT 1,
  recorded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE prosthesis_care_encounters ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;
UPDATE prosthesis_care_encounters c SET occurred_at = COALESCE(a.start_time, s.start_time, c.occurred_on::timestamp AT TIME ZONE 'Europe/Budapest')
  FROM appointments a LEFT JOIN available_time_slots s ON s.id = a.time_slot_id
  WHERE a.id = c.appointment_id AND c.occurred_at IS NULL;
ALTER TABLE prosthesis_care_encounters ALTER COLUMN occurred_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS prosthesis_care_patient_idx ON prosthesis_care_encounters(patient_id, occurred_on);

CREATE TABLE IF NOT EXISTS prosthesis_followups (
  prosthesis_id UUID PRIMARY KEY REFERENCES prostheses(id),
  assessed_on DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('comfortable', 'ongoing_problem', 'access_barrier', 'elsewhere', 'stopped_attending', 'unknown')),
  contact_method TEXT NOT NULL CHECK (contact_method IN ('in_person', 'phone', 'portal', 'record_review')),
  unresolved BOOLEAN,
  function_score INT CHECK (function_score BETWEEN 0 AND 10),
  comfort_score INT CHECK (comfort_score BETWEEN 0 AND 10),
  note VARCHAR(1000) NOT NULL DEFAULT '',
  recorded_by UUID NOT NULL REFERENCES users(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'comfortable' OR unresolved IS FALSE),
  CHECK (status <> 'ongoing_problem' OR unresolved IS TRUE),
  CHECK (status <> 'unknown' OR (unresolved IS NULL AND function_score IS NULL AND comfort_score IS NULL))
);

CREATE TABLE IF NOT EXISTS aftercare_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  episode_id UUID NOT NULL REFERENCES patient_episodes(id),
  delivery_prosthesis_id UUID UNIQUE REFERENCES prostheses(id),
  encounter_id UUID UNIQUE REFERENCES prosthesis_care_encounters(id),
  requested_on DATE NOT NULL,
  due_on DATE NOT NULL,
  interval_days INT,
  next_action TEXT NOT NULL,
  appointment_id UUID,
  delay_reason TEXT NOT NULL DEFAULT 'none' CHECK (delay_reason IN ('none', 'capacity', 'laboratory', 'clinical', 'patient')),
  version INT NOT NULL DEFAULT 1,
  updated_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(delivery_prosthesis_id, encounter_id) = 1)
);
ALTER TABLE aftercare_requests DROP CONSTRAINT IF EXISTS aftercare_requests_appointment_id_fkey;
ALTER TABLE aftercare_requests ADD CONSTRAINT aftercare_requests_appointment_id_fkey
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS aftercare_requests_due_idx ON aftercare_requests(due_on, patient_id);

-- Append-only history retains original clinical records and plan changes, including
-- deleted work phases. These are clinical data; free text never enters research rows.
CREATE TABLE IF NOT EXISTS prosthesis_workload_history (
  id BIGSERIAL PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  episode_id UUID,
  operation TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB,
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prosthesis_workload_history_episode_idx ON prosthesis_workload_history(episode_id, changed_at);

CREATE OR REPLACE FUNCTION capture_prosthesis_workload_history() RETURNS trigger AS $$
DECLARE old_row JSONB; new_row JSONB; ep UUID; entity_key TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  IF TG_TABLE_NAME = 'patient_episodes' THEN
    ep := COALESCE(new_row->>'id', old_row->>'id')::uuid;
    IF old_row->'treatment_plan' IS NOT DISTINCT FROM new_row->'treatment_plan' THEN RETURN NEW; END IF;
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

DO $$ DECLARE tab TEXT;
BEGIN
  FOREACH tab IN ARRAY ARRAY['prostheses', 'prosthesis_care_encounters', 'prosthesis_followups', 'aftercare_requests', 'episode_work_phases'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS capture_prosthesis_workload ON %I', tab);
    EXECUTE format('CREATE TRIGGER capture_prosthesis_workload AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION capture_prosthesis_workload_history()', tab);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS capture_prosthesis_workload ON patient_episodes;
CREATE TRIGGER capture_prosthesis_workload AFTER UPDATE OF treatment_plan ON patient_episodes
  FOR EACH ROW EXECUTE FUNCTION capture_prosthesis_workload_history();

COMMENT ON TABLE prostheses IS 'One construction per prosthesis, immutable assessment/plan snapshots; individual confirmed delivery date.';
COMMENT ON COLUMN prosthesis_care_encounters.clinical_minutes IS 'Measured appointment-level clinical minutes. NULL means unrecorded, never zero; do not sum once per prosthesis.';
COMMENT ON TABLE prosthesis_followups IS 'Three-calendar-month ascertainment. Absence is incomplete follow-up, never presumed comfortable. Later care continues in encounters.';
COMMIT;

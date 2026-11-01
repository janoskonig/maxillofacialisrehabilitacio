BEGIN;
-- Repair work belongs to the repair, including prostheses made elsewhere that
-- have no local construction episode. A repair never manufactures an episode.
CREATE TABLE IF NOT EXISTS prosthesis_repair_work_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_case_id UUID NOT NULL REFERENCES prosthesis_repair_cases(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  label VARCHAR(200) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed')),
  completed_at TIMESTAMPTZ,
  requires_phase_ids UUID[] NOT NULL DEFAULT '{}',
  last_event_id UUID NOT NULL REFERENCES prosthesis_clinical_events(id)
);
COMMIT;

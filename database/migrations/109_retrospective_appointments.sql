BEGIN;
CREATE TABLE IF NOT EXISTS retrospective_appointment_records (
  appointment_id UUID PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  request_key UUID NOT NULL,
  occurred_on DATE NOT NULL,
  occurred_at TIMESTAMPTZ,
  time_precision TEXT NOT NULL CHECK(time_precision IN ('day','exact')),
  source TEXT NOT NULL,
  clinical_minutes INT CHECK(clinical_minutes BETWEEN 1 AND 1440),
  command JSONB NOT NULL,
  recorded_by UUID NOT NULL REFERENCES users(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(patient_id,request_key),
  CHECK((time_precision='exact')=(occurred_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS retrospective_appointments_date ON retrospective_appointment_records(patient_id,occurred_on);
DROP TRIGGER IF EXISTS immutable_retrospective_appointment ON retrospective_appointment_records;
CREATE TRIGGER immutable_retrospective_appointment BEFORE UPDATE ON retrospective_appointment_records
  FOR EACH ROW EXECUTE FUNCTION immutable_clinical_record();
COMMENT ON TABLE retrospective_appointment_records IS 'Already attended appointments entered later; no free historical slot or notification required. Day-only entries have a technical midnight slot, never a claimed clinical time.';
COMMIT;

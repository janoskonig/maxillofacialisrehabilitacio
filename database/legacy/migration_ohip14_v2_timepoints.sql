-- Migration: OHIP-14 timepoint redesign (T0/T1/T2/T3)
-- T0: protetikai fázis előtt (STAGE_0..STAGE_4)
-- T1: átadás (STAGE_6) után 3-8 hét
-- T2: átadás után 5-8 hónap
-- T3: átadás után 2.5-4 év
--
-- Run with: psql -d <db> -f database/migration_ohip14_v2_timepoints.sql

BEGIN;

-- 1) Widen timepoint CHECK constraint to allow 'T3'
ALTER TABLE ohip14_responses DROP CONSTRAINT IF EXISTS ohip14_responses_timepoint_check;
ALTER TABLE ohip14_responses ADD CONSTRAINT ohip14_responses_timepoint_check
    CHECK (timepoint IN ('T0', 'T1', 'T2', 'T3'));

-- 2) Update comment
COMMENT ON COLUMN ohip14_responses.timepoint IS
    'Timepoint: T0 (protetikai fázis előtt), T1 (átadás +1 hó), T2 (átadás +6 hó), T3 (átadás +3 év)';

-- 3) Reminder log for weekly OHIP email notifications
CREATE TABLE IF NOT EXISTS ohip_reminder_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    episode_id UUID,
    timepoint VARCHAR(2) NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    email_to VARCHAR(255) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ohip_reminder_log_patient
    ON ohip_reminder_log (patient_id, timepoint, sent_at DESC);

COMMENT ON TABLE ohip_reminder_log IS 'Log of OHIP-14 email reminders sent to patients (weekly cadence)';

COMMIT;

-- Migration 023: Audit log for Phase 6b remediation (constraint violations / unlink decisions).

BEGIN;

CREATE TABLE IF NOT EXISTS appointment_plan_link_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL,
  plan_item_id UUID,
  action TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_appointment_plan_link_audit_appt
  ON appointment_plan_link_audit (appointment_id);

CREATE INDEX IF NOT EXISTS idx_appointment_plan_link_audit_plan_item
  ON appointment_plan_link_audit (plan_item_id);

COMMENT ON TABLE appointment_plan_link_audit IS 'Deterministic remediation log before UNIQUE(plan_item_id) on appointments.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'appointments'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_appointment_plan_link_audit_appointment'
  ) THEN
    ALTER TABLE appointment_plan_link_audit
      ADD CONSTRAINT fk_appointment_plan_link_audit_appointment
      FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_appointment_plan_link_audit_plan_item'
  ) THEN
    ALTER TABLE appointment_plan_link_audit
      ADD CONSTRAINT fk_appointment_plan_link_audit_plan_item
      FOREIGN KEY (plan_item_id) REFERENCES episode_plan_items (id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;

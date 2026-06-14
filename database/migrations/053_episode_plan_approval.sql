BEGIN;

-- WP3: explicit "kezelési terv jóváhagyva / foglalásra kész" mérföldkő az epizódon.
-- A terv-validáció (lib/treatment-plan-validation.ts) error-mentessége után az
-- orvos jóváhagyhatja a tervet; innen tudjuk, hogy a lépések foglalhatók.
-- Mindkét mező NULL = a terv még nincs jóváhagyva.

ALTER TABLE patient_episodes
  ADD COLUMN IF NOT EXISTS plan_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_approved_by UUID REFERENCES users (id) ON DELETE SET NULL;

COMMIT;

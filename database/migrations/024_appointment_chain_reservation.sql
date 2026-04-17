-- Chain batch bookings (convert-all-intents) use is_chain_reservation=true so multiple future
-- work appointments are allowed without requires_precommit workarounds. Partial unique index
-- idx_appointments_one_hard_next applies only to non-chain rows.

BEGIN;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS is_chain_reservation BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN appointments.is_chain_reservation IS
  'True when created via batch chain booking; excluded from one-hard-next partial unique index.';

DROP INDEX IF EXISTS idx_appointments_one_hard_next;

CREATE UNIQUE INDEX idx_appointments_one_hard_next ON appointments (episode_id)
WHERE episode_id IS NOT NULL
  AND pool = 'work'
  AND is_future = true
  AND is_active_status = true
  AND requires_precommit = false
  AND is_chain_reservation = false;

COMMIT;

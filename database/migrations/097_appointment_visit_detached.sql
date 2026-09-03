BEGIN;

-- 097: „A terv rácsúszik a foglalt időpontokra" (WP-6.5) — a kézzel leválasztott
-- foglalás jelölője.
--
-- Az epizód alkalom nélküli, nyitott, jövőbeli foglalásai (a naptárból / worklistből
-- fázis nélkül foglalt időpontok) mostantól automatikusan a tervezett alkalmakra
-- csúsznak (lib/visit-appointment-sync.ts slidePlanOntoAppointments). Hogy az
-- „Időpont leválasztása (megmarad)" művelet értelmes maradjon, a leválasztott
-- foglalást meg kell jelölni: ezt az automatikus rácsúszás kihagyja, a kézi
-- hozzárendelés (attach) pedig törli a jelölőt. Idempotens.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS visit_detached_at TIMESTAMPTZ;

COMMENT ON COLUMN appointments.visit_detached_at IS
  'Az alkalomról kézzel leválasztott foglalás (WP-6.5). NULL = a terv automatikus rácsúszása felveheti; nem NULL = csak kézzel rendelhető alkalomhoz (attach törli).';

COMMIT;

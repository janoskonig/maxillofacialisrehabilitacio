BEGIN;

-- 094: Az alkalom („vizit") birtokolja a foglalást — „az időpontfoglalás a váz,
-- a tartalom a kezelési terv".
--
-- Eddig a foglalás a munkafázishoz kötődött (episode_work_phases.appointment_id
-- ↔ appointments.work_phase_id), ezért a fázis mozgatása a foglalást is vitte,
-- az üres alkalom pedig megszűnt. Mostantól:
--   • episode_visits.appointment_id = az alkalom időpontja (a váz). A tartalom
--     (fázisok) mozgatása nem viszi magával; az alkalom nyitott fázisai egy
--     blokk (primary + összevont tagok), a primary hordozza a fázis-szintű
--     linket a régi motorok (worklist, státusz-átmenet) miatt.
--   • Üres alkalom soha nem törlődik automatikusan; üres, de foglalt alkalom =
--     időpont tartalom nélkül.
--   • Backfill: az alkalom a tagjai közül a legkorábbi aktív foglalást örökli.
-- Idempotens.

ALTER TABLE episode_visits
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_episode_visits_appointment
  ON episode_visits (appointment_id) WHERE appointment_id IS NOT NULL;

COMMENT ON COLUMN episode_visits.appointment_id IS
  'Az alkalom időpontja (a váz). A fázisok a tartalom; a primary fázis hordozza a fázis-szintű linket. NULL = még nincs időpont.';

UPDATE episode_visits v
SET appointment_id = sub.appointment_id
FROM (
  SELECT DISTINCT ON (e.visit_id) e.visit_id, e.appointment_id
  FROM episode_work_phases e
  JOIN appointments a ON a.id = e.appointment_id
  WHERE e.visit_id IS NOT NULL
    AND (a.appointment_status IS NULL
         OR a.appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient', 'no_show', 'unsuccessful'))
  ORDER BY e.visit_id, a.start_time NULLS LAST, COALESCE(e.seq, e.pathway_order_index), e.id
) sub
WHERE v.id = sub.visit_id AND v.appointment_id IS NULL;

COMMIT;

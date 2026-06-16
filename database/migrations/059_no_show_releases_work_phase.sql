-- 059_no_show_releases_work_phase.sql
--
-- Bug: egy `no_show` (a beteg nem jött el) appointment NEM volt újrafoglalható.
-- A `idx_appointments_unique_work_phase_active` parciális unique index (025 →
-- 029) a `no_show`-t AKTÍV foglalásnak tekintette (csak a cancelled_* és az
-- unsuccessful volt kizárva), így a fázis ismételt foglalása ugyanazzal a
-- `work_phase_id`-vel `WORK_PHASE_ALREADY_BOOKED (409)` hibával elbukott.
--
-- Ez ellentmondott:
--   • az attempt-számlálásnak (lib/appointment-attempts.ts), amely a `no_show`-t
--     KIFEJEZETTEN valós próbaként tartja nyilván (completed/unsuccessful/no_show),
--   • a worklist előzmény-renderelésnek (lib/worklist-prior-attempts.ts), amely a
--     no_show-t korábbi próbaként mutatja — vagyis egy retry-t feltételez.
--
-- Javítás: a `no_show` is "felszabadító" státusz a work_phase egyediségi index
-- szempontjából (mint az `unsuccessful`). A SLOT elhasználva marad (a státusz-
-- route a no_show-ra szándékosan nem szabadítja fel a slotot — a beteg ideje
-- "elkelt"), de a kezelési LÉPÉS foglalható egy új próbára egy másik slotra.
--
-- Tükrözi: lib/active-appointment.ts (SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT és
-- STEP_RELEASING_APPOINTMENT_STATUSES). A work-phase-index-parity tesztek
-- (unit + integration) ellenőrzik, hogy a kettő egyezzen.
--
-- Idempotens: DROP IF EXISTS + feltételes CREATE (csak ha létezik a work_phase_id
-- oszlop, azaz a 025 lefutott). A bővítés szigorúan KEVESEBB sort indexel, így
-- meglévő adaton nem hozhat létre új ütközést.

BEGIN;

DROP INDEX IF EXISTS idx_appointments_unique_work_phase_active;
DO $idx$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appointments'
      AND column_name = 'work_phase_id'
  ) THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX idx_appointments_unique_work_phase_active
        ON appointments (work_phase_id)
        WHERE work_phase_id IS NOT NULL
          AND (
            appointment_status IS NULL
            OR appointment_status NOT IN (
              'cancelled_by_doctor', 'cancelled_by_patient', 'no_show', 'unsuccessful'
            )
          )
    $sql$;
  END IF;
END $idx$;

COMMIT;

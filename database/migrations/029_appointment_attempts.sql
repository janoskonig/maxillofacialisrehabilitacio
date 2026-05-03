-- Migration 029: Appointment attempts (sikertelen próba + ismétlés).
--
-- Háttér
-- ------
-- Klinikai igény: egy munkafázis (pl. lenyomatvétel) első próbálkozása nem
-- mindig sikeres (rossz lenyomat, beteg nem tűrte, labor visszaszól, stb.).
-- Eddig erre csak két körülményes mód volt:
--   1) az appointment-et "completed"-nek jelölni, majd a munkafázist
--      "újranyitni" (PATCH ... { status: 'pending', reason: ... }), VAGY
--   2) az appointment-et cancellelni, és újat foglalni — ami eltünteti az
--      eredeti próbát az audit-ból.
--
-- Ezzel a migrációval bevezetjük az "ismételhető próba" modellt:
--   • Új `appointment_status = 'unsuccessful'` érték — a vizit megtörtént,
--     de a klinikai cél nem teljesült. NEM cancelled (a slot elkelt), de
--     NEM is "active" a munkafázis-foglaltsági szempontból: új próba
--     foglalható ugyanarra a step_code-ra.
--   • `appointments.attempt_number` — hányadik próbálkozás ez a step-en
--     (1-től kezdve). Új foglaláskor a `lib/appointment-service.ts` és a
--     `lib/convert-slot-intent.ts` automatikusan számolja a max + 1-et.
--   • `attempt_failed_reason` / `attempt_failed_at` / `attempt_failed_by` —
--     audit a sikertelenné jelöléshez (kötelező indok, későbbi elemzéshez).
--
-- Forward / backward compat
-- -------------------------
-- • A meglévő `appointments_appointment_status_check` CHECK constraint-et
--   bővítjük (5 érték + NULL), idempotensen — a 026 mintáját követve.
-- • A meglévő `idx_appointments_unique_pending_step` partial unique index
--   csak a NULL státuszú rows-okra hat — `unsuccessful` (non-null) nem
--   ütközik, új pending foglalás létrehozható mellette.
-- • A `idx_appointments_unique_work_phase_active` (025-ből) viszont a
--   "non-cancelled" rows-okra fog. Ezt a 029-ben módosítjuk, hogy a
--   `unsuccessful` is "felszabadítsa" a work_phase_id slotot.
-- • A `is_active_status` materializált oszlop és trigger meghagyva — a
--   `appointment_status = 'unsuccessful'` esetén false lesz (mert csak
--   NULL és 'completed' számít aktívnak ott), ami pontosan jó nekünk a
--   one-hard-next index szempontjából.
-- • Backfill: minden meglévő appointment `attempt_number = 1`.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Új oszlopok az `appointments` táblán.
-- -----------------------------------------------------------------------------
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS attempt_number INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS attempt_failed_reason TEXT,
  ADD COLUMN IF NOT EXISTS attempt_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_failed_by VARCHAR(255);

COMMENT ON COLUMN appointments.attempt_number IS
  'Hányadik próbálkozás ez a (episode_id, step_code) párra. Az első foglalás 1, minden további új próba +1. A lib/appointment-service.ts és lib/convert-slot-intent.ts számolja max(attempt_number)+1 alapján.';
COMMENT ON COLUMN appointments.attempt_failed_reason IS
  'Ha kitöltött, a próba sikertelen volt — `appointment_status = ''unsuccessful''` mellett kötelező. Későbbi klinikai elemzéshez (gyakori sikertelenségi okok).';
COMMENT ON COLUMN appointments.attempt_failed_at IS
  'Mikor jelölte sikertelennek — audit log.';
COMMENT ON COLUMN appointments.attempt_failed_by IS
  'Ki jelölte sikertelennek (felhasználó email-je) — audit log.';

-- -----------------------------------------------------------------------------
-- 2) CHECK constraint kiterjesztése: új 'unsuccessful' érték.
--    A 026 mintát követjük: idempotens, név-stabil, NULL-t explicit engedi.
--    Idempotens módon kezeli a régi (név-bizonytalan) status-checkeket is.
-- -----------------------------------------------------------------------------
DO $assert_status_check$
DECLARE
  has_extended_constraint BOOLEAN;
  bad_row_count INT;
  legacy_constraint RECORD;
BEGIN
  -- Van-e már a constraint, ami az 'unsuccessful' értéket is tartalmazza?
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'appointments'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%appointment_status%'
      AND pg_get_constraintdef(c.oid) ILIKE '%unsuccessful%'
      AND c.convalidated = true
  ) INTO has_extended_constraint;

  IF has_extended_constraint THEN
    RAISE NOTICE '[029] appointment_status CHECK already includes ''unsuccessful'' — no-op.';
  ELSE
    -- A nem-canonical (régi vagy új ismeretlen) értékeket szűrjük előbb:
    -- a 'unsuccessful' új érték, eddig egyetlen rowsban sem szerepelhetett.
    SELECT COUNT(*) INTO bad_row_count
    FROM appointments
    WHERE appointment_status IS NOT NULL
      AND appointment_status NOT IN (
        'cancelled_by_doctor', 'cancelled_by_patient', 'completed', 'no_show', 'unsuccessful'
      );

    IF bad_row_count > 0 THEN
      RAISE EXCEPTION
        '[029] Cannot extend CHECK constraint: % rows have appointment_status outside the new canonical taxonomy. Run /api/admin/booking-consistency to identify them, then re-run.',
        bad_row_count;
    END IF;

    -- Drop minden meglévő appointment_status-ra vonatkozó CHECK constraint-et
    -- (név-bizonytalanság miatt: a 026 `appointments_appointment_status_check`
    -- néven hozta létre, de régebbi deployments más néven hordozhatják).
    FOR legacy_constraint IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'appointments'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ILIKE '%appointment_status%'
        AND pg_get_constraintdef(c.oid) ILIKE '%cancelled_by_doctor%'
    LOOP
      EXECUTE format('ALTER TABLE appointments DROP CONSTRAINT %I', legacy_constraint.conname);
      RAISE NOTICE '[029] Dropped legacy status check: %', legacy_constraint.conname;
    END LOOP;

    -- Új canonical constraint, validated.
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_appointment_status_check
      CHECK (
        appointment_status IS NULL
        OR appointment_status IN (
          'cancelled_by_doctor', 'cancelled_by_patient', 'completed', 'no_show', 'unsuccessful'
        )
      );
    RAISE NOTICE '[029] Added appointments_appointment_status_check with ''unsuccessful''.';
  END IF;
END $assert_status_check$;

-- -----------------------------------------------------------------------------
-- 3) `idx_appointments_unique_work_phase_active` kibővítése — `unsuccessful`
--    is "felszabadító" státusz (ne számítson aktív foglalásnak a work_phase
--    egyediségi index szempontjából, hogy új próba foglalható legyen).
-- -----------------------------------------------------------------------------
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
              'cancelled_by_doctor', 'cancelled_by_patient', 'unsuccessful'
            )
          )
    $sql$;
  END IF;
END $idx$;

-- -----------------------------------------------------------------------------
-- 4) Index a próba-történet gyors lekérdezéséhez (audit / UI badge).
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_appointments_attempts_per_step
  ON appointments (episode_id, step_code, attempt_number)
  WHERE episode_id IS NOT NULL AND step_code IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5) Backfill: a meglévő appointmentek mind 1. próbák.
--    A DEFAULT 1 már gondoskodik az új sorokról; ez csak az `IS NULL`-eket
--    tölti, ha bármi furcsaság történne (pl. trigger nem futott).
-- -----------------------------------------------------------------------------
UPDATE appointments
   SET attempt_number = 1
 WHERE attempt_number IS NULL;

COMMIT;

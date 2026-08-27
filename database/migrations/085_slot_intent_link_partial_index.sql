BEGIN;

-- WP-0.4 (kódaudit #03): az idx_appointments_unique_slot_intent státusz-
-- predikátum nélkül jött létre (database/legacy/migration_intent_appointment_link.sql),
-- így egy halott (lemondott / no-show / sikertelen) appointment sor örökre
-- birtokolta az intentjét. A lemondás/no-show az intentet 'expired'-re
-- állítja, a projektor ugyanazzal az id-vel 'open'-re nyitja vissza — a
-- következő konverzió MÁSIK slotra ekkor 23505-tel hasalt, amit a rendszer
-- INTENT_ALREADY_CONVERTED 409-ként adott vissza. (Ugyanarra a slotra a
-- visszafoglalás működött: az INSERT ... ON CONFLICT (time_slot_id) revive
-- ága a régi sort frissíti.)
--
-- Csere partiális unique indexre: az 1 intent ↔ 1 appointment megkötés csak
-- az ÉLŐ (NULL / completed státuszú) sorokra áll fenn. A halott státuszok
-- halmaza a kanonikus STEP_RELEASING_APPOINTMENT_STATUSES
-- (lib/active-appointment.ts) tükre. Az index neve változatlan, mert a
-- lib/appointment-constraint-errors.ts fordítója név szerint hivatkozik rá.
--
-- Futásidőben a lemondás/no-show/sikertelen/skip/törlés ágak mostantól
-- appointments.slot_intent_id = NULL-t is írnak; ez az index a MÁR MEGLÉVŐ
-- halott sorok linkjei ellen véd (azokat nem backfilleljük NULL-ra, hogy a
-- történeti provenance megmaradjon).
--
-- Idempotens: DROP IF EXISTS + CREATE IF NOT EXISTS — párhuzamos teszt-DB
-- futtatás / újrafuttatás ellen.

DROP INDEX IF EXISTS idx_appointments_unique_slot_intent;

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_unique_slot_intent
  ON appointments (slot_intent_id)
  WHERE slot_intent_id IS NOT NULL
    AND (
      appointment_status IS NULL
      OR appointment_status NOT IN (
        'cancelled_by_doctor',
        'cancelled_by_patient',
        'no_show',
        'unsuccessful'
      )
    );

COMMIT;

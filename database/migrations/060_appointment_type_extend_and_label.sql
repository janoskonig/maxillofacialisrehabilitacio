-- 060_appointment_type_extend_and_label.sql
--
-- A "Mai időpontok" dashboard-widget bővítéséhez: az időpont típusa eddig csak
-- ('elso_konzultacio','munkafazis','kontroll') lehetett (legacy
-- migration_appointments_type.sql CHECK constraintje). Kibővítjük 'recall' és
-- 'egyeb' típusokkal, és hozzáadunk egy szabad szöveges `type_label` oszlopot a
-- catch-all címkéhez (pl. „implantátum kontroll 6h”), hogy a konzultáció / recall
-- / egyéb (nem terv-lépés) időpontok is megjelölhetők legyenek.
--
-- Idempotens: a típus-CHECK-et NÉVRŐL nem ismerjük biztosan (a legacy nem
-- nevezte el determinisztikusan), ezért az appointment_type-ra hivatkozó ÖSSZES
-- CHECK-et eldobjuk, majd egy fix nevűt hozunk létre a bővebb halmazzal. A
-- bővítés szigorúan TÖBB értéket enged, így meglévő soron nem bukhat el. A
-- type_label IF NOT EXISTS-szel jön.

BEGIN;

DO $do$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'appointments'
      AND nsp.nspname = 'public'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%appointment_type%'
  LOOP
    EXECUTE format('ALTER TABLE appointments DROP CONSTRAINT %I', c);
  END LOOP;
END $do$;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_appointment_type_check
  CHECK (appointment_type IN ('elso_konzultacio', 'munkafazis', 'kontroll', 'recall', 'egyeb'));

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS type_label VARCHAR(120);

COMMENT ON COLUMN appointments.type_label IS
  'Szabad szöveges címke az időpont típusához (catch-all, főleg appointment_type=egyeb/recall esetén), pl. „implantátum kontroll 6h”.';

COMMIT;

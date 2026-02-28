-- Migration: Diagnosztikai script a lemondott időpontok újrafoglalási konfliktusokhoz
-- Ez a script azonosítja azokat a cancelled appointmenteket, ahol a time_slot available státuszú
-- Run with: psql -d <db> -f database/migration_fix_cancelled_appointments_rebooking.sql

-- Diagnosztikai lekérdezés: cancelled appointmentek, ahol a time_slot available
-- Ezek a rekordok okozhatnak konfliktust újrafoglaláskor a UNIQUE(time_slot_id) constraint miatt
SELECT 
    a.id as appointment_id,
    a.patient_id,
    a.time_slot_id,
    a.appointment_status,
    a.created_by,
    a.created_at as appointment_created_at,
    a.completion_notes,
    ats.status as time_slot_status,
    ats.start_time,
    p.nev as patient_name,
    p.taj as patient_taj
FROM appointments a
JOIN available_time_slots ats ON a.time_slot_id = ats.id
LEFT JOIN patients p ON a.patient_id = p.id
WHERE a.appointment_status IN ('cancelled_by_patient', 'cancelled_by_doctor')
  AND ats.status = 'available'
  AND ats.start_time > NOW() -- Csak jövőbeli időpontokat
ORDER BY ats.start_time ASC;

-- Összesítő: hány ilyen rekord van
SELECT 
    COUNT(*) as total_conflicting_records,
    COUNT(DISTINCT a.patient_id) as affected_patients,
    COUNT(DISTINCT ats.user_id) as affected_dentists
FROM appointments a
JOIN available_time_slots ats ON a.time_slot_id = ats.id
WHERE a.appointment_status IN ('cancelled_by_patient', 'cancelled_by_doctor')
  AND ats.status = 'available'
  AND ats.start_time > NOW();

-- Megjegyzés: 
-- Az UPSERT logika (INSERT ... ON CONFLICT DO UPDATE WHERE cancelled) automatikusan
-- kezeli ezeket a rekordokat újrafoglaláskor. Ez a script csak diagnosztikai célokat szolgál.

-- ===================================================================
-- CLEANUP: Törli a konfliktusos cancelled appointmenteket
-- ===================================================================
-- Figyelem: Ez a művelet VISSZAVONHATATLAN!
-- Csak akkor futtasd, ha biztos vagy benne, hogy ezek a rekordok
-- valóban konfliktusosak és törölhetők.
-- ===================================================================

BEGIN;

-- Törlés előtt: logoljuk, hogy mit törlünk (opcionális, de ajánlott)
CREATE TABLE IF NOT EXISTS deleted_appointments_log AS
SELECT 
    a.*,
    CURRENT_TIMESTAMP as deleted_at
FROM appointments a
JOIN available_time_slots ats ON a.time_slot_id = ats.id
WHERE a.appointment_status IN ('cancelled_by_patient', 'cancelled_by_doctor')
  AND ats.status = 'available'
  AND ats.start_time > NOW();

-- Töröljük a konfliktusos cancelled appointmenteket
-- Ezek a rekordok blokkolják az újrafoglalást, mert a time_slot available,
-- de az appointments táblában még mindig ott van a cancelled rekord
DELETE FROM appointments
WHERE id IN (
    SELECT a.id
    FROM appointments a
    JOIN available_time_slots ats ON a.time_slot_id = ats.id
    WHERE a.appointment_status IN ('cancelled_by_patient', 'cancelled_by_doctor')
      AND ats.status = 'available'
      AND ats.start_time > NOW()
);

-- Ellenőrzés: hány rekordot töröltünk
DO $$
DECLARE
    deleted_count INTEGER;
BEGIN
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Törölt konfliktusos cancelled appointmentek száma: %', deleted_count;
END $$;

COMMIT;

-- Visszaigazolás: ellenőrizzük, hogy nincs-e már konfliktusos rekord
SELECT 
    COUNT(*) as remaining_conflicting_records
FROM appointments a
JOIN available_time_slots ats ON a.time_slot_id = ats.id
WHERE a.appointment_status IN ('cancelled_by_patient', 'cancelled_by_doctor')
  AND ats.status = 'available'
  AND ats.start_time > NOW();
-- Ennek 0-nak kell lennie a cleanup után

-- ===================================================================
-- CLEANUP: Törli a konfliktusos cancelled appointmenteket
-- ===================================================================
-- Figyelem: Ez a művelet VISSZAVONHATATLAN!
-- Csak akkor futtasd, ha biztos vagy benne, hogy ezek a rekordok
-- valóban konfliktusosak és törölhetők.
-- ===================================================================

BEGIN;

-- Törlés előtt: logoljuk, hogy mit törlünk (opcionális, de ajánlott)
-- CREATE TABLE IF NOT EXISTS deleted_appointments_log AS
-- SELECT 
--     a.*,
--     CURRENT_TIMESTAMP as deleted_at
-- FROM appointments a
-- JOIN available_time_slots ats ON a.time_slot_id = ats.id
-- WHERE a.appointment_status IN ('cancelled_by_patient', 'cancelled_by_doctor')
--   AND ats.status = 'available'
--   AND ats.start_time > NOW();

-- Töröljük a konfliktusos cancelled appointmenteket
-- Ezek a rekordok blokkolják az újrafoglalást, mert a time_slot available,
-- de az appointments táblában még mindig ott van a cancelled rekord
DELETE FROM appointments
WHERE id IN (
    SELECT a.id
    FROM appointments a
    JOIN available_time_slots ats ON a.time_slot_id = ats.id
    WHERE a.appointment_status IN ('cancelled_by_patient', 'cancelled_by_doctor')
      AND ats.status = 'available'
      AND ats.start_time > NOW()
);

-- Ellenőrzés: hány rekordot töröltünk
DO $$
DECLARE
    deleted_count INTEGER;
BEGIN
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Törölt konfliktusos cancelled appointmentek száma: %', deleted_count;
END $$;

COMMIT;

-- Visszaigazolás: ellenőrizzük, hogy nincs-e már konfliktusos rekord
SELECT 
    COUNT(*) as remaining_conflicting_records
FROM appointments a
JOIN available_time_slots ats ON a.time_slot_id = ats.id
WHERE a.appointment_status IN ('cancelled_by_patient', 'cancelled_by_doctor')
  AND ats.status = 'available'
  AND ats.start_time > NOW();
-- Ennek 0-nak kell lennie a cleanup után

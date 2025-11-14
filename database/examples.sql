-- ===================================================================
-- SQL Példák - Maxillofacialis Rehabilitáció Betegadat Kezelő
-- ===================================================================
-- Gyakori műveletek példái az adatbázis használatához
-- ===================================================================

-- ===================================================================
-- BESZÚRÁSOK (INSERT)
-- ===================================================================

-- Új beteg hozzáadása (egyszerűsített séma esetén)
INSERT INTO patients (
    nev,
    taj,
    telefonszam,
    szuletesi_datum,
    nem,
    email,
    cim,
    varos,
    iranyitoszam,
    beutalo_orvos,
    beutalo_intezmeny,
    mutet_rovid_leirasa,
    mutet_ideje,
    radioterapia,
    radioterapia_dozis,
    kezeleoorvos,
    kezeleoorvos_intezete,
    felvetel_datuma,
    meglevo_implantatumok
) VALUES (
    'Nagy János',
    '123456789',
    '+36-30-123-4567',
    '1980-05-15',
    'ferfi',
    'nagy.janos@example.com',
    'Kossuth Lajos út 10.',
    'Budapest',
    '1053',
    'Dr. Kovács Péter',
    'OOI Fej-Nyaki Daganatok Multidiszciplináris Központ',
    'Radikális maxillectomia jobb oldalon',
    '2023-03-20',
    true,
    '60 Gy',
    'Dr. König',
    'Fogpótlástani Klinika',
    '2023-04-15',
    '{"18": "Straumann BLT 4.1x10mm, Gyári szám: 028.015, Dátum: 2023.05.15", "17": "Nobel Biocare 4.0x10mm, Dátum: 2023.06.20"}'::jsonb
);

-- Új beteg hozzáadása (normalizált séma esetén)
INSERT INTO patients (
    nev,
    taj,
    telefonszam,
    szuletesi_datum,
    nem,
    kezeleoorvos,
    felvetel_datuma
) VALUES (
    'Kiss Mária',
    '987654321',
    '+36-70-987-6543',
    '1975-08-22',
    'no',
    'Dr. Kádár',
    '2024-01-10'
) RETURNING id;

-- Implantátum hozzáadása egy beteghez (normalizált séma)
-- Először meg kell találni a beteg ID-ját
INSERT INTO implants (patient_id, fog_szama, reszletek)
VALUES (
    '123e4567-e89b-12d3-a456-426614174000'::uuid,  -- patient_id
    '18',
    'Straumann BLT 4.1x10mm, Gyári szám: 028.015, Dátum: 2023.05.15'
);

-- ===================================================================
-- LEKÉRDEZÉSEK (SELECT)
-- ===================================================================

-- Összes beteg listázása
SELECT * FROM patients ORDER BY created_at DESC;

-- Beteg keresése név szerint
SELECT * FROM patients 
WHERE nev ILIKE '%Nagy%'
ORDER BY nev;

-- Beteg keresése TAJ szám szerint
SELECT * FROM patients 
WHERE taj = '123456789';

-- Beteg keresése kezelőorvos szerint
SELECT 
    nev,
    taj,
    telefonszam,
    kezeleoorvos,
    felvetel_datuma
FROM patients 
WHERE kezeleoorvos = 'Dr. König'
ORDER BY felvetel_datuma DESC;

-- Betegek számának összesítése kezelőorvos szerint
SELECT 
    kezeleoorvos,
    COUNT(*) as beteg_szam
FROM patients
WHERE kezeleoorvos IS NOT NULL
GROUP BY kezeleoorvos
ORDER BY beteg_szam DESC;

-- Betegek, akik radioterápiát kaptak
SELECT 
    nev,
    taj,
    radioterapia_dozis,
    radioterapia_datum_intervallum,
    mutet_ideje
FROM patients
WHERE radioterapia = true
ORDER BY mutet_ideje DESC;

-- Betegek, akiknek van implantátuma egy bizonyos fogban (JSON séma)
SELECT 
    nev,
    meglevo_implantatumok->>'18' as implantatum_18
FROM patients
WHERE meglevo_implantatumok ? '18';

-- Betegek az implantátumaikkal (normalizált séma - view használata)
SELECT * FROM patients_with_implants
WHERE nev ILIKE '%Kiss%';

-- Betegek, akiknek van mandibuladefektusa
SELECT 
    nev,
    kovacs_dobak_osztaly,
    fabian_fejerdy_protetikai_osztaly
FROM patients
WHERE mandibuladefektus_van = true;

-- Statisztikák - havi felvételek száma
SELECT 
    DATE_TRUNC('month', felvetel_datuma) as honap,
    COUNT(*) as felvetel_szam
FROM patients
WHERE felvetel_datuma IS NOT NULL
GROUP BY DATE_TRUNC('month', felvetel_datuma)
ORDER BY honap DESC;

-- ===================================================================
-- FRISSÍTÉSEK (UPDATE)
-- ===================================================================

-- Beteg telefonszámának frissítése
UPDATE patients
SET telefonszam = '+36-30-999-8888',
    updated_at = CURRENT_TIMESTAMP
WHERE id = '123e4567-e89b-12d3-a456-426614174000'::uuid;

-- Implantátum hozzáadása/folytatása egy beteghez (JSON séma)
UPDATE patients
SET meglevo_implantatumok = meglevo_implantatumok || '{"16": "Straumann 4.8x8mm"}'::jsonb
WHERE id = '123e4567-e89b-12d3-a456-426614174000'::uuid;

-- Implantátum részleteinek frissítése (normalizált séma)
UPDATE implants
SET reszletek = 'Straumann BLT 4.1x10mm, Gyári szám: 028.015, Frissített: 2024.01.15'
WHERE patient_id = '123e4567-e89b-12d3-a456-426614174000'::uuid
  AND fog_szama = '18';

-- ===================================================================
-- TÖRLÉSEK (DELETE)
-- ===================================================================

-- Beteg törlése (cascade miatt törlődnek az implantátumai is - normalizált séma)
DELETE FROM patients 
WHERE id = '123e4567-e89b-12d3-a456-426614174000'::uuid;

-- Egy implantátum törlése (normalizált séma)
DELETE FROM implants
WHERE patient_id = '123e4567-e89b-12d3-a456-426614174000'::uuid
  AND fog_szama = '18';

-- Implantátum eltávolítása JSON mezőből (egyszerűsített séma)
UPDATE patients
SET meglevo_implantatumok = meglevo_implantatumok - '18'
WHERE id = '123e4567-e89b-12d3-a456-426614174000'::uuid;

-- ===================================================================
-- ÖSSZETETT LEKÉRDEZÉSEK
-- ===================================================================

-- Betegek listája beutaló intézmény szerint csoportosítva
SELECT 
    beutalo_intezmeny,
    COUNT(*) as beteg_szam,
    STRING_AGG(nev, ', ') as beteg_nevek
FROM patients
WHERE beutalo_intezmeny IS NOT NULL
GROUP BY beutalo_intezmeny
ORDER BY beteg_szam DESC;

-- Betegek, akik 2024-ben lettek felvéve és radioterápiát kaptak
SELECT 
    nev,
    taj,
    felvetel_datuma,
    radioterapia_dozis,
    radioterapia_datum_intervallum
FROM patients
WHERE EXTRACT(YEAR FROM felvetel_datuma) = 2024
  AND radioterapia = true
ORDER BY felvetel_datuma;

-- Betegek, akiknek nincs email címe megadva
SELECT 
    nev,
    telefonszam,
    taj
FROM patients
WHERE email IS NULL OR email = ''
ORDER BY nev;

-- Implantátumok statisztikája (normalizált séma)
SELECT 
    fog_szama,
    COUNT(*) as hasznalat_szama
FROM implants
GROUP BY fog_szama
ORDER BY hasznalat_szama DESC;







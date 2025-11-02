-- ===================================================================
-- CSV-ből adatbázisba migrációs script
-- ===================================================================
-- Használat: Első lépésként készítsen egy CSV fájlt a meglévő adatokból,
-- majd importálja PostgreSQL COPY paranccsal vagy SQL scripttel.
-- ===================================================================

-- TÁBLÁZAT LÉTREHOZÁSA (ha még nem létezik)
-- Futtassa először a schema.sql fájlt!

-- ===================================================================
-- 1. MÓDSZER: PostgreSQL COPY parancs használata
-- ===================================================================
-- Ez a leggyorsabb módszer nagy mennyiségű adat importálásához
-- 
-- Példa használat:
-- \COPY patients (nev, taj, telefonszam, ...) FROM '/path/to/file.csv' 
-- WITH (FORMAT csv, HEADER true, DELIMITER ',');

-- ===================================================================
-- 2. MÓDSZER: SQL INSERT parancsok használata
-- ===================================================================

-- Példa: CSV adatok beszúrása
-- A CSV fájl struktúrájának meg kell egyeznie az adatbázis oszlopneveivel

-- Figyelem: A mezőnevek eltérnek lehetnek a CSV-ben (pl. camelCase)
-- vs az adatbázisban (snake_case). Ezt figyelembe kell venni!

-- Példa INSERT mezőnév konverzióval
INSERT INTO patients (
    id,
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
    szovettani_diagnozis,
    nyaki_blokkdisszekcio,
    alkoholfogyasztas,
    dohanyzas_szam,
    maxilladefektus_van,
    brown_fuggoleges_osztaly,
    brown_vizszintes_komponens,
    mandibuladefektus_van,
    kovacs_dobak_osztaly,
    nyelvmozgasok_akadalyozottak,
    gombocos_beszed,
    nyalmirigy_allapot,
    radioterapia,
    radioterapia_dozis,
    radioterapia_datum_intervallum,
    chemoterapia,
    chemoterapia_leiras,
    fabian_fejerdy_protetikai_osztaly,
    kezeleoorvos,
    kezeleoorvos_intezete,
    felvetel_datuma,
    meglevo_implantatumok,
    nem_ismert_poziciokban_implantatum,
    nem_ismert_poziciokban_implantatum_reszletek,
    created_at,
    updated_at
) VALUES (
    -- id: Ha van CSV-ben, használja, különben NULL (UUID generálódik)
    COALESCE('CSV_ID_HERE'::uuid, generate_uuid()),
    
    -- nev: Kötelező mező
    'CSV_NEV',
    
    -- taj: Opcionális
    NULLIF('CSV_TAJ', ''),
    
    -- telefonszam: Opcionális
    NULLIF('CSV_TELEFONSZAM', ''),
    
    -- szuletesi_datum: Dátum konverzió szükséges
    CASE 
        WHEN 'CSV_SZULETESI_DATUM' = '' THEN NULL
        ELSE 'CSV_SZULETESI_DATUM'::DATE
    END,
    
    -- nem: Enum ellenőrzéssel
    CASE 
        WHEN 'CSV_NEM' IN ('ferfi', 'no', 'nem_ismert') THEN 'CSV_NEM'
        ELSE NULL
    END,
    
    -- email: Opcionális
    NULLIF('CSV_EMAIL', ''),
    
    -- További mezők...
    NULLIF('CSV_CIM', ''),
    NULLIF('CSV_VAROS', ''),
    NULLIF('CSV_IRANYITOSZAM', ''),
    NULLIF('CSV_BEUTALO_ORVOS', ''),
    NULLIF('CSV_BEUTALO_INTEZMENY', ''),
    NULLIF('CSV_MUTET_ROVID_LEIRASA', ''),
    
    -- mutet_ideje: Dátum konverzió
    CASE 
        WHEN 'CSV_MUTET_IDEJE' = '' THEN NULL
        ELSE 'CSV_MUTET_IDEJE'::DATE
    END,
    
    NULLIF('CSV_SZOVETTANI_DIAGNOZIS', ''),
    
    -- nyaki_blokkdisszekcio: Enum ellenőrzés
    CASE 
        WHEN 'CSV_NYAKI_BLOKKDISSZEKCIO' IN ('nem volt', 'volt, egyoldali', 'volt, kétoldali') 
        THEN 'CSV_NYAKI_BLOKKDISSZEKCIO'
        ELSE NULL
    END,
    
    NULLIF('CSV_ALKOHOLFOGYASZTAS', ''),
    NULLIF('CSV_DOHANYZAS_SZAM', ''),
    
    -- Boolean mezők: 'true'/'false' stringből boolean
    CASE 
        WHEN 'CSV_MAXILLADEFEKTUS_VAN' = 'true' THEN true
        WHEN 'CSV_MAXILLADEFEKTUS_VAN' = 'false' THEN false
        ELSE false
    END,
    
    -- Enum mezők ellenőrzéssel
    CASE 
        WHEN 'CSV_BROWN_FUGGOLEGES_OSZTALY' IN ('1', '2', '3', '4') 
        THEN 'CSV_BROWN_FUGGOLEGES_OSZTALY'
        ELSE NULL
    END,
    
    CASE 
        WHEN 'CSV_BROWN_VIZSZINTES_KOMPONENS' IN ('a', 'b', 'c') 
        THEN 'CSV_BROWN_VIZSZINTES_KOMPONENS'
        ELSE NULL
    END,
    
    CASE 
        WHEN 'CSV_MANDIBULADEFEKTUS_VAN' = 'true' THEN true
        WHEN 'CSV_MANDIBULADEFEKTUS_VAN' = 'false' THEN false
        ELSE false
    END,
    
    CASE 
        WHEN 'CSV_KOVACS_DOBAK_OSZTALY' IN ('1', '2', '3', '4', '5') 
        THEN 'CSV_KOVACS_DOBAK_OSZTALY'
        ELSE NULL
    END,
    
    CASE 
        WHEN 'CSV_NYELVMOZGASOK_AKADALYOZOTTAK' = 'true' THEN true
        WHEN 'CSV_NYELVMOZGASOK_AKADALYOZOTTAK' = 'false' THEN false
        ELSE false
    END,
    
    CASE 
        WHEN 'CSV_GOMBOCOS_BESZED' = 'true' THEN true
        WHEN 'CSV_GOMBOCOS_BESZED' = 'false' THEN false
        ELSE false
    END,
    
    CASE 
        WHEN 'CSV_NYALMIRIGY_ALLAPOT' IN ('hiposzaliváció', 'hiperszaliváció') 
        THEN 'CSV_NYALMIRIGY_ALLAPOT'
        ELSE NULL
    END,
    
    CASE 
        WHEN 'CSV_RADIOTERAPIA' = 'true' THEN true
        WHEN 'CSV_RADIOTERAPIA' = 'false' THEN false
        ELSE false
    END,
    
    NULLIF('CSV_RADIOTERAPIA_DOZIS', ''),
    NULLIF('CSV_RADIOTERAPIA_DATUM_INTERVALLUM', ''),
    
    CASE 
        WHEN 'CSV_CHEMOTERAPIA' = 'true' THEN true
        WHEN 'CSV_CHEMOTERAPIA' = 'false' THEN false
        ELSE false
    END,
    
    NULLIF('CSV_CHEMOTERAPIA_LEIRAS', ''),
    
    CASE 
        WHEN 'CSV_FABIAN_FEJERDY_PROTETIKAI_OSZTALY' IN ('0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T') 
        THEN 'CSV_FABIAN_FEJERDY_PROTETIKAI_OSZTALY'
        ELSE NULL
    END,
    
    NULLIF('CSV_KEZELEOORVOS', ''),
    NULLIF('CSV_KEZELEOORVOS_INTEZETE', ''),
    
    CASE 
        WHEN 'CSV_FELVETEL_DATUMA' = '' THEN NULL
        ELSE 'CSV_FELVETEL_DATUMA'::DATE
    END,
    
    -- meglevo_implantatumok: JSON stringből JSONB
    CASE 
        WHEN 'CSV_MEGLEVO_IMPLANTATUMOK' = '' OR 'CSV_MEGLEVO_IMPLANTATUMOK' IS NULL 
        THEN '{}'::jsonb
        ELSE 'CSV_MEGLEVO_IMPLANTATUMOK'::jsonb
    END,
    
    CASE 
        WHEN 'CSV_NEM_ISMERT_POZICIOKBAN_IMPLANTATUM' = 'true' THEN true
        WHEN 'CSV_NEM_ISMERT_POZICIOKBAN_IMPLANTATUM' = 'false' THEN false
        ELSE false
    END,
    
    NULLIF('CSV_NEM_ISMERT_POZICIOKBAN_IMPLANTATUM_RESZLETEK', ''),
    
    -- Timestamps
    CASE 
        WHEN 'CSV_CREATED_AT' = '' THEN CURRENT_TIMESTAMP
        ELSE 'CSV_CREATED_AT'::TIMESTAMP WITH TIME ZONE
    END,
    
    CASE 
        WHEN 'CSV_UPDATED_AT' = '' THEN CURRENT_TIMESTAMP
        ELSE 'CSV_UPDATED_AT'::TIMESTAMP WITH TIME ZONE
    END
);

-- ===================================================================
-- 3. MÓDSZER: Python/Node.js script használata ajánlott
-- ===================================================================
-- A legjobb módszer egy kis script írása, ami:
-- 1. Beolvassa a CSV fájlt
-- 2. Feldolgozza az adatokat (mezőnév konverzió, típus konverzió)
-- 3. Beszúrja az adatbázisba batch-ekben
-- 
-- Példa Node.js script lásd: scripts/import_csv_to_db.js (ha létezik)

-- ===================================================================
-- HASZNOS TÉNYEZŐK
-- ===================================================================

-- 1. Ellenőrizze, hogy a CSV oszlopnevei megfelelnek-e az adatbázis oszlopneveinek
-- 2. Dátum mezők formátuma legyen: YYYY-MM-DD
-- 3. Boolean értékek legyenek: 'true' vagy 'false' stringként
-- 4. JSON mezők legyenek érvényes JSON stringként
-- 5. Üres stringek NULL-ra konvertálása: NULLIF(field, '')

-- ===================================================================
-- ADATOK ELLENŐRZÉSE
-- ===================================================================

-- A migráció után ellenőrizze az adatokat:
SELECT COUNT(*) as total_patients FROM patients;

SELECT 
    COUNT(*) FILTER (WHERE nev IS NOT NULL) as with_name,
    COUNT(*) FILTER (WHERE taj IS NOT NULL) as with_taj,
    COUNT(*) FILTER (WHERE meglevo_implantatumok != '{}'::jsonb) as with_implants
FROM patients;

-- Duplikátumok keresése (ha van ID a CSV-ben)
SELECT id, COUNT(*) 
FROM patients 
GROUP BY id 
HAVING COUNT(*) > 1;


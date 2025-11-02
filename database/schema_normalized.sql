-- ===================================================================
-- Maxillofacialis Rehabilitáció - Betegadat Adatbázis Séma (Normalizált)
-- ===================================================================
-- PostgreSQL adatbázis táblák létrehozása normalizált struktúrával
-- Ez a verzió külön táblát használ az implantátumokhoz
-- ===================================================================

-- UUID generáláshoz szükséges bővítmény bekapcsolása
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION WHEN OTHERS THEN
    BEGIN
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Nem sikerült UUID bővítményt betölteni.';
    END;
END
$$;

-- Helper függvény UUID generáláshoz
CREATE OR REPLACE FUNCTION generate_uuid()
RETURNS UUID AS $$
BEGIN
    BEGIN
        RETURN gen_random_uuid();
    EXCEPTION WHEN OTHERS THEN
        BEGIN
            RETURN uuid_generate_v4();
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Egyik UUID generáló függvény sem érhető el.';
        END;
    END;
END;
$$ LANGUAGE plpgsql;

-- Betegek főtáblája
CREATE TABLE IF NOT EXISTS patients (
    -- Egyedi azonosító
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    
    -- ALAPADATOK
    nev VARCHAR(255),  -- Név (opcionális)
    taj VARCHAR(20),            -- TAJ szám
    telefonszam VARCHAR(50),    -- Telefonszám
    
    -- SZEMÉLYES ADATOK
    szuletesi_datum DATE,       -- Születési dátum
    nem VARCHAR(10) CHECK (nem IN ('ferfi', 'no', 'nem_ismert')),  -- Nem
    email VARCHAR(255),         -- Email cím
    cim TEXT,                   -- Cím
    varos VARCHAR(100),         -- Város
    iranyitoszam VARCHAR(10),   -- Irányítószám
    
    -- BEUTALÓ ADATOK
    beutalo_orvos VARCHAR(255),        -- Beutaló orvos neve
    beutalo_intezmeny VARCHAR(255),   -- Beutaló intézmény
    mutet_rovid_leirasa TEXT,          -- Műtét rövid leírása
    mutet_ideje DATE,                  -- Műtét ideje
    szovettani_diagnozis TEXT,        -- Szövettani diagnózis
    nyaki_blokkdisszekcio VARCHAR(50) CHECK (nyaki_blokkdisszekcio IN ('nem volt', 'volt, egyoldali', 'volt, kétoldali')),  -- Nyaki blokkdisszekció
    
    -- ADJUVÁNS TERÁPIÁK
    radioterapia BOOLEAN DEFAULT false,               -- Radioterápia volt-e
    radioterapia_dozis VARCHAR(50),                   -- Radioterápia dózis (n Gy)
    radioterapia_datum_intervallum VARCHAR(100),      -- Radioterápia dátumintevallum
    chemoterapia BOOLEAN DEFAULT false,                -- Kemoterápia volt-e
    chemoterapia_leiras TEXT,                          -- Kemoterápia részletes leírás
    
    -- REHABILITÁCIÓS ADATOK - ANAMNÉZIS ÉS BETEGVIZSGÁLAT
    alkoholfogyasztas TEXT,                                    -- Alkoholfogyasztás
    dohanyzas_szam VARCHAR(50),                                -- Dohányzás (n szál/nap)
    maxilladefektus_van BOOLEAN DEFAULT false,                 -- Maxilladefektus van
    brown_fuggoleges_osztaly VARCHAR(1) CHECK (brown_fuggoleges_osztaly IN ('1', '2', '3', '4')),  -- Brown-féle klasszifikáció - függőleges komponens
    brown_vizszintes_komponens VARCHAR(1) CHECK (brown_vizszintes_komponens IN ('a', 'b', 'c')),    -- Brown - vízszintes/palatinalis komponens
    mandibuladefektus_van BOOLEAN DEFAULT false,               -- Mandibuladefektus van
    kovacs_dobak_osztaly VARCHAR(1) CHECK (kovacs_dobak_osztaly IN ('1', '2', '3', '4', '5')),    -- Kovács-Dobák osztályozás
    nyelvmozgasok_akadalyozottak BOOLEAN DEFAULT false,        -- Nyelvmozgások akadályozottak
    gombocos_beszed BOOLEAN DEFAULT false,                     -- Gombócos beszéd
    nyalmirigy_allapot VARCHAR(20) CHECK (nyalmirigy_allapot IN ('hiposzaliváció', 'hiperszaliváció')),  -- Nyálmirigy állapot
    fabian_fejerdy_protetikai_osztaly VARCHAR(10) CHECK (fabian_fejerdy_protetikai_osztaly IN ('0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T')),  -- Fábián- és Fejérdy-féle protetikai osztály
    kezeleoorvos VARCHAR(100),                                  -- Kezelőorvos
    kezeleoorvos_intezete VARCHAR(255),                        -- Kezelőorvos intézete
    felvetel_datuma DATE,                                       -- Felvétel dátuma
    
    -- IMPLANTÁTUMOK - NEM ISMERT POZÍCIÓK
    nem_ismert_poziciokban_implantatum BOOLEAN DEFAULT false,  -- Nem ismert pozíciókban implantátum
    nem_ismert_poziciokban_implantatum_reszletek TEXT,         -- Nem ismert pozíciókban implantátum részletek
    
    -- TIMESTAMPS
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,  -- Létrehozás dátuma
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP   -- Frissítés dátuma
);

-- Implantátumok táblája (normalizált)
CREATE TABLE IF NOT EXISTS implants (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    fog_szama VARCHAR(10) NOT NULL,              -- Fog száma (Zsigmondy-kereszt)
    reszletek TEXT,                               -- Implantátum részletei (típus, gyári szám, dátum, stb.)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Egy betegnek nem lehet két ugyanolyan fogon implantátuma
    UNIQUE(patient_id, fog_szama)
);

-- Indexek a patients táblán
CREATE INDEX IF NOT EXISTS idx_patients_nev ON patients(nev);
CREATE INDEX IF NOT EXISTS idx_patients_taj ON patients(taj);
CREATE INDEX IF NOT EXISTS idx_patients_email ON patients(email);
CREATE INDEX IF NOT EXISTS idx_patients_telefonszam ON patients(telefonszam);
CREATE INDEX IF NOT EXISTS idx_patients_beutalo_orvos ON patients(beutalo_orvos);
CREATE INDEX IF NOT EXISTS idx_patients_beutalo_intezmeny ON patients(beutalo_intezmeny);
CREATE INDEX IF NOT EXISTS idx_patients_kezeleoorvos ON patients(kezeleoorvos);
CREATE INDEX IF NOT EXISTS idx_patients_created_at ON patients(created_at);
CREATE INDEX IF NOT EXISTS idx_patients_felvetel_datuma ON patients(felvetel_datuma);

-- Indexek az implants táblán
CREATE INDEX IF NOT EXISTS idx_implants_patient_id ON implants(patient_id);
CREATE INDEX IF NOT EXISTS idx_implants_fog_szama ON implants(fog_szama);

-- Trigger a frissítés dátumának automatikus frissítéséhez (patients)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_patients_updated_at 
    BEFORE UPDATE ON patients 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger az implants táblához
CREATE TRIGGER update_implants_updated_at 
    BEFORE UPDATE ON implants 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- View a teljes betegadatokkal és implantátumokkal
CREATE OR REPLACE VIEW patients_with_implants AS
SELECT 
    p.*,
    COALESCE(
        json_agg(
            json_build_object(
                'fog_szama', i.fog_szama,
                'reszletek', i.reszletek
            )
        ) FILTER (WHERE i.id IS NOT NULL),
        '[]'::json
    ) as implantatumok
FROM patients p
LEFT JOIN implants i ON p.id = i.patient_id
GROUP BY p.id;

-- Kommentek
COMMENT ON TABLE patients IS 'Betegek főtáblája - maxillofacialis rehabilitációs adatok';
COMMENT ON TABLE implants IS 'Implantátumok táblája - betegek implantátumainak részletes adatai';
COMMENT ON COLUMN implants.fog_szama IS 'Fog száma a Zsigmondy-kereszt szerint (pl. 18, 17, 21, stb.)';
COMMENT ON VIEW patients_with_implants IS 'View a betegek teljes adataival és implantátumaikkal JSON formátumban';


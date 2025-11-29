-- Migration: Patients tábla teljes újraépítése JSONB oszlopokkal
-- FIGYELEM: Ez törli az ÖSSZES meglévő adatot!
-- Run with: psql -d <db> -f database/migration_recreate_table.sql

BEGIN;

-- Töröljük a táblát és minden függő objektumát (CASCADE)
DROP TABLE IF EXISTS patients CASCADE;

-- Töröljük az update_updated_at_column függvényt is (majd újra létrehozzuk)
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- UUID generáláshoz szükséges bővítmény bekapcsolása
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION WHEN OTHERS THEN
    BEGIN
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Nem sikerült UUID bővítményt betölteni. A UUID generálás nem fog automatikusan működni.';
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
            RAISE EXCEPTION 'Egyik UUID generáló függvény sem érhető el. Telepítse a pgcrypto vagy uuid-ossp bővítményt.';
        END;
    END;
END;
$$ LANGUAGE plpgsql;

-- Betegek főtáblája - ÚJRALÉTREHOZVA JSONB oszlopokkal
CREATE TABLE patients (
    -- Egyedi azonosító
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    
    -- ALAPADATOK
    nev VARCHAR(255),
    taj VARCHAR(20),
    telefonszam VARCHAR(50),
    
    -- SZEMÉLYES ADATOK
    szuletesi_datum DATE,
    nem VARCHAR(10) CHECK (nem IN ('ferfi', 'no', 'nem_ismert')),
    email VARCHAR(255),
    cim TEXT,
    varos VARCHAR(100),
    iranyitoszam VARCHAR(10),
    
    -- BEUTALÓ ADATOK
    beutalo_orvos VARCHAR(255),
    beutalo_intezmeny VARCHAR(255),
    mutet_rovid_leirasa TEXT,
    mutet_ideje DATE,
    szovettani_diagnozis TEXT,
    nyaki_blokkdisszekcio VARCHAR(50) CHECK (nyaki_blokkdisszekcio IN ('nem volt', 'volt, egyoldali', 'volt, kétoldali')),
    
    -- ADJUVÁNS TERÁPIÁK
    radioterapia BOOLEAN DEFAULT false,
    radioterapia_dozis VARCHAR(50),
    radioterapia_datum_intervallum VARCHAR(100),
    chemoterapia BOOLEAN DEFAULT false,
    chemoterapia_leiras TEXT,
    
    -- REHABILITÁCIÓS ADATOK - ANAMNÉZIS ÉS BETEGVIZSGÁLAT
    alkoholfogyasztas TEXT,
    dohanyzas_szam VARCHAR(50),
    kezelesre_erkezes_indoka VARCHAR(100) CHECK (kezelesre_erkezes_indoka IN ('traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot')),
    maxilladefektus_van BOOLEAN DEFAULT false,
    brown_fuggoleges_osztaly VARCHAR(1) CHECK (brown_fuggoleges_osztaly IN ('1', '2', '3', '4')),
    brown_vizszintes_komponens VARCHAR(1) CHECK (brown_vizszintes_komponens IN ('a', 'b', 'c')),
    mandibuladefektus_van BOOLEAN DEFAULT false,
    kovacs_dobak_osztaly VARCHAR(1) CHECK (kovacs_dobak_osztaly IN ('1', '2', '3', '4', '5')),
    nyelvmozgasok_akadalyozottak BOOLEAN DEFAULT false,
    gombocos_beszed BOOLEAN DEFAULT false,
    nyalmirigy_allapot VARCHAR(30) CHECK (nyalmirigy_allapot IN ('hiposzaliváció', 'hiperszaliváció', 'Nem számol be eltérésről')),
    fabian_fejerdy_protetikai_osztaly_felso VARCHAR(10) CHECK (fabian_fejerdy_protetikai_osztaly_felso IN ('0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T')),
    fabian_fejerdy_protetikai_osztaly_also VARCHAR(10) CHECK (fabian_fejerdy_protetikai_osztaly_also IN ('0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T')),
    fabian_fejerdy_protetikai_osztaly VARCHAR(10) CHECK (fabian_fejerdy_protetikai_osztaly IN ('0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T')),
    kezeleoorvos VARCHAR(100),
    kezeleoorvos_intezete VARCHAR(255),
    felvetel_datuma DATE,
    
    -- PROTÉZIS – FELSŐ/ALSÓ ÁLLCSONT
    felso_fogpotlas_van BOOLEAN DEFAULT false,
    felso_fogpotlas_mikor VARCHAR(100),
    felso_fogpotlas_keszito TEXT,
    felso_fogpotlas_elegedett BOOLEAN DEFAULT true,
    felso_fogpotlas_problema TEXT,
    also_fogpotlas_van BOOLEAN DEFAULT false,
    also_fogpotlas_mikor VARCHAR(100),
    also_fogpotlas_keszito TEXT,
    also_fogpotlas_elegedett BOOLEAN DEFAULT true,
    also_fogpotlas_problema TEXT,
    
    -- FOGAZATI STÁTUSZ
    meglevo_fogak JSONB DEFAULT '{}'::jsonb,
    felso_fogpotlas_tipus VARCHAR(100) CHECK (felso_fogpotlas_tipus IS NULL OR felso_fogpotlas_tipus IN (
        'zárólemez',
        'részleges akrilátlemezes fogpótlás',
        'teljes akrilátlemezes fogpótlás',  -- old value, kept for backward compatibility
        'teljes lemezes fogpótlás',
        'fedőlemezes fogpótlás',
        'részleges fémlemezes fogpótlás kapocselhorgonyzással',  -- old value, kept for backward compatibility
        'kapocselhorgonyzású részleges fémlemezes fogpótlás',
        'kombinált fogpótlás kapocselhorgonyzással',
        'kombinált fogpótlás rejtett elhorgonyzási eszköz(ök)kel',  -- old value, kept for backward compatibility
        'kombinált fogpótlás rejtett elhorgonyzási eszközzel',
        'rögzített fogpótlás',  -- old value, kept for backward compatibility
        'rögzített fogpótlás fogakon elhorgonyozva',
        'cementezett rögzítésű implantációs korona/híd',
        'csavarozott rögzítésű implantációs korona/híd',
        'sebészi sablon készítése'
    )),
    also_fogpotlas_tipus VARCHAR(100) CHECK (also_fogpotlas_tipus IS NULL OR also_fogpotlas_tipus IN (
        'zárólemez',
        'részleges akrilátlemezes fogpótlás',
        'teljes akrilátlemezes fogpótlás',  -- old value, kept for backward compatibility
        'teljes lemezes fogpótlás',
        'fedőlemezes fogpótlás',
        'részleges fémlemezes fogpótlás kapocselhorgonyzással',  -- old value, kept for backward compatibility
        'kapocselhorgonyzású részleges fémlemezes fogpótlás',
        'kombinált fogpótlás kapocselhorgonyzással',
        'kombinált fogpótlás rejtett elhorgonyzási eszköz(ök)kel',  -- old value, kept for backward compatibility
        'kombinált fogpótlás rejtett elhorgonyzási eszközzel',
        'rögzített fogpótlás',  -- old value, kept for backward compatibility
        'rögzített fogpótlás fogakon elhorgonyozva',
        'cementezett rögzítésű implantációs korona/híd',
        'csavarozott rögzítésű implantációs korona/híd',
        'sebészi sablon készítése'
    )),
    
    -- IMPLANTÁTUMOK
    meglevo_implantatumok JSONB DEFAULT '{}'::jsonb,
    nem_ismert_poziciokban_implantatum BOOLEAN DEFAULT false,
    nem_ismert_poziciokban_implantatum_reszletek TEXT,
    
    -- KEZELÉSI TERV - JSONB tömbök (ÚJ)
    -- Formátum: [{"tipus": "zárólemez", "tervezettAtadasDatuma": "2024-01-15", "elkeszult": false}, ...]
    kezelesi_terv_felso JSONB DEFAULT '[]'::jsonb,
    kezelesi_terv_also JSONB DEFAULT '[]'::jsonb,
    
    -- TIMESTAMPS
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    
    -- TNM STAGING
    tnm_staging TEXT
);

-- Indexek létrehozása
CREATE INDEX idx_patients_nev ON patients(nev);
CREATE INDEX idx_patients_taj ON patients(taj);
CREATE INDEX idx_patients_email ON patients(email);
CREATE INDEX idx_patients_telefonszam ON patients(telefonszam);
CREATE INDEX idx_patients_beutalo_orvos ON patients(beutalo_orvos);
CREATE INDEX idx_patients_beutalo_intezmeny ON patients(beutalo_intezmeny);
CREATE INDEX idx_patients_kezeleoorvos ON patients(kezeleoorvos);
CREATE INDEX idx_patients_created_at ON patients(created_at);
CREATE INDEX idx_patients_felvetel_datuma ON patients(felvetel_datuma);
CREATE INDEX idx_patients_created_by ON patients(created_by);

-- GIN indexek JSON mezőkhöz
CREATE INDEX idx_patients_implantatumok_gin ON patients USING GIN (meglevo_implantatumok);
CREATE INDEX idx_patients_fogak_gin ON patients USING GIN (meglevo_fogak);
CREATE INDEX idx_patients_kezelesi_terv_felso_gin ON patients USING GIN (kezelesi_terv_felso);
CREATE INDEX idx_patients_kezelesi_terv_also_gin ON patients USING GIN (kezelesi_terv_also);

-- Trigger a frissítés dátumának automatikus frissítéséhez
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

-- Kommentek
COMMENT ON TABLE patients IS 'Betegek főtáblája - maxillofacialis rehabilitációs adatok';
COMMENT ON COLUMN patients.nev IS 'Beteg neve';
COMMENT ON COLUMN patients.taj IS 'TAJ szám';
COMMENT ON COLUMN patients.meglevo_implantatumok IS 'Meglévő implantátumok JSON formátumban: {"fog_szám": "részletek"}';
COMMENT ON COLUMN patients.meglevo_fogak IS 'Meglévő fogak JSON formátumban: {"fog_szám": "állapot"}';
COMMENT ON COLUMN patients.kezelesi_terv_felso IS 'Tervezett fogpótlások listája - felső állcsont (JSONB tömb: [{"tipus": "...", "tervezettAtadasDatuma": "...", "elkeszult": true/false}, ...])';
COMMENT ON COLUMN patients.kezelesi_terv_also IS 'Tervezett fogpótlások listája - alsó állcsont (JSONB tömb: [{"tipus": "...", "tervezettAtadasDatuma": "...", "elkeszult": true/false}, ...])';
COMMENT ON COLUMN patients.created_at IS 'Rekord létrehozásának időpontja';
COMMENT ON COLUMN patients.updated_at IS 'Rekord utolsó frissítésének időpontja';
COMMENT ON COLUMN patients.created_by IS 'A felhasználó email címe, aki a rekordot létrehozta';
COMMENT ON COLUMN patients.updated_by IS 'A felhasználó email címe, aki utoljára módosította';

COMMIT;


-- ===================================================================
-- Maxillofacialis Rehabilitáció - Betegadat Adatbázis Séma
-- ===================================================================
-- PostgreSQL adatbázis táblák létrehozása a betegadatok tárolásához
-- ===================================================================

-- UUID generáláshoz szükséges bővítmény bekapcsolása
-- Először próbáljuk a pgcrypto-t (PostgreSQL 13+, modern megoldás)
-- Ha az nem érhető el, használjuk az uuid-ossp-t (régebbi PostgreSQL verziók)
DO $$
BEGIN
    -- Próbáljuk bekapcsolni a pgcrypto bővítményt (PostgreSQL 13+)
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION WHEN OTHERS THEN
    -- Ha sikertelen, próbáljuk az uuid-ossp-t
    BEGIN
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    EXCEPTION WHEN OTHERS THEN
        -- Ha ez sem megy, csak figyelmeztetünk
        RAISE NOTICE 'Nem sikerült UUID bővítményt betölteni. A UUID generálás nem fog automatikusan működni.';
    END;
END
$$;

-- Helper függvény UUID generáláshoz (támogatja mindkét bővítményt)
CREATE OR REPLACE FUNCTION generate_uuid()
RETURNS UUID AS $$
BEGIN
    -- Először próbáljuk a gen_random_uuid() függvényt (pgcrypto)
    BEGIN
        RETURN gen_random_uuid();
    EXCEPTION WHEN OTHERS THEN
        -- Ha nem elérhető, használjuk az uuid_generate_v4() függvényt (uuid-ossp)
        BEGIN
            RETURN uuid_generate_v4();
        EXCEPTION WHEN OTHERS THEN
            -- Ha egyik sem elérhető, hibaüzenet
            RAISE EXCEPTION 'Egyik UUID generáló függvény sem érhető el. Telepítse a pgcrypto vagy uuid-ossp bővítményt.';
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
    kezelesre_erkezes_indoka VARCHAR(100) CHECK (kezelesre_erkezes_indoka IN ('traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot')),
    maxilladefektus_van BOOLEAN DEFAULT false,                 -- Maxilladefektus van
    brown_fuggoleges_osztaly VARCHAR(1) CHECK (brown_fuggoleges_osztaly IN ('1', '2', '3', '4')),  -- Brown-féle klasszifikáció - függőleges komponens
    brown_vizszintes_komponens VARCHAR(1) CHECK (brown_vizszintes_komponens IN ('a', 'b', 'c')),    -- Brown - vízszintes/palatinalis komponens
    mandibuladefektus_van BOOLEAN DEFAULT false,               -- Mandibuladefektus van
    kovacs_dobak_osztaly VARCHAR(1) CHECK (kovacs_dobak_osztaly IN ('1', '2', '3', '4', '5')),    -- Kovács-Dobák osztályozás
    nyelvmozgasok_akadalyozottak BOOLEAN DEFAULT false,        -- Nyelvmozgások akadályozottak
    gombocos_beszed BOOLEAN DEFAULT false,                     -- Gombócos beszéd
    nyalmirigy_allapot VARCHAR(30) CHECK (nyalmirigy_allapot IN ('hiposzaliváció', 'hiperszaliváció', 'Nem számol be eltérésről')),  -- Nyálmirigy állapot
    -- Fábián–Fejérdy-féle protetikai osztály (felső és alsó külön)
    fabian_fejerdy_protetikai_osztaly_felso VARCHAR(10) CHECK (fabian_fejerdy_protetikai_osztaly_felso IN ('0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T')),
    fabian_fejerdy_protetikai_osztaly_also VARCHAR(10) CHECK (fabian_fejerdy_protetikai_osztaly_also IN ('0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T')),
    -- (Régi, összesített mező a kompatibilitásért – nem használt új űrlapban)
    fabian_fejerdy_protetikai_osztaly VARCHAR(10) CHECK (fabian_fejerdy_protetikai_osztaly IN ('0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T')),  -- Fábián- és Fejérdy-féle protetikai osztály
    kezeleoorvos VARCHAR(100),                                  -- Kezelőorvos
    kezeleoorvos_intezete VARCHAR(255),                        -- Kezelőorvos intézete
    felvetel_datuma DATE,                                       -- Felvétel dátuma
    
    -- PROTÉZIS – FELSŐ/ALSÓ ÁLLCSONT
    felso_fogpotlas_van BOOLEAN DEFAULT false,                 -- Felső állcsont: van-e fogpótlás
    felso_fogpotlas_mikor VARCHAR(100),                        -- Felső: mikor készült
    felso_fogpotlas_keszito TEXT,                              -- Felső: ki/hol készült
    felso_fogpotlas_elegedett BOOLEAN DEFAULT true,            -- Felső: elégedett-e
    felso_fogpotlas_problema TEXT,                             -- Felső: ha nem elégedett, mi a baj
    also_fogpotlas_van BOOLEAN DEFAULT false,                  -- Alsó állcsont: van-e fogpótlás
    also_fogpotlas_mikor VARCHAR(100),                         -- Alsó: mikor készült
    also_fogpotlas_keszito TEXT,                               -- Alsó: ki/hol készült
    also_fogpotlas_elegedett BOOLEAN DEFAULT true,             -- Alsó: elégedett-e
    also_fogpotlas_problema TEXT,                              -- Alsó: ha nem elégedett, mi a baj
    
    -- IMPLANTÁTUMOK
    -- Meglévő implantátumok JSON formátumban (fog szám -> részletek)
    -- Formátum: {"18": "Straumann BLT 4.1x10mm, Gyári szám: 028.015, Dátum: 2023.05.15", "17": "..."}
    meglevo_implantatumok JSONB DEFAULT '{}'::jsonb,           -- Meglévő implantátumok
    nem_ismert_poziciokban_implantatum BOOLEAN DEFAULT false,  -- Nem ismert pozíciókban implantátum
    nem_ismert_poziciokban_implantatum_reszletek TEXT,         -- Nem ismert pozíciókban implantátum részletek

    -- FOGAZATI STÁTUSZ
    -- Zsigmondy: a jelenlévő fogakat JSONB tárolja (kulcs: fogszám, érték: állapot megjegyzés)
    meglevo_fogak JSONB DEFAULT '{}'::jsonb,
    -- Meglévő fogpótlás típusa (felső/alsó)
    felso_fogpotlas_tipus VARCHAR(100) CHECK (felso_fogpotlas_tipus IN (
        'teljes akrilátlemezes fogpótlás',
        'részleges akrilátlemezes fogpótlás',
        'részleges fémlemezes fogpótlás kapocselhorgonyzással',
        'kombinált fogpótlás kapocselhorgonyzással',
        'kombinált fogpótlás rejtett elhorgonyzási eszköz(ök)kel',
        'fedőlemezes fogpótlás',
        'rögzített fogpótlás'
    )),
    also_fogpotlas_tipus VARCHAR(100) CHECK (also_fogpotlas_tipus IN (
        'teljes akrilátlemezes fogpótlás',
        'részleges akrilátlemezes fogpótlás',
        'részleges fémlemezes fogpótlás kapocselhorgonyzással',
        'kombinált fogpótlás kapocselhorgonyzással',
        'kombinált fogpótlás rejtett elhorgonyzási eszköz(ök)kel',
        'fedőlemezes fogpótlás',
        'rögzített fogpótlás'
    )),
    
    -- TIMESTAMPS
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,  -- Létrehozás dátuma
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,   -- Frissítés dátuma

    -- AUDIT: ki rögzítette/módosította
    created_by VARCHAR(255),
    updated_by VARCHAR(255)
);

-- Indexek a gyors kereséshez
CREATE INDEX IF NOT EXISTS idx_patients_nev ON patients(nev);
CREATE INDEX IF NOT EXISTS idx_patients_taj ON patients(taj);
CREATE INDEX IF NOT EXISTS idx_patients_email ON patients(email);
CREATE INDEX IF NOT EXISTS idx_patients_telefonszam ON patients(telefonszam);
CREATE INDEX IF NOT EXISTS idx_patients_beutalo_orvos ON patients(beutalo_orvos);
CREATE INDEX IF NOT EXISTS idx_patients_beutalo_intezmeny ON patients(beutalo_intezmeny);
CREATE INDEX IF NOT EXISTS idx_patients_kezeleoorvos ON patients(kezeleoorvos);
CREATE INDEX IF NOT EXISTS idx_patients_created_at ON patients(created_at);
CREATE INDEX IF NOT EXISTS idx_patients_felvetel_datuma ON patients(felvetel_datuma);
CREATE INDEX IF NOT EXISTS idx_patients_created_by ON patients(created_by);

-- GIN index az implantátumok JSON mezőhöz (a gyors JSON kereséshez)
CREATE INDEX IF NOT EXISTS idx_patients_implantatumok_gin ON patients USING GIN (meglevo_implantatumok);

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

-- Kommentek a táblák és oszlopokhoz
COMMENT ON TABLE patients IS 'Betegek főtáblája - maxillofacialis rehabilitációs adatok';
COMMENT ON COLUMN patients.nev IS 'Beteg neve (kötelező mező)';
COMMENT ON COLUMN patients.taj IS 'TAJ szám';
COMMENT ON COLUMN patients.meglevo_implantatumok IS 'Meglévő implantátumok JSON formátumban: {"fog_szám": "részletek"}';
COMMENT ON COLUMN patients.created_at IS 'Rekord létrehozásának időpontja';
COMMENT ON COLUMN patients.updated_at IS 'Rekord utolsó frissítésének időpontja';
COMMENT ON COLUMN patients.created_by IS 'A felhasználó email címe, aki a rekordot létrehozta';
COMMENT ON COLUMN patients.updated_by IS 'A felhasználó email címe, aki utoljára módosította';


-- 005: Normalize patients table into 5 focused tables
-- Splits the 82-column monolith into: patients (core), patient_referral,
-- patient_anamnesis, patient_dental_status, patient_treatment_plans.
-- Creates patients_full VIEW + INSTEAD OF triggers for backward compatibility.

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Create child tables and populate from existing data
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS patient_referral (
  patient_id UUID PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
  beutalo_orvos VARCHAR(255),
  beutalo_intezmeny VARCHAR(255),
  beutalo_indokolas TEXT,
  primer_mutet_leirasa TEXT,
  mutet_ideje DATE,
  szovettani_diagnozis TEXT,
  nyaki_blokkdisszekcio VARCHAR(50) CHECK (nyaki_blokkdisszekcio IN ('nem volt', 'volt, egyoldali', 'volt, kétoldali'))
);

CREATE TABLE IF NOT EXISTS patient_anamnesis (
  patient_id UUID PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
  kezelesre_erkezes_indoka VARCHAR(100) CHECK (kezelesre_erkezes_indoka IN ('traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot', 'nincs beutaló')),
  alkoholfogyasztas TEXT,
  dohanyzas_szam VARCHAR(50),
  maxilladefektus_van BOOLEAN DEFAULT false,
  brown_fuggoleges_osztaly VARCHAR(1) CHECK (brown_fuggoleges_osztaly IN ('1', '2', '3', '4')),
  brown_vizszintes_komponens VARCHAR(1) CHECK (brown_vizszintes_komponens IN ('a', 'b', 'c')),
  mandibuladefektus_van BOOLEAN DEFAULT false,
  kovacs_dobak_osztaly VARCHAR(1) CHECK (kovacs_dobak_osztaly IN ('1', '2', '3', '4', '5')),
  nyelvmozgasok_akadalyozottak BOOLEAN DEFAULT false,
  gombocos_beszed BOOLEAN DEFAULT false,
  nyalmirigy_allapot VARCHAR(30) CHECK (nyalmirigy_allapot IN ('hiposzaliváció', 'hiperszaliváció', 'Nem számol be eltérésről')),
  fabian_fejerdy_protetikai_osztaly VARCHAR(10) CHECK (fabian_fejerdy_protetikai_osztaly IN ('0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T')),
  fabian_fejerdy_protetikai_osztaly_felso VARCHAR(10) CHECK (fabian_fejerdy_protetikai_osztaly_felso IN ('0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T')),
  fabian_fejerdy_protetikai_osztaly_also VARCHAR(10) CHECK (fabian_fejerdy_protetikai_osztaly_also IN ('0', '1A', '1B', '2A', '2A/1', '2B', '3', 'T')),
  radioterapia BOOLEAN DEFAULT false,
  radioterapia_dozis VARCHAR(50),
  radioterapia_datum_intervallum VARCHAR(100),
  chemoterapia BOOLEAN DEFAULT false,
  chemoterapia_leiras TEXT,
  tnm_staging TEXT,
  bno TEXT,
  diagnozis TEXT,
  baleset_idopont DATE,
  baleset_etiologiaja TEXT,
  baleset_egyeb TEXT,
  veleszuletett_rendellenessegek JSONB DEFAULT '[]'::jsonb,
  veleszuletett_mutetek_leirasa TEXT
);

CREATE TABLE IF NOT EXISTS patient_dental_status (
  patient_id UUID PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
  meglevo_fogak JSONB DEFAULT '{}'::jsonb,
  meglevo_implantatumok JSONB DEFAULT '{}'::jsonb,
  nem_ismert_poziciokban_implantatum BOOLEAN DEFAULT false,
  nem_ismert_poziciokban_implantatum_reszletek TEXT,
  felso_fogpotlas_van BOOLEAN DEFAULT false,
  felso_fogpotlas_mikor VARCHAR(100),
  felso_fogpotlas_keszito TEXT,
  felso_fogpotlas_elegedett BOOLEAN DEFAULT true,
  felso_fogpotlas_problema TEXT,
  felso_fogpotlas_tipus VARCHAR(100),
  also_fogpotlas_van BOOLEAN DEFAULT false,
  also_fogpotlas_mikor VARCHAR(100),
  also_fogpotlas_keszito TEXT,
  also_fogpotlas_elegedett BOOLEAN DEFAULT true,
  also_fogpotlas_problema TEXT,
  also_fogpotlas_tipus VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS patient_treatment_plans (
  patient_id UUID PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
  kezelesi_terv_felso JSONB DEFAULT '[]'::jsonb,
  kezelesi_terv_also JSONB DEFAULT '[]'::jsonb,
  kezelesi_terv_arcot_erinto JSONB DEFAULT '[]'::jsonb,
  kortorteneti_osszefoglalo TEXT,
  kezelesi_terv_melleklet TEXT,
  szakorvosi_velemeny TEXT
);

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Migrate existing data into child tables
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO patient_referral (patient_id, beutalo_orvos, beutalo_intezmeny, beutalo_indokolas, primer_mutet_leirasa, mutet_ideje, szovettani_diagnozis, nyaki_blokkdisszekcio)
SELECT id, beutalo_orvos, beutalo_intezmeny, beutalo_indokolas, primer_mutet_leirasa, mutet_ideje, szovettani_diagnozis, nyaki_blokkdisszekcio
FROM patients
ON CONFLICT (patient_id) DO NOTHING;

INSERT INTO patient_anamnesis (patient_id, kezelesre_erkezes_indoka, alkoholfogyasztas, dohanyzas_szam, maxilladefektus_van, brown_fuggoleges_osztaly, brown_vizszintes_komponens, mandibuladefektus_van, kovacs_dobak_osztaly, nyelvmozgasok_akadalyozottak, gombocos_beszed, nyalmirigy_allapot, fabian_fejerdy_protetikai_osztaly, fabian_fejerdy_protetikai_osztaly_felso, fabian_fejerdy_protetikai_osztaly_also, radioterapia, radioterapia_dozis, radioterapia_datum_intervallum, chemoterapia, chemoterapia_leiras, tnm_staging, bno, diagnozis, baleset_idopont, baleset_etiologiaja, baleset_egyeb, veleszuletett_rendellenessegek, veleszuletett_mutetek_leirasa)
SELECT id, kezelesre_erkezes_indoka, alkoholfogyasztas, dohanyzas_szam, COALESCE(maxilladefektus_van, false), brown_fuggoleges_osztaly, brown_vizszintes_komponens, COALESCE(mandibuladefektus_van, false), kovacs_dobak_osztaly, COALESCE(nyelvmozgasok_akadalyozottak, false), COALESCE(gombocos_beszed, false), nyalmirigy_allapot, fabian_fejerdy_protetikai_osztaly, fabian_fejerdy_protetikai_osztaly_felso, fabian_fejerdy_protetikai_osztaly_also, COALESCE(radioterapia, false), radioterapia_dozis, radioterapia_datum_intervallum, COALESCE(chemoterapia, false), chemoterapia_leiras, tnm_staging, bno, diagnozis, baleset_idopont, baleset_etiologiaja, baleset_egyeb, COALESCE(veleszuletett_rendellenessegek, '[]'::jsonb), veleszuletett_mutetek_leirasa
FROM patients
ON CONFLICT (patient_id) DO NOTHING;

INSERT INTO patient_dental_status (patient_id, meglevo_fogak, meglevo_implantatumok, nem_ismert_poziciokban_implantatum, nem_ismert_poziciokban_implantatum_reszletek, felso_fogpotlas_van, felso_fogpotlas_mikor, felso_fogpotlas_keszito, felso_fogpotlas_elegedett, felso_fogpotlas_problema, felso_fogpotlas_tipus, also_fogpotlas_van, also_fogpotlas_mikor, also_fogpotlas_keszito, also_fogpotlas_elegedett, also_fogpotlas_problema, also_fogpotlas_tipus)
SELECT id, COALESCE(meglevo_fogak, '{}'::jsonb), COALESCE(meglevo_implantatumok, '{}'::jsonb), COALESCE(nem_ismert_poziciokban_implantatum, false), nem_ismert_poziciokban_implantatum_reszletek, COALESCE(felso_fogpotlas_van, false), felso_fogpotlas_mikor, felso_fogpotlas_keszito, COALESCE(felso_fogpotlas_elegedett, true), felso_fogpotlas_problema, felso_fogpotlas_tipus, COALESCE(also_fogpotlas_van, false), also_fogpotlas_mikor, also_fogpotlas_keszito, COALESCE(also_fogpotlas_elegedett, true), also_fogpotlas_problema, also_fogpotlas_tipus
FROM patients
ON CONFLICT (patient_id) DO NOTHING;

INSERT INTO patient_treatment_plans (patient_id, kezelesi_terv_felso, kezelesi_terv_also, kezelesi_terv_arcot_erinto, kortorteneti_osszefoglalo, kezelesi_terv_melleklet, szakorvosi_velemeny)
SELECT id, COALESCE(kezelesi_terv_felso, '[]'::jsonb), COALESCE(kezelesi_terv_also, '[]'::jsonb), COALESCE(kezelesi_terv_arcot_erinto, '[]'::jsonb), kortorteneti_osszefoglalo, kezelesi_terv_melleklet, szakorvosi_velemeny
FROM patients
ON CONFLICT (patient_id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Drop migrated columns from patients table
-- ══════════════════════════════════════════════════════════════════════════════

-- Referral columns
ALTER TABLE patients DROP COLUMN IF EXISTS beutalo_orvos;
ALTER TABLE patients DROP COLUMN IF EXISTS beutalo_intezmeny;
ALTER TABLE patients DROP COLUMN IF EXISTS beutalo_indokolas;
ALTER TABLE patients DROP COLUMN IF EXISTS mutet_rovid_leirasa;
ALTER TABLE patients DROP COLUMN IF EXISTS primer_mutet_leirasa;
ALTER TABLE patients DROP COLUMN IF EXISTS mutet_ideje;
ALTER TABLE patients DROP COLUMN IF EXISTS szovettani_diagnozis;
ALTER TABLE patients DROP COLUMN IF EXISTS nyaki_blokkdisszekcio;

-- Anamnesis columns
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesre_erkezes_indoka;
ALTER TABLE patients DROP COLUMN IF EXISTS alkoholfogyasztas;
ALTER TABLE patients DROP COLUMN IF EXISTS dohanyzas_szam;
ALTER TABLE patients DROP COLUMN IF EXISTS maxilladefektus_van;
ALTER TABLE patients DROP COLUMN IF EXISTS brown_fuggoleges_osztaly;
ALTER TABLE patients DROP COLUMN IF EXISTS brown_vizszintes_komponens;
ALTER TABLE patients DROP COLUMN IF EXISTS mandibuladefektus_van;
ALTER TABLE patients DROP COLUMN IF EXISTS kovacs_dobak_osztaly;
ALTER TABLE patients DROP COLUMN IF EXISTS nyelvmozgasok_akadalyozottak;
ALTER TABLE patients DROP COLUMN IF EXISTS gombocos_beszed;
ALTER TABLE patients DROP COLUMN IF EXISTS nyalmirigy_allapot;
ALTER TABLE patients DROP COLUMN IF EXISTS fabian_fejerdy_protetikai_osztaly;
ALTER TABLE patients DROP COLUMN IF EXISTS fabian_fejerdy_protetikai_osztaly_felso;
ALTER TABLE patients DROP COLUMN IF EXISTS fabian_fejerdy_protetikai_osztaly_also;
ALTER TABLE patients DROP COLUMN IF EXISTS radioterapia;
ALTER TABLE patients DROP COLUMN IF EXISTS radioterapia_dozis;
ALTER TABLE patients DROP COLUMN IF EXISTS radioterapia_datum_intervallum;
ALTER TABLE patients DROP COLUMN IF EXISTS chemoterapia;
ALTER TABLE patients DROP COLUMN IF EXISTS chemoterapia_leiras;
ALTER TABLE patients DROP COLUMN IF EXISTS tnm_staging;
ALTER TABLE patients DROP COLUMN IF EXISTS bno;
ALTER TABLE patients DROP COLUMN IF EXISTS diagnozis;
ALTER TABLE patients DROP COLUMN IF EXISTS baleset_idopont;
ALTER TABLE patients DROP COLUMN IF EXISTS baleset_etiologiaja;
ALTER TABLE patients DROP COLUMN IF EXISTS baleset_egyeb;
ALTER TABLE patients DROP COLUMN IF EXISTS veleszuletett_rendellenessegek;
ALTER TABLE patients DROP COLUMN IF EXISTS veleszuletett_mutetek_leirasa;

-- Dental status columns
ALTER TABLE patients DROP COLUMN IF EXISTS meglevo_fogak;
ALTER TABLE patients DROP COLUMN IF EXISTS meglevo_implantatumok;
ALTER TABLE patients DROP COLUMN IF EXISTS nem_ismert_poziciokban_implantatum;
ALTER TABLE patients DROP COLUMN IF EXISTS nem_ismert_poziciokban_implantatum_reszletek;
ALTER TABLE patients DROP COLUMN IF EXISTS felso_fogpotlas_van;
ALTER TABLE patients DROP COLUMN IF EXISTS felso_fogpotlas_mikor;
ALTER TABLE patients DROP COLUMN IF EXISTS felso_fogpotlas_keszito;
ALTER TABLE patients DROP COLUMN IF EXISTS felso_fogpotlas_elegedett;
ALTER TABLE patients DROP COLUMN IF EXISTS felso_fogpotlas_problema;
ALTER TABLE patients DROP COLUMN IF EXISTS felso_fogpotlas_tipus;
ALTER TABLE patients DROP COLUMN IF EXISTS also_fogpotlas_van;
ALTER TABLE patients DROP COLUMN IF EXISTS also_fogpotlas_mikor;
ALTER TABLE patients DROP COLUMN IF EXISTS also_fogpotlas_keszito;
ALTER TABLE patients DROP COLUMN IF EXISTS also_fogpotlas_elegedett;
ALTER TABLE patients DROP COLUMN IF EXISTS also_fogpotlas_problema;
ALTER TABLE patients DROP COLUMN IF EXISTS also_fogpotlas_tipus;

-- Treatment plan columns
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_felso;
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_also;
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_arcot_erinto;
ALTER TABLE patients DROP COLUMN IF EXISTS kortorteneti_osszefoglalo;
ALTER TABLE patients DROP COLUMN IF EXISTS kezelesi_terv_melleklet;
ALTER TABLE patients DROP COLUMN IF EXISTS szakorvosi_velemeny;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Create patients_full VIEW (backward-compatible shape)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW patients_full AS
SELECT
  p.id, p.nev, p.taj, p.telefonszam, p.szuletesi_datum, p.nem, p.email,
  p.cim, p.varos, p.iranyitoszam,
  p.kezeleoorvos, p.kezeleoorvos_intezete, p.felvetel_datuma, p.halal_datum,
  p.intake_status,
  p.created_at, p.updated_at, p.created_by, p.updated_by,
  -- referral
  r.beutalo_orvos, r.beutalo_intezmeny, r.beutalo_indokolas,
  r.primer_mutet_leirasa, r.mutet_ideje, r.szovettani_diagnozis,
  r.nyaki_blokkdisszekcio,
  -- anamnesis
  a.kezelesre_erkezes_indoka, a.alkoholfogyasztas, a.dohanyzas_szam,
  a.maxilladefektus_van, a.brown_fuggoleges_osztaly, a.brown_vizszintes_komponens,
  a.mandibuladefektus_van, a.kovacs_dobak_osztaly,
  a.nyelvmozgasok_akadalyozottak, a.gombocos_beszed, a.nyalmirigy_allapot,
  a.fabian_fejerdy_protetikai_osztaly,
  a.fabian_fejerdy_protetikai_osztaly_felso, a.fabian_fejerdy_protetikai_osztaly_also,
  a.radioterapia, a.radioterapia_dozis, a.radioterapia_datum_intervallum,
  a.chemoterapia, a.chemoterapia_leiras,
  a.tnm_staging, a.bno, a.diagnozis,
  a.baleset_idopont, a.baleset_etiologiaja, a.baleset_egyeb,
  a.veleszuletett_rendellenessegek, a.veleszuletett_mutetek_leirasa,
  -- dental status
  d.meglevo_fogak, d.meglevo_implantatumok,
  d.nem_ismert_poziciokban_implantatum, d.nem_ismert_poziciokban_implantatum_reszletek,
  d.felso_fogpotlas_van, d.felso_fogpotlas_mikor, d.felso_fogpotlas_keszito,
  d.felso_fogpotlas_elegedett, d.felso_fogpotlas_problema, d.felso_fogpotlas_tipus,
  d.also_fogpotlas_van, d.also_fogpotlas_mikor, d.also_fogpotlas_keszito,
  d.also_fogpotlas_elegedett, d.also_fogpotlas_problema, d.also_fogpotlas_tipus,
  -- treatment plans
  t.kezelesi_terv_felso, t.kezelesi_terv_also, t.kezelesi_terv_arcot_erinto,
  t.kortorteneti_osszefoglalo, t.kezelesi_terv_melleklet, t.szakorvosi_velemeny
FROM patients p
LEFT JOIN patient_referral r ON r.patient_id = p.id
LEFT JOIN patient_anamnesis a ON a.patient_id = p.id
LEFT JOIN patient_dental_status d ON d.patient_id = p.id
LEFT JOIN patient_treatment_plans t ON t.patient_id = p.id;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. INSTEAD OF triggers for writable VIEW
-- ══════════════════════════════════════════════════════════════════════════════

-- INSERT trigger
CREATE OR REPLACE FUNCTION patients_full_insert_fn() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO patients (id, nev, taj, telefonszam, szuletesi_datum, nem, email, cim, varos, iranyitoszam, kezeleoorvos, kezeleoorvos_intezete, felvetel_datuma, halal_datum, intake_status, created_at, updated_at, created_by, updated_by)
  VALUES (COALESCE(NEW.id, gen_random_uuid()), NEW.nev, NEW.taj, NEW.telefonszam, NEW.szuletesi_datum, NEW.nem, NEW.email, NEW.cim, NEW.varos, NEW.iranyitoszam, NEW.kezeleoorvos, NEW.kezeleoorvos_intezete, NEW.felvetel_datuma, NEW.halal_datum, NEW.intake_status, COALESCE(NEW.created_at, CURRENT_TIMESTAMP), COALESCE(NEW.updated_at, CURRENT_TIMESTAMP), NEW.created_by, NEW.updated_by)
  RETURNING id INTO NEW.id;

  INSERT INTO patient_referral (patient_id, beutalo_orvos, beutalo_intezmeny, beutalo_indokolas, primer_mutet_leirasa, mutet_ideje, szovettani_diagnozis, nyaki_blokkdisszekcio)
  VALUES (NEW.id, NEW.beutalo_orvos, NEW.beutalo_intezmeny, NEW.beutalo_indokolas, NEW.primer_mutet_leirasa, NEW.mutet_ideje, NEW.szovettani_diagnozis, NEW.nyaki_blokkdisszekcio);

  INSERT INTO patient_anamnesis (patient_id, kezelesre_erkezes_indoka, alkoholfogyasztas, dohanyzas_szam, maxilladefektus_van, brown_fuggoleges_osztaly, brown_vizszintes_komponens, mandibuladefektus_van, kovacs_dobak_osztaly, nyelvmozgasok_akadalyozottak, gombocos_beszed, nyalmirigy_allapot, fabian_fejerdy_protetikai_osztaly, fabian_fejerdy_protetikai_osztaly_felso, fabian_fejerdy_protetikai_osztaly_also, radioterapia, radioterapia_dozis, radioterapia_datum_intervallum, chemoterapia, chemoterapia_leiras, tnm_staging, bno, diagnozis, baleset_idopont, baleset_etiologiaja, baleset_egyeb, veleszuletett_rendellenessegek, veleszuletett_mutetek_leirasa)
  VALUES (NEW.id, NEW.kezelesre_erkezes_indoka, NEW.alkoholfogyasztas, NEW.dohanyzas_szam, COALESCE(NEW.maxilladefektus_van, false), NEW.brown_fuggoleges_osztaly, NEW.brown_vizszintes_komponens, COALESCE(NEW.mandibuladefektus_van, false), NEW.kovacs_dobak_osztaly, COALESCE(NEW.nyelvmozgasok_akadalyozottak, false), COALESCE(NEW.gombocos_beszed, false), NEW.nyalmirigy_allapot, NEW.fabian_fejerdy_protetikai_osztaly, NEW.fabian_fejerdy_protetikai_osztaly_felso, NEW.fabian_fejerdy_protetikai_osztaly_also, COALESCE(NEW.radioterapia, false), NEW.radioterapia_dozis, NEW.radioterapia_datum_intervallum, COALESCE(NEW.chemoterapia, false), NEW.chemoterapia_leiras, NEW.tnm_staging, NEW.bno, NEW.diagnozis, NEW.baleset_idopont, NEW.baleset_etiologiaja, NEW.baleset_egyeb, COALESCE(NEW.veleszuletett_rendellenessegek, '[]'::jsonb), NEW.veleszuletett_mutetek_leirasa);

  INSERT INTO patient_dental_status (patient_id, meglevo_fogak, meglevo_implantatumok, nem_ismert_poziciokban_implantatum, nem_ismert_poziciokban_implantatum_reszletek, felso_fogpotlas_van, felso_fogpotlas_mikor, felso_fogpotlas_keszito, felso_fogpotlas_elegedett, felso_fogpotlas_problema, felso_fogpotlas_tipus, also_fogpotlas_van, also_fogpotlas_mikor, also_fogpotlas_keszito, also_fogpotlas_elegedett, also_fogpotlas_problema, also_fogpotlas_tipus)
  VALUES (NEW.id, COALESCE(NEW.meglevo_fogak, '{}'::jsonb), COALESCE(NEW.meglevo_implantatumok, '{}'::jsonb), COALESCE(NEW.nem_ismert_poziciokban_implantatum, false), NEW.nem_ismert_poziciokban_implantatum_reszletek, COALESCE(NEW.felso_fogpotlas_van, false), NEW.felso_fogpotlas_mikor, NEW.felso_fogpotlas_keszito, COALESCE(NEW.felso_fogpotlas_elegedett, true), NEW.felso_fogpotlas_problema, NEW.felso_fogpotlas_tipus, COALESCE(NEW.also_fogpotlas_van, false), NEW.also_fogpotlas_mikor, NEW.also_fogpotlas_keszito, COALESCE(NEW.also_fogpotlas_elegedett, true), NEW.also_fogpotlas_problema, NEW.also_fogpotlas_tipus);

  INSERT INTO patient_treatment_plans (patient_id, kezelesi_terv_felso, kezelesi_terv_also, kezelesi_terv_arcot_erinto, kortorteneti_osszefoglalo, kezelesi_terv_melleklet, szakorvosi_velemeny)
  VALUES (NEW.id, COALESCE(NEW.kezelesi_terv_felso, '[]'::jsonb), COALESCE(NEW.kezelesi_terv_also, '[]'::jsonb), COALESCE(NEW.kezelesi_terv_arcot_erinto, '[]'::jsonb), NEW.kortorteneti_osszefoglalo, NEW.kezelesi_terv_melleklet, NEW.szakorvosi_velemeny);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER patients_full_insert
  INSTEAD OF INSERT ON patients_full
  FOR EACH ROW EXECUTE FUNCTION patients_full_insert_fn();

-- UPDATE trigger
CREATE OR REPLACE FUNCTION patients_full_update_fn() RETURNS TRIGGER AS $$
BEGIN
  UPDATE patients SET
    nev = NEW.nev, taj = NEW.taj, telefonszam = NEW.telefonszam,
    szuletesi_datum = NEW.szuletesi_datum, nem = NEW.nem, email = NEW.email,
    cim = NEW.cim, varos = NEW.varos, iranyitoszam = NEW.iranyitoszam,
    kezeleoorvos = NEW.kezeleoorvos, kezeleoorvos_intezete = NEW.kezeleoorvos_intezete,
    felvetel_datuma = NEW.felvetel_datuma, halal_datum = NEW.halal_datum,
    intake_status = NEW.intake_status,
    updated_at = COALESCE(NEW.updated_at, CURRENT_TIMESTAMP),
    updated_by = NEW.updated_by
  WHERE id = OLD.id;

  UPDATE patient_referral SET
    beutalo_orvos = NEW.beutalo_orvos, beutalo_intezmeny = NEW.beutalo_intezmeny,
    beutalo_indokolas = NEW.beutalo_indokolas, primer_mutet_leirasa = NEW.primer_mutet_leirasa,
    mutet_ideje = NEW.mutet_ideje, szovettani_diagnozis = NEW.szovettani_diagnozis,
    nyaki_blokkdisszekcio = NEW.nyaki_blokkdisszekcio
  WHERE patient_id = OLD.id;

  UPDATE patient_anamnesis SET
    kezelesre_erkezes_indoka = NEW.kezelesre_erkezes_indoka,
    alkoholfogyasztas = NEW.alkoholfogyasztas, dohanyzas_szam = NEW.dohanyzas_szam,
    maxilladefektus_van = COALESCE(NEW.maxilladefektus_van, false),
    brown_fuggoleges_osztaly = NEW.brown_fuggoleges_osztaly,
    brown_vizszintes_komponens = NEW.brown_vizszintes_komponens,
    mandibuladefektus_van = COALESCE(NEW.mandibuladefektus_van, false),
    kovacs_dobak_osztaly = NEW.kovacs_dobak_osztaly,
    nyelvmozgasok_akadalyozottak = COALESCE(NEW.nyelvmozgasok_akadalyozottak, false),
    gombocos_beszed = COALESCE(NEW.gombocos_beszed, false),
    nyalmirigy_allapot = NEW.nyalmirigy_allapot,
    fabian_fejerdy_protetikai_osztaly = NEW.fabian_fejerdy_protetikai_osztaly,
    fabian_fejerdy_protetikai_osztaly_felso = NEW.fabian_fejerdy_protetikai_osztaly_felso,
    fabian_fejerdy_protetikai_osztaly_also = NEW.fabian_fejerdy_protetikai_osztaly_also,
    radioterapia = COALESCE(NEW.radioterapia, false),
    radioterapia_dozis = NEW.radioterapia_dozis,
    radioterapia_datum_intervallum = NEW.radioterapia_datum_intervallum,
    chemoterapia = COALESCE(NEW.chemoterapia, false),
    chemoterapia_leiras = NEW.chemoterapia_leiras,
    tnm_staging = NEW.tnm_staging, bno = NEW.bno, diagnozis = NEW.diagnozis,
    baleset_idopont = NEW.baleset_idopont,
    baleset_etiologiaja = NEW.baleset_etiologiaja,
    baleset_egyeb = NEW.baleset_egyeb,
    veleszuletett_rendellenessegek = COALESCE(NEW.veleszuletett_rendellenessegek, '[]'::jsonb),
    veleszuletett_mutetek_leirasa = NEW.veleszuletett_mutetek_leirasa
  WHERE patient_id = OLD.id;

  UPDATE patient_dental_status SET
    meglevo_fogak = COALESCE(NEW.meglevo_fogak, '{}'::jsonb),
    meglevo_implantatumok = COALESCE(NEW.meglevo_implantatumok, '{}'::jsonb),
    nem_ismert_poziciokban_implantatum = COALESCE(NEW.nem_ismert_poziciokban_implantatum, false),
    nem_ismert_poziciokban_implantatum_reszletek = NEW.nem_ismert_poziciokban_implantatum_reszletek,
    felso_fogpotlas_van = COALESCE(NEW.felso_fogpotlas_van, false),
    felso_fogpotlas_mikor = NEW.felso_fogpotlas_mikor,
    felso_fogpotlas_keszito = NEW.felso_fogpotlas_keszito,
    felso_fogpotlas_elegedett = COALESCE(NEW.felso_fogpotlas_elegedett, true),
    felso_fogpotlas_problema = NEW.felso_fogpotlas_problema,
    felso_fogpotlas_tipus = NEW.felso_fogpotlas_tipus,
    also_fogpotlas_van = COALESCE(NEW.also_fogpotlas_van, false),
    also_fogpotlas_mikor = NEW.also_fogpotlas_mikor,
    also_fogpotlas_keszito = NEW.also_fogpotlas_keszito,
    also_fogpotlas_elegedett = COALESCE(NEW.also_fogpotlas_elegedett, true),
    also_fogpotlas_problema = NEW.also_fogpotlas_problema,
    also_fogpotlas_tipus = NEW.also_fogpotlas_tipus
  WHERE patient_id = OLD.id;

  UPDATE patient_treatment_plans SET
    kezelesi_terv_felso = COALESCE(NEW.kezelesi_terv_felso, '[]'::jsonb),
    kezelesi_terv_also = COALESCE(NEW.kezelesi_terv_also, '[]'::jsonb),
    kezelesi_terv_arcot_erinto = COALESCE(NEW.kezelesi_terv_arcot_erinto, '[]'::jsonb),
    kortorteneti_osszefoglalo = NEW.kortorteneti_osszefoglalo,
    kezelesi_terv_melleklet = NEW.kezelesi_terv_melleklet,
    szakorvosi_velemeny = NEW.szakorvosi_velemeny
  WHERE patient_id = OLD.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER patients_full_update
  INSTEAD OF UPDATE ON patients_full
  FOR EACH ROW EXECUTE FUNCTION patients_full_update_fn();

-- DELETE trigger
CREATE OR REPLACE FUNCTION patients_full_delete_fn() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM patients WHERE id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER patients_full_delete
  INSTEAD OF DELETE ON patients_full
  FOR EACH ROW EXECUTE FUNCTION patients_full_delete_fn();

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. Indexes on child tables
-- ══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_patient_referral_beutalo_orvos ON patient_referral(beutalo_orvos);
CREATE INDEX IF NOT EXISTS idx_patient_referral_beutalo_intezmeny ON patient_referral(beutalo_intezmeny);
CREATE INDEX IF NOT EXISTS idx_patient_anamnesis_erkezes_indoka ON patient_anamnesis(kezelesre_erkezes_indoka);
CREATE INDEX IF NOT EXISTS idx_patient_dental_status_fogak_gin ON patient_dental_status USING GIN (meglevo_fogak);
CREATE INDEX IF NOT EXISTS idx_patient_dental_status_implant_gin ON patient_dental_status USING GIN (meglevo_implantatumok);
CREATE INDEX IF NOT EXISTS idx_patient_treatment_plans_arcot_gin ON patient_treatment_plans USING GIN (kezelesi_terv_arcot_erinto);

COMMIT;

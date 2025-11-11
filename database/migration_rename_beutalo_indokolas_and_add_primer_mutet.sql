-- Migráció: Beutaló indokolás átnevezése és Primer műtét leírása hozzáadása
-- Run with: psql -d <db> -f database/migration_rename_beutalo_indokolas_and_add_primer_mutet.sql

-- 1. Átnevezzük a mutet_rovid_leirasa oszlopot beutalo_indokolas-ra
ALTER TABLE patients 
RENAME COLUMN mutet_rovid_leirasa TO beutalo_indokolas;

-- 2. Hozzáadjuk a primer_mutet_leirasa oszlopot
ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS primer_mutet_leirasa TEXT;

-- 3. Hozzáadjuk a hiányzó anamnézis mezőket (trauma esetén)
ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS baleset_idopont DATE;

ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS baleset_etiologiaja TEXT;

ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS baleset_egyeb TEXT;

-- 4. Hozzáadjuk a hiányzó anamnézis mezőket (veleszületett esetén)
ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS veleszuletett_rendellenessegek JSONB DEFAULT '[]'::jsonb;

ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS veleszuletett_mutetek_leirasa TEXT;

-- Kommentek
COMMENT ON COLUMN patients.beutalo_indokolas IS 'Beutaló indokolása (BEUTALÓ szekció)';
COMMENT ON COLUMN patients.primer_mutet_leirasa IS 'Primer műtét leírása (ONKOLÓGIAI szekció, szabadszavas)';
COMMENT ON COLUMN patients.baleset_idopont IS 'Baleset időpontja (TRAUMA esetén)';
COMMENT ON COLUMN patients.baleset_etiologiaja IS 'Baleset etiológiája (TRAUMA esetén, szabadszavas)';
COMMENT ON COLUMN patients.baleset_egyeb IS 'Egyéb körülmények, műtétek (TRAUMA esetén, szabadszavas)';
COMMENT ON COLUMN patients.veleszuletett_rendellenessegek IS 'Veleszületett rendellenességek (JSONB tömb: ["kemény szájpadhasadék", "lágyszájpad inszufficiencia", stb.])';
COMMENT ON COLUMN patients.veleszuletett_mutetek_leirasa IS 'Műtétek leírása, legutolsó beavatkozás (VELESZÜLETETT esetén, szabadszavas)';


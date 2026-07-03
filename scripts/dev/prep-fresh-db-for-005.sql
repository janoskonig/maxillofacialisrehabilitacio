-- Friss (dev/sim) DB előkészítése a 005_normalize_patients futásához.
--
-- A 005 a patients tábla PRE-normalizált oszlopait mozgatja altáblákba, majd
-- eldobja őket. Friss felállásnál néhány ilyen oszlop hiányzik, mert csak a
-- bootstrapból (jogosan) kizárt, destruktív migration_recreate_table.sql
-- hozta létre. Üres patients táblán tartalmi kockázat nincs: itt pótoljuk
-- őket IF NOT EXISTS-szel, a 005 pedig normalizálás után törli mindet.
--
-- Futtatás (lásd scripts/sim/README.md):
--   psql -h 127.0.0.1 -U maxfac -d <db> -f scripts/dev/prep-fresh-db-for-005.sql

ALTER TABLE patients ADD COLUMN IF NOT EXISTS beutalo_orvos VARCHAR(255);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS beutalo_intezmeny VARCHAR(255);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS beutalo_indokolas TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS primer_mutet_leirasa TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS mutet_ideje DATE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS szovettani_diagnozis TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS nyaki_blokkdisszekcio VARCHAR(50);

ALTER TABLE patients ADD COLUMN IF NOT EXISTS kezelesre_erkezes_indoka VARCHAR(100);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS alkoholfogyasztas TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS dohanyzas_szam TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS maxilladefektus_van BOOLEAN;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS brown_fuggoleges_osztaly VARCHAR(1);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS brown_vizszintes_komponens VARCHAR(1);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS mandibuladefektus_van BOOLEAN;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS kovacs_dobak_osztaly VARCHAR(1);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS nyelvmozgasok_akadalyozottak BOOLEAN;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS gombocos_beszed BOOLEAN;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS nyalmirigy_allapot VARCHAR(30);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS fabian_fejerdy_protetikai_osztaly VARCHAR(10);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS fabian_fejerdy_protetikai_osztaly_felso VARCHAR(10);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS fabian_fejerdy_protetikai_osztaly_also VARCHAR(10);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS radioterapia BOOLEAN;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS radioterapia_dozis TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS radioterapia_datum_intervallum TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS chemoterapia BOOLEAN;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS chemoterapia_leiras TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS tnm_staging TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS bno TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS diagnozis TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS baleset_idopont DATE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS baleset_etiologiaja TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS baleset_egyeb TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS veleszuletett_rendellenessegek JSONB;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS veleszuletett_mutetek_leirasa TEXT;

ALTER TABLE patients ADD COLUMN IF NOT EXISTS meglevo_fogak JSONB;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS meglevo_implantatumok JSONB;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS nem_ismert_poziciokban_implantatum BOOLEAN;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS nem_ismert_poziciokban_implantatum_reszletek TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS felso_fogpotlas_van BOOLEAN;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS felso_fogpotlas_mikor TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS felso_fogpotlas_keszito TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS felso_fogpotlas_elegedett BOOLEAN;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS felso_fogpotlas_problema TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS felso_fogpotlas_tipus VARCHAR(100);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS also_fogpotlas_van BOOLEAN;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS also_fogpotlas_mikor TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS also_fogpotlas_keszito TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS also_fogpotlas_elegedett BOOLEAN;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS also_fogpotlas_problema TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS also_fogpotlas_tipus VARCHAR(100);

ALTER TABLE patients ADD COLUMN IF NOT EXISTS kezelesi_terv_felso JSONB;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS kezelesi_terv_also JSONB;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS kezelesi_terv_arcot_erinto JSONB;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS kortorteneti_osszefoglalo TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS kezelesi_terv_melleklet TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS szakorvosi_velemeny TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS intake_status VARCHAR(50);

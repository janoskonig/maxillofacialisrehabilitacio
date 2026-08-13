BEGIN;

-- A törvényes képviselő (kiskorú páciens) mezők bekötése a patients_full VIEW-ba.
--
-- Előzmény: az 050-es migráció felvette a `patients.torvenyes_kepviselo_*`
-- oszlopokat, a POST /api/patients meg is követeli 18 év alatt — de a
-- patients_full VIEW (005) nem adta vissza őket, és a személyzeti űrlapon nem
-- volt hozzájuk mező. Így kiskorú beteget egyáltalán nem lehetett felvenni:
-- az API kérte a képviselő nevét, a UI-n viszont nem lehetett megadni.
--
-- Itt a view-t bővítjük (az új oszlopok a VÉGÉRE kerülnek — a CREATE OR REPLACE
-- VIEW csak így engedi), és az INSTEAD OF INSERT/UPDATE trigger függvényeket is
-- kiegészítjük, hogy a view-n keresztüli írás ne dobja el csendben az adatot.
--
-- A view többi része szó szerint a 005-ös definíció. Ha az 005 változik, ezt a
-- fájlt is frissíteni kell (a CREATE OR REPLACE VIEW szigorú: a meglévő oszlopok
-- neve/típusa/sorrendje nem térhet el).

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
  t.kortorteneti_osszefoglalo, t.kezelesi_terv_melleklet, t.szakorvosi_velemeny,
  -- legal guardian (050) — ÚJ oszlopok, kötelezően a lista végén
  p.torvenyes_kepviselo_nev, p.torvenyes_kepviselo_kapcsolat, p.torvenyes_kepviselo_email
FROM patients p
LEFT JOIN patient_referral r ON r.patient_id = p.id
LEFT JOIN patient_anamnesis a ON a.patient_id = p.id
LEFT JOIN patient_dental_status d ON d.patient_id = p.id
LEFT JOIN patient_treatment_plans t ON t.patient_id = p.id;

-- Az INSTEAD OF INSERT/UPDATE triggerek core-tábla ága kiegészítve. A többi ág
-- (referral / anamnesis / dental / treatment plans) változatlan, ezért csak a
-- `patients` írását tartalmazó részt gépeljük újra a teljes függvényben.

CREATE OR REPLACE FUNCTION patients_full_insert_fn() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO patients (id, nev, taj, telefonszam, szuletesi_datum, nem, email, cim, varos, iranyitoszam, kezeleoorvos, kezeleoorvos_intezete, felvetel_datuma, halal_datum, intake_status, torvenyes_kepviselo_nev, torvenyes_kepviselo_kapcsolat, torvenyes_kepviselo_email, created_at, updated_at, created_by, updated_by)
  VALUES (COALESCE(NEW.id, gen_random_uuid()), NEW.nev, NEW.taj, NEW.telefonszam, NEW.szuletesi_datum, NEW.nem, NEW.email, NEW.cim, NEW.varos, NEW.iranyitoszam, NEW.kezeleoorvos, NEW.kezeleoorvos_intezete, NEW.felvetel_datuma, NEW.halal_datum, NEW.intake_status, NEW.torvenyes_kepviselo_nev, NEW.torvenyes_kepviselo_kapcsolat, NEW.torvenyes_kepviselo_email, COALESCE(NEW.created_at, CURRENT_TIMESTAMP), COALESCE(NEW.updated_at, CURRENT_TIMESTAMP), NEW.created_by, NEW.updated_by)
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

CREATE OR REPLACE FUNCTION patients_full_update_fn() RETURNS TRIGGER AS $$
BEGIN
  UPDATE patients SET
    nev = NEW.nev, taj = NEW.taj, telefonszam = NEW.telefonszam,
    szuletesi_datum = NEW.szuletesi_datum, nem = NEW.nem, email = NEW.email,
    cim = NEW.cim, varos = NEW.varos, iranyitoszam = NEW.iranyitoszam,
    kezeleoorvos = NEW.kezeleoorvos, kezeleoorvos_intezete = NEW.kezeleoorvos_intezete,
    felvetel_datuma = NEW.felvetel_datuma, halal_datum = NEW.halal_datum,
    intake_status = NEW.intake_status,
    torvenyes_kepviselo_nev = NEW.torvenyes_kepviselo_nev,
    torvenyes_kepviselo_kapcsolat = NEW.torvenyes_kepviselo_kapcsolat,
    torvenyes_kepviselo_email = NEW.torvenyes_kepviselo_email,
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

COMMIT;

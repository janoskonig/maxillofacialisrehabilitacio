/**
 * Single source of truth for patient SELECT columns used by export-neak and
 * generate-equity-request-pdf. Ensures identical Patient shape and no drift.
 * Return type of route patient query = Patient; PDF generators receive Patient.
 */

/** SQL column expressions (col as "alias") for SELECT. Order and aliases are canonical. */
export const patientSelectColumns = (): readonly string[] =>
  [
    'id as "id"',
    'nev as "nev"',
    'taj as "taj"',
    'telefonszam as "telefonszam"',
    'szuletesi_datum as "szuletesiDatum"',
    'nem as "nem"',
    'email as "email"',
    'cim as "cim"',
    'varos as "varos"',
    'iranyitoszam as "iranyitoszam"',
    'beutalo_orvos as "beutaloOrvos"',
    'beutalo_intezmeny as "beutaloIntezmeny"',
    'beutalo_indokolas as "beutaloIndokolas"',
    'primer_mutet_leirasa as "primerMutetLeirasa"',
    'mutet_ideje as "mutetIdeje"',
    'szovettani_diagnozis as "szovettaniDiagnozis"',
    'nyaki_blokkdisszekcio as "nyakiBlokkdisszekcio"',
    'alkoholfogyasztas as "alkoholfogyasztas"',
    'dohanyzas_szam as "dohanyzasSzam"',
    'kezelesre_erkezes_indoka as "kezelesreErkezesIndoka"',
    'maxilladefektus_van as "maxilladefektusVan"',
    'brown_fuggoleges_osztaly as "brownFuggolegesOsztaly"',
    'brown_vizszintes_komponens as "brownVizszintesKomponens"',
    'mandibuladefektus_van as "mandibuladefektusVan"',
    'kovacs_dobak_osztaly as "kovacsDobakOsztaly"',
    'nyelvmozgasok_akadalyozottak as "nyelvmozgásokAkadályozottak"',
    'gombocos_beszed as "gombocosBeszed"',
    'nyalmirigy_allapot as "nyalmirigyAllapot"',
    'fabian_fejerdy_protetikai_osztaly_felso as "fabianFejerdyProtetikaiOsztalyFelso"',
    'fabian_fejerdy_protetikai_osztaly_also as "fabianFejerdyProtetikaiOsztalyAlso"',
    'radioterapia as "radioterapia"',
    'radioterapia_dozis as "radioterapiaDozis"',
    'radioterapia_datum_intervallum as "radioterapiaDatumIntervallum"',
    'chemoterapia as "chemoterapia"',
    'chemoterapia_leiras as "chemoterapiaLeiras"',
    'fabian_fejerdy_protetikai_osztaly as "fabianFejerdyProtetikaiOsztaly"',
    'kezeleoorvos as "kezeleoorvos"',
    'kezeleoorvos_intezete as "kezeleoorvosIntezete"',
    'felvetel_datuma as "felvetelDatuma"',
    'felso_fogpotlas_van as "felsoFogpotlasVan"',
    'felso_fogpotlas_mikor as "felsoFogpotlasMikor"',
    'felso_fogpotlas_keszito as "felsoFogpotlasKeszito"',
    'felso_fogpotlas_elegedett as "felsoFogpotlasElegedett"',
    'felso_fogpotlas_problema as "felsoFogpotlasProblema"',
    'also_fogpotlas_van as "alsoFogpotlasVan"',
    'also_fogpotlas_mikor as "alsoFogpotlasMikor"',
    'also_fogpotlas_keszito as "alsoFogpotlasKeszito"',
    'also_fogpotlas_elegedett as "alsoFogpotlasElegedett"',
    'also_fogpotlas_problema as "alsoFogpotlasProblema"',
    'meglevo_fogak as "meglevoFogak"',
    'felso_fogpotlas_tipus as "felsoFogpotlasTipus"',
    'also_fogpotlas_tipus as "alsoFogpotlasTipus"',
    'meglevo_implantatumok as "meglevoImplantatumok"',
    'nem_ismert_poziciokban_implantatum as "nemIsmertPoziciokbanImplantatum"',
    'nem_ismert_poziciokban_implantatum_reszletek as "nemIsmertPoziciokbanImplantatumRészletek"',
    'tnm_staging as "tnmStaging"',
    'bno as "bno"',
    'diagnozis as "diagnozis"',
    'baleset_idopont as "balesetIdopont"',
    'baleset_etiologiaja as "balesetEtiologiaja"',
    'baleset_egyeb as "balesetEgyeb"',
    'veleszuletett_rendellenessegek as "veleszuletettRendellenessegek"',
    'veleszuletett_mutetek_leirasa as "veleszuletettMutetekLeirasa"',
    'kezelesi_terv_felso as "kezelesiTervFelso"',
    'kezelesi_terv_also as "kezelesiTervAlso"',
    'kezelesi_terv_arcot_erinto as "kezelesiTervArcotErinto"',
    'kortorteneti_osszefoglalo as "kortortenetiOsszefoglalo"',
    'kezelesi_terv_melleklet as "kezelesiTervMelleklet"',
    'szakorvosi_velemeny as "szakorvosiVelemény"',
    'created_at as "createdAt"',
  ] as const;

/** Build full SELECT sql: SELECT ... FROM patients_full WHERE id = $1 */
export function patientSelectSql(): string {
  return `SELECT ${patientSelectColumns().join(', ')} FROM patients_full WHERE id = $1`;
}

const DATE_KEYS = [
  'szuletesiDatum',
  'mutetIdeje',
  'felvetelDatuma',
  'balesetIdopont',
  'createdAt',
] as const;

/** Normalize date fields from DB (Date) to ISO date string for Patient shape. */
export function normalizePatientRow<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row } as T;
  for (const key of DATE_KEYS) {
    const v = out[key];
    if (v instanceof Date) {
      (out as Record<string, unknown>)[key] = v.toISOString().split('T')[0];
    } else if (v != null && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      (out as Record<string, unknown>)[key] = v.split('T')[0];
    }
  }
  return out;
}

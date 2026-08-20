import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { patientSchema } from '@/lib/types';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { normalizeToTreatmentTypeCode } from '@/lib/treatment-type-normalize';
import { sendAppointmentTimeSlotFreedNotification } from '@/lib/email';
import { deleteGoogleCalendarEvent, createGoogleCalendarEvent } from '@/lib/google-calendar';
import { logActivity, logActivityWithAuth } from '@/lib/activity';
import { reconcileMissingDataTasksSilent } from '@/lib/missing-data-reminders';
import { recomputeReferrerUserIdSilent } from '@/lib/recompute-referrer';
import { recomputeDerivedNumericsSilent } from '@/lib/derived-numerics';
import { syncAutoCreatedIntakeEpisodeSilent } from '@/lib/patient-intake-episode';
import { applyKezeleoorvosFromForm } from '@/lib/kezeleoorvos-assignment';
import { getPatientCompletenessRow } from '@/lib/patient-data-completeness';
import { getPlausibilityWarnings } from '@/lib/data-plausibility';
import { PATIENT_SELECT_FIELDS } from '@/lib/queries/patient-fields';
import {
  compareLockToken,
  parseLockToken,
  restoreUpdatedAtTrigger,
  SKIP_UPDATED_AT_TRIGGER,
} from '@/lib/patient-lock-token';
import { logger } from '@/lib/logger';
import { closePatientCareOnDeath } from '@/lib/patient-death-care';
import type { Pool } from 'pg';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

// ─── Constants for change tracking ──────────────────────────────────────────

const DATE_FIELDS = new Set([
  'szuletesi_datum', 'mutet_ideje', 'felvetel_datuma', 'felso_fogpotlas_mikor',
  'also_fogpotlas_mikor', 'baleset_idopont', 'arajanlatkero_datuma', 'halal_datum',
]);

const JSON_ARRAY_FIELDS = new Set([
  'kezelesi_terv_felso', 'kezelesi_terv_also', 'kezelesi_terv_arcot_erinto',
  'veleszuletett_rendellenessegek',
]);

const FIELD_DISPLAY_NAMES: Record<string, string> = {
  nev: 'Név',
  taj: 'TAJ szám',
  telefonszam: 'Telefonszám',
  szuletesi_datum: 'Születési dátum',
  nem: 'Nem',
  email: 'Email',
  cim: 'Cím',
  varos: 'Város',
  iranyitoszam: 'Irányítószám',
  torvenyes_kepviselo_nev: 'Törvényes képviselő neve',
  torvenyes_kepviselo_kapcsolat: 'Törvényes képviselő kapcsolata',
  torvenyes_kepviselo_email: 'Törvényes képviselő email címe',
  beutalo_orvos: 'Beutaló orvos',
  beutalo_intezmeny: 'Beutaló intézmény',
  beutalo_indokolas: 'Beutaló indokolás',
  primer_mutet_leirasa: 'Primer műtét leírása',
  mutet_ideje: 'Műtét ideje',
  szovettani_diagnozis: 'Szövettani diagnózis',
  nyaki_blokkdisszekcio: 'Nyaki blokkdisszekció',
  alkoholfogyasztas: 'Alkoholfogyasztás',
  dohanyzas_szam: 'Dohányzás',
  kezelesre_erkezes_indoka: 'Kezelésre érkezés indoka',
  maxilladefektus_van: 'Maxilladefektus',
  brown_fuggoleges_osztaly: 'Brown függőleges osztály',
  brown_vizszintes_komponens: 'Brown vízszintes komponens',
  mandibuladefektus_van: 'Mandibuladefektus',
  kovacs_dobak_osztaly: 'Kovács-Dobák osztály',
  nyelvmozgasok_akadalyozottak: 'Nyelvmozgások akadályozottak',
  gombocos_beszed: 'Gombócos beszéd',
  nyalmirigy_allapot: 'Nyálmirigy állapot',
  fabian_fejerdy_protetikai_osztaly_felso: 'Fábián-Fejérdy osztály (felső)',
  fabian_fejerdy_protetikai_osztaly_also: 'Fábián-Fejérdy osztály (alsó)',
  radioterapia: 'Radioterápia',
  radioterapia_dozis: 'Radioterápia dózis',
  radioterapia_datum_intervallum: 'Radioterápia dátumintervallum',
  chemoterapia: 'Kemoterápia',
  chemoterapia_leiras: 'Kemoterápia leírás',
  fabian_fejerdy_protetikai_osztaly: 'Fábián-Fejérdy protetikai osztály',
  kezeleoorvos: 'Kezelőorvos',
  kezeleoorvos_intezete: 'Kezelőorvos intézete',
  felvetel_datuma: 'Felvétel dátuma',
  felso_fogpotlas_van: 'Felső fogpótlás van',
  felso_fogpotlas_mikor: 'Felső fogpótlás mikor',
  felso_fogpotlas_keszito: 'Felső fogpótlás készítő',
  felso_fogpotlas_elegedett: 'Felső fogpótlás elégedett',
  felso_fogpotlas_problema: 'Felső fogpótlás probléma',
  also_fogpotlas_van: 'Alsó fogpótlás van',
  also_fogpotlas_mikor: 'Alsó fogpótlás mikor',
  also_fogpotlas_keszito: 'Alsó fogpótlás készítő',
  also_fogpotlas_elegedett: 'Alsó fogpótlás elégedett',
  also_fogpotlas_problema: 'Alsó fogpótlás probléma',
  felso_fogpotlas_tipus: 'Felső fogpótlás típus',
  also_fogpotlas_tipus: 'Alsó fogpótlás típus',
  tnm_staging: 'TNM staging',
  bno: 'BNO',
  diagnozis: 'Diagnózis',
  kezelesi_terv_felso: 'Kezelési terv (felső)',
  kortorteneti_osszefoglalo: 'Kórtörténeti összefoglaló',
  kezelesi_terv_melleklet: 'Kezelési terv melléklet',
  szakorvosi_velemeny: 'Szakorvosi vélemény',
  halal_datum: 'Halál dátuma',
  arajanlatkero_szoveg: 'Árajánlatkérő szöveg',
  arajanlatkero_datuma: 'Árajánlatkérő dátuma',
  kezelesi_terv_also: 'Kezelési terv (alsó)',
  kezelesi_terv_arcot_erinto: 'Kezelési terv (arcot érintő rehabilitáció)',
};

/**
 * Maps DB column names (snake_case) to the camelCase property names used
 * by the validated patient object. Only entries that differ from the naive
 * snake_to_camel conversion are listed; the rest fall back to a generic
 * converter.
 */
const DB_TO_CAMEL: Record<string, string> = {
  szuletesi_datum: 'szuletesiDatum',
  beutalo_orvos: 'beutaloOrvos',
  beutalo_intezmeny: 'beutaloIntezmeny',
  beutalo_indokolas: 'beutaloIndokolas',
  primer_mutet_leirasa: 'primerMutetLeirasa',
  mutet_ideje: 'mutetIdeje',
  szovettani_diagnozis: 'szovettaniDiagnozis',
  nyaki_blokkdisszekcio: 'nyakiBlokkdisszekcio',
  dohanyzas_szam: 'dohanyzasSzam',
  kezelesre_erkezes_indoka: 'kezelesreErkezesIndoka',
  maxilladefektus_van: 'maxilladefektusVan',
  brown_fuggoleges_osztaly: 'brownFuggolegesOsztaly',
  brown_vizszintes_komponens: 'brownVizszintesKomponens',
  mandibuladefektus_van: 'mandibuladefektusVan',
  kovacs_dobak_osztaly: 'kovacsDobakOsztaly',
  nyelvmozgasok_akadalyozottak: 'nyelvmozgásokAkadályozottak',
  gombocos_beszed: 'gombocosBeszed',
  nyalmirigy_allapot: 'nyalmirigyAllapot',
  fabian_fejerdy_protetikai_osztaly_felso: 'fabianFejerdyProtetikaiOsztalyFelso',
  fabian_fejerdy_protetikai_osztaly_also: 'fabianFejerdyProtetikaiOsztalyAlso',
  radioterapia_dozis: 'radioterapiaDozis',
  radioterapia_datum_intervallum: 'radioterapiaDatumIntervallum',
  chemoterapia_leiras: 'chemoterapiaLeiras',
  fabian_fejerdy_protetikai_osztaly: 'fabianFejerdyProtetikaiOsztaly',
  kezeleoorvos_intezete: 'kezeleoorvosIntezete',
  felvetel_datuma: 'felvetelDatuma',
  felso_fogpotlas_van: 'felsoFogpotlasVan',
  felso_fogpotlas_mikor: 'felsoFogpotlasMikor',
  felso_fogpotlas_keszito: 'felsoFogpotlasKeszito',
  felso_fogpotlas_elegedett: 'felsoFogpotlasElegedett',
  felso_fogpotlas_problema: 'felsoFogpotlasProblema',
  also_fogpotlas_van: 'alsoFogpotlasVan',
  also_fogpotlas_mikor: 'alsoFogpotlasMikor',
  also_fogpotlas_keszito: 'alsoFogpotlasKeszito',
  also_fogpotlas_elegedett: 'alsoFogpotlasElegedett',
  also_fogpotlas_problema: 'alsoFogpotlasProblema',
  felso_fogpotlas_tipus: 'felsoFogpotlasTipus',
  also_fogpotlas_tipus: 'alsoFogpotlasTipus',
  tnm_staging: 'tnmStaging',
  kezelesi_terv_felso: 'kezelesiTervFelso',
  kezelesi_terv_also: 'kezelesiTervAlso',
  kezelesi_terv_arcot_erinto: 'kezelesiTervArcotErinto',
  kortorteneti_osszefoglalo: 'kortortenetiOsszefoglalo',
  kezelesi_terv_melleklet: 'kezelesiTervMelleklet',
  szakorvosi_velemeny: 'szakorvosiVelemény',
  halal_datum: 'halalDatum',
  baleset_idopont: 'balesetIdopont',
  baleset_etiologiaja: 'balesetEtiologiaja',
  baleset_egyeb: 'balesetEgyeb',
  veleszuletett_rendellenessegek: 'veleszuletettRendellenessegek',
  veleszuletett_mutetek_leirasa: 'veleszuletettMutetekLeirasa',
  nem_ismert_poziciokban_implantatum: 'nemIsmertPoziciokbanImplantatum',
  nem_ismert_poziciokban_implantatum_reszletek: 'nemIsmertPoziciokbanImplantatumRészletek',
  meglevo_fogak: 'meglevoFogak',
  meglevo_implantatumok: 'meglevoImplantatumok',
};

/**
 * A beteg-mentés eredménye. A konfliktust NEM kivételként adjuk vissza: a
 * `handleApiError` lapos `{ error: string }` alakot építene, a kliens
 * (lib/storage.ts) viszont csak objektum-`error`-ból olvassa ki a `code`-ot —
 * `HttpError`-ral a STALE_WRITE banner némán elmaradna.
 */
type PatientUpdateResult =
  | { ok: true; patient: Record<string, unknown>; lockToken: Date | null }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'stale'; serverUpdatedAt: Date | null; clientUpdatedAt: Date | null };

/**
 * Per-table UPDATE queries for normalized patients schema.
 *
 * Az optimista zár ellenőrzése **ebben a tranzakcióban**, compare-and-swap
 * formában történik: az `If-Match` token bekerül a `patients` UPDATE `WHERE`
 * ágába, így az ellenőrzés és az írás atomi. A korábbi megoldás a tranzakción
 * kívül olvasott és hasonlított, az írás pedig csak utána indult — a kettő között
 * egy fog-kezelés lezárása felülírhatta a fogtérképet, és a már jóváhagyott
 * autosave némán visszaírta a régit. (2026-08-15)
 *
 * Szándékosan nincs explicit `SELECT ... FOR UPDATE`: a kulcsot nem érintő UPDATE
 * `FOR NO KEY UPDATE` zárat vesz, ami nem ütközik a `patients(id)`-re hivatkozó
 * gyermektáblák INSERT-jeinek `FOR KEY SHARE` zárával — egy erősebb zár a chat-,
 * időpont- és dokumentum-írásokat is a mentés mögé sorolná.
 */
async function executePatientUpdate(
  pool: Pool,
  patientId: string,
  patient: ValidatedPatient,
  userEmail: string,
  ifMatch: string | null,
  correlationId: string
): Promise<PatientUpdateResult> {
  const casToken = ifMatch ? parseLockToken(ifMatch) : null;
  if (ifMatch && !casToken) {
    logger.warn(`[PUT /api/patients/${patientId}] Invalid If-Match date format: ${ifMatch}`, {
      correlationId,
      userEmail,
    });
  }

  let lockToken: Date | null = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) CAS-kapu. A `$19 IS NULL` ág a hiányzó/olvashatatlan If-Match backward-compat
    //    átengedése; az `updated_at IS NULL` ág azt a mai viselkedést tartja, hogy
    //    szerveroldali token hiányában nincs konfliktus.
    //
    //    MINDKÉT OLDAL EZREDMÁSODPERCRE IGAZÍTVA. A `patients.updated_at` teljes
    //    (mikroszekundumos) `timestamptz`, a token viszont körbejár egy JS `Date`-en,
    //    ami ms-re csonkol — nyers `updated_at = $19` összehasonlítással a predikátum
    //    gyakorlatilag SOHA nem találna egyezést, és minden mentés hamis 409-et kapna.
    //    Ezért a tárolt érték is ms-igazítottan íródik (`date_trunc`), a `GREATEST` ág
    //    pedig garantálja, hogy a token szigorúan növekedjen akkor is, ha két írás
    //    ugyanabba az ezredmásodpercbe esik.
    const casResult = await client.query(
      `UPDATE patients SET nev=$2, taj=$3, telefonszam=$4, szuletesi_datum=$5, nem=$6, email=$7, cim=$8, varos=$9, iranyitoszam=$10, kezeleoorvos=$11, kezeleoorvos_intezete=$12, felvetel_datuma=$13, halal_datum=$14, torvenyes_kepviselo_nev=$15, torvenyes_kepviselo_kapcsolat=$16, torvenyes_kepviselo_email=$17,
             updated_at = GREATEST(
               date_trunc('milliseconds', clock_timestamp()),
               date_trunc('milliseconds', updated_at) + interval '1 millisecond'
             ),
             updated_by=$18
        WHERE id=$1
          AND ($19::timestamptz IS NULL OR updated_at IS NULL OR date_trunc('milliseconds', updated_at) = $19::timestamptz)
          AND ${SKIP_UPDATED_AT_TRIGGER}
       RETURNING updated_at`,
      [patientId, patient.nev, patient.taj||null, patient.telefonszam||null, patient.szuletesiDatum||null, patient.nem||null, patient.email||null, patient.cim||null, patient.varos||null, patient.iranyitoszam||null, patient.kezeleoorvos||null, patient.kezeleoorvosIntezete||null, patient.felvetelDatuma||null, patient.halalDatum||null, patient.torvenyesKepviseloNev||null, patient.torvenyesKepviseloKapcsolat||null, patient.torvenyesKepviseloEmail||null, userEmail, casToken]
    );
    // A skip-flag tranzakció-lokális: a gyermektáblák írása előtt vissza kell adni
    // a triggernek a saját dolgát.
    await restoreUpdatedAtTrigger(client);

    if (casResult.rows.length === 0) {
      // Nem írtunk semmit. Két oka lehet: nincs ilyen beteg, vagy elavult a token.
      const probe = await client.query(`SELECT updated_at FROM patients WHERE id = $1`, [patientId]);
      await client.query('ROLLBACK');
      if (probe.rows.length === 0) {
        return { ok: false, reason: 'not_found' };
      }
      return {
        ok: false,
        reason: 'stale',
        serverUpdatedAt: parseLockToken(probe.rows[0].updated_at),
        clientUpdatedAt: casToken,
      };
    }

    lockToken = parseLockToken(casResult.rows[0].updated_at);

    // A halálozási dátum egyben ellátási zárás: minden nyitott epizódot,
    // recall/egyéb epizódfeladatot és nyitott ütemezési szándékot ugyanebben
    // a tranzakcióban lezárunk. A DB-trigger ugyanezt az invariánst védi a
    // nem alkalmazáson keresztüli írásoknál; a művelet idempotens.
    if (patient.halalDatum) {
      await closePatientCareOnDeath(client, patientId);
    }

    // 2) A gyermektáblák csak a kapun túl íródnak — elavult tokennél semmi nem változik.
    await Promise.all([
      client.query(
        `INSERT INTO patient_referral (patient_id, beutalo_orvos, beutalo_intezmeny, beutalo_indokolas, primer_mutet_leirasa, mutet_ideje, szovettani_diagnozis, nyaki_blokkdisszekcio)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (patient_id) DO UPDATE SET beutalo_orvos=EXCLUDED.beutalo_orvos, beutalo_intezmeny=EXCLUDED.beutalo_intezmeny, beutalo_indokolas=EXCLUDED.beutalo_indokolas, primer_mutet_leirasa=EXCLUDED.primer_mutet_leirasa, mutet_ideje=EXCLUDED.mutet_ideje, szovettani_diagnozis=EXCLUDED.szovettani_diagnozis, nyaki_blokkdisszekcio=EXCLUDED.nyaki_blokkdisszekcio`,
        [patientId, patient.beutaloOrvos||null, patient.beutaloIntezmeny||null, patient.beutaloIndokolas||null, patient.primerMutetLeirasa||null, patient.mutetIdeje||null, patient.szovettaniDiagnozis||null, patient.nyakiBlokkdisszekcio||null]
      ),
      client.query(
        `INSERT INTO patient_anamnesis (patient_id, kezelesre_erkezes_indoka, alkoholfogyasztas, dohanyzas_szam, maxilladefektus_van, brown_fuggoleges_osztaly, brown_vizszintes_komponens, mandibuladefektus_van, kovacs_dobak_osztaly, nyelvmozgasok_akadalyozottak, gombocos_beszed, nyalmirigy_allapot, fabian_fejerdy_protetikai_osztaly, fabian_fejerdy_protetikai_osztaly_felso, fabian_fejerdy_protetikai_osztaly_also, radioterapia, radioterapia_dozis, radioterapia_datum_intervallum, chemoterapia, chemoterapia_leiras, tnm_staging, bno, diagnozis, baleset_idopont, baleset_etiologiaja, baleset_egyeb, veleszuletett_rendellenessegek, veleszuletett_mutetek_leirasa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb,$28)
         ON CONFLICT (patient_id) DO UPDATE SET kezelesre_erkezes_indoka=EXCLUDED.kezelesre_erkezes_indoka, alkoholfogyasztas=EXCLUDED.alkoholfogyasztas, dohanyzas_szam=EXCLUDED.dohanyzas_szam, maxilladefektus_van=EXCLUDED.maxilladefektus_van, brown_fuggoleges_osztaly=EXCLUDED.brown_fuggoleges_osztaly, brown_vizszintes_komponens=EXCLUDED.brown_vizszintes_komponens, mandibuladefektus_van=EXCLUDED.mandibuladefektus_van, kovacs_dobak_osztaly=EXCLUDED.kovacs_dobak_osztaly, nyelvmozgasok_akadalyozottak=EXCLUDED.nyelvmozgasok_akadalyozottak, gombocos_beszed=EXCLUDED.gombocos_beszed, nyalmirigy_allapot=EXCLUDED.nyalmirigy_allapot, fabian_fejerdy_protetikai_osztaly=EXCLUDED.fabian_fejerdy_protetikai_osztaly, fabian_fejerdy_protetikai_osztaly_felso=EXCLUDED.fabian_fejerdy_protetikai_osztaly_felso, fabian_fejerdy_protetikai_osztaly_also=EXCLUDED.fabian_fejerdy_protetikai_osztaly_also, radioterapia=EXCLUDED.radioterapia, radioterapia_dozis=EXCLUDED.radioterapia_dozis, radioterapia_datum_intervallum=EXCLUDED.radioterapia_datum_intervallum, chemoterapia=EXCLUDED.chemoterapia, chemoterapia_leiras=EXCLUDED.chemoterapia_leiras, tnm_staging=EXCLUDED.tnm_staging, bno=EXCLUDED.bno, diagnozis=EXCLUDED.diagnozis, baleset_idopont=EXCLUDED.baleset_idopont, baleset_etiologiaja=EXCLUDED.baleset_etiologiaja, baleset_egyeb=EXCLUDED.baleset_egyeb, veleszuletett_rendellenessegek=EXCLUDED.veleszuletett_rendellenessegek, veleszuletett_mutetek_leirasa=EXCLUDED.veleszuletett_mutetek_leirasa`,
        [patientId, patient.kezelesreErkezesIndoka||null, patient.alkoholfogyasztas||null, patient.dohanyzasSzam||null, patient.maxilladefektusVan??null, patient.brownFuggolegesOsztaly||null, patient.brownVizszintesKomponens||null, patient.mandibuladefektusVan??null, patient.kovacsDobakOsztaly||null, patient.nyelvmozgásokAkadályozottak??null, patient.gombocosBeszed??null, patient.nyalmirigyAllapot||null, patient.fabianFejerdyProtetikaiOsztaly||null, patient.fabianFejerdyProtetikaiOsztalyFelso||null, patient.fabianFejerdyProtetikaiOsztalyAlso||null, patient.radioterapia||false, patient.radioterapiaDozis||null, patient.radioterapiaDatumIntervallum||null, patient.chemoterapia||false, patient.chemoterapiaLeiras||null, patient.tnmStaging||null, patient.bno||null, patient.diagnozis||null, patient.balesetIdopont||null, patient.balesetEtiologiaja||null, patient.balesetEgyeb||null, Array.isArray(patient.veleszuletettRendellenessegek) ? JSON.stringify(patient.veleszuletettRendellenessegek) : '[]', patient.veleszuletettMutetekLeirasa||null]
      ),
      client.query(
        `INSERT INTO patient_dental_status (patient_id, meglevo_fogak, meglevo_implantatumok, nem_ismert_poziciokban_implantatum, nem_ismert_poziciokban_implantatum_reszletek, felso_fogpotlas_van, felso_fogpotlas_mikor, felso_fogpotlas_keszito, felso_fogpotlas_elegedett, felso_fogpotlas_problema, felso_fogpotlas_tipus, also_fogpotlas_van, also_fogpotlas_mikor, also_fogpotlas_keszito, also_fogpotlas_elegedett, also_fogpotlas_problema, also_fogpotlas_tipus)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (patient_id) DO UPDATE SET meglevo_fogak=EXCLUDED.meglevo_fogak, meglevo_implantatumok=EXCLUDED.meglevo_implantatumok, nem_ismert_poziciokban_implantatum=EXCLUDED.nem_ismert_poziciokban_implantatum, nem_ismert_poziciokban_implantatum_reszletek=EXCLUDED.nem_ismert_poziciokban_implantatum_reszletek, felso_fogpotlas_van=EXCLUDED.felso_fogpotlas_van, felso_fogpotlas_mikor=EXCLUDED.felso_fogpotlas_mikor, felso_fogpotlas_keszito=EXCLUDED.felso_fogpotlas_keszito, felso_fogpotlas_elegedett=EXCLUDED.felso_fogpotlas_elegedett, felso_fogpotlas_problema=EXCLUDED.felso_fogpotlas_problema, felso_fogpotlas_tipus=EXCLUDED.felso_fogpotlas_tipus, also_fogpotlas_van=EXCLUDED.also_fogpotlas_van, also_fogpotlas_mikor=EXCLUDED.also_fogpotlas_mikor, also_fogpotlas_keszito=EXCLUDED.also_fogpotlas_keszito, also_fogpotlas_elegedett=EXCLUDED.also_fogpotlas_elegedett, also_fogpotlas_problema=EXCLUDED.also_fogpotlas_problema, also_fogpotlas_tipus=EXCLUDED.also_fogpotlas_tipus`,
        [patientId, patient.meglevoFogak ? JSON.parse(JSON.stringify(patient.meglevoFogak)) : {}, patient.meglevoImplantatumok ? JSON.parse(JSON.stringify(patient.meglevoImplantatumok)) : {}, patient.nemIsmertPoziciokbanImplantatum||false, patient.nemIsmertPoziciokbanImplantatumRészletek||null, patient.felsoFogpotlasVan??null, patient.felsoFogpotlasMikor||null, patient.felsoFogpotlasKeszito||null, patient.felsoFogpotlasElegedett??null, patient.felsoFogpotlasProblema||null, patient.felsoFogpotlasTipus||null, patient.alsoFogpotlasVan??null, patient.alsoFogpotlasMikor||null, patient.alsoFogpotlasKeszito||null, patient.alsoFogpotlasElegedett??null, patient.alsoFogpotlasProblema||null, patient.alsoFogpotlasTipus||null]
      ),
      client.query(
        `INSERT INTO patient_treatment_plans (patient_id, kezelesi_terv_felso, kezelesi_terv_also, kezelesi_terv_arcot_erinto, kortorteneti_osszefoglalo, kezelesi_terv_melleklet, szakorvosi_velemeny)
         VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7)
         ON CONFLICT (patient_id) DO UPDATE SET kezelesi_terv_felso=EXCLUDED.kezelesi_terv_felso, kezelesi_terv_also=EXCLUDED.kezelesi_terv_also, kezelesi_terv_arcot_erinto=EXCLUDED.kezelesi_terv_arcot_erinto, kortorteneti_osszefoglalo=EXCLUDED.kortorteneti_osszefoglalo, kezelesi_terv_melleklet=EXCLUDED.kezelesi_terv_melleklet, szakorvosi_velemeny=EXCLUDED.szakorvosi_velemeny`,
        [patientId, Array.isArray(patient.kezelesiTervFelso) ? JSON.stringify(patient.kezelesiTervFelso) : '[]', Array.isArray(patient.kezelesiTervAlso) ? JSON.stringify(patient.kezelesiTervAlso) : '[]', Array.isArray(patient.kezelesiTervArcotErinto) ? JSON.stringify(patient.kezelesiTervArcotErinto) : '[]', patient.kortortenetiOsszefoglalo||null, patient.kezelesiTervMelleklet||null, patient.szakorvosiVelemény||null]
      ),
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // A visszaolvasás KÍVÜL van a try/finally-n: a tranzakció kliense addigra már
  // vissza van adva a poolnak. Ha bent maradna, minden párhuzamos beteg-PUT egy
  // kapcsolatot fogva kérne egy másodikat — `DB_POOL_MAX` (alap: 5) darab elég a
  // kölcsönös várakozáshoz, amit csak a 10 s-os connection timeout oldana fel.
  // (Mellékhatásként a `catch` sem küldene ROLLBACK-et egy már commitolt kapcsolatra.)
  const full = await pool.query(
    `SELECT ${PATIENT_SELECT_FIELDS} FROM patients_full WHERE id = $1`,
    [patientId]
  );
  const row = full.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    // A beteget a COMMIT és ezen olvasás között törölték. Üres objektumot adni
    // 200-zal adatvesztés lenne a kliensen (a form elveszítené az azonosítóját).
    return { ok: false, reason: 'not_found' };
  }
  // A tokent a tranzakcióból vesszük, nem ebből az olvasásból: a COMMIT után egy
  // sorban álló fog-lezárás azonnal commitolhat, és akkor ez az olvasás az ŐK
  // tokenjét adná vissza — amit a kliens a következő If-Match-ként küldve
  // csendben megkerülné a most bevezetett ellenőrzést.
  if (lockToken) row.updatedAt = lockToken.toISOString();
  return { ok: true, patient: row, lockToken };
}

// ─── Private utility functions ──────────────────────────────────────────────

function normalizeDate(val: unknown): string {
  if (!val) return '';
  try {
    const date = new Date(val as string);
    if (isNaN(date.getTime())) return String(val).trim();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return String(val).trim();
  }
}

function normalizeJSON(val: unknown): string {
  if (!val) return '{}';
  try {
    if (typeof val === 'string') {
      return normalizeJSON(JSON.parse(val));
    }
    if (Array.isArray(val)) {
      const sorted = val.map(item => {
        if (typeof item === 'object' && item !== null) {
          return Object.keys(item).sort().reduce((acc: Record<string, unknown>, key) => {
            acc[key] = (item as Record<string, unknown>)[key];
            return acc;
          }, {});
        }
        return item;
      });
      return JSON.stringify(sorted);
    }
    if (typeof val === 'object' && val !== null) {
      const sorted = Object.keys(val).sort().reduce((acc: Record<string, unknown>, key) => {
        acc[key] = (val as Record<string, unknown>)[key];
        return acc;
      }, {});
      return JSON.stringify(sorted);
    }
    return JSON.stringify(val);
  } catch {
    return JSON.stringify(val);
  }
}

function normalizeFieldValue(val: unknown, fieldName?: string): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (fieldName && DATE_FIELDS.has(fieldName)) return normalizeDate(val);
  if (fieldName && JSON_ARRAY_FIELDS.has(fieldName)) return normalizeJSON(val);
  if (typeof val === 'object') return normalizeJSON(val);
  return String(val).trim();
}

// ─── Extracted PUT-handler helpers ──────────────────────────────────────────

type ValidatedPatient = z.infer<typeof patientSchema>;

/**
 * Normalize treatment plan items and validate that every treatmentTypeCode
 * exists in the `treatment_types` table.
 *
 * Returns the updated patient object on success, or a 400 error response.
 */
async function validateAndNormalizeTreatmentPlan(
  pool: Pool,
  validatedPatient: ValidatedPatient,
  correlationId: string
): Promise<{ ok: true; patient: ValidatedPatient } | { ok: false; response: NextResponse }> {
  const validCodesResult = await pool.query(`SELECT code FROM treatment_types`);
  const validCodes = new Set(
    (validCodesResult.rows ?? []).map((r: { code: string }) => r.code)
  );

  const fieldErrors: Array<{ path: string; code: string; value: string }> = [];

  const normalizeItems = (
    arr: Array<{ tipus?: string | null; treatmentTypeCode?: string | null; tervezettAtadasDatuma?: string | null; elkeszult?: boolean }> | null | undefined,
    fieldPrefix: string
  ): Array<{ treatmentTypeCode: string; tervezettAtadasDatuma: string | null; elkeszult: boolean }> => {
    if (!arr || !Array.isArray(arr)) return [];
    const out: Array<{ treatmentTypeCode: string; tervezettAtadasDatuma: string | null; elkeszult: boolean }> = [];
    arr.forEach((item, idx) => {
      const code =
        normalizeToTreatmentTypeCode(item.treatmentTypeCode) ??
        normalizeToTreatmentTypeCode(item.tipus);
      if (!code || code.trim() === '') return;
      if (!validCodes.has(code)) {
        fieldErrors.push({
          path: `${fieldPrefix}.${idx}.treatmentTypeCode`,
          code: 'UNKNOWN_TREATMENT_TYPE_CODE',
          value: item.treatmentTypeCode ?? item.tipus ?? '',
        });
        return;
      }
      out.push({
        treatmentTypeCode: code,
        tervezettAtadasDatuma: item.tervezettAtadasDatuma ?? null,
        elkeszult: item.elkeszult ?? false,
      });
    });
    return out;
  };

  const normalizedFelso = normalizeItems(validatedPatient.kezelesiTervFelso, 'kezelesi_terv_felso');
  const normalizedAlso = normalizeItems(validatedPatient.kezelesiTervAlso, 'kezelesi_terv_also');

  if (fieldErrors.length > 0) {
    const response = NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'Invalid treatmentTypeCode', fieldErrors },
      { status: 400 }
    );
    response.headers.set('x-correlation-id', correlationId);
    return { ok: false, response };
  }

  return {
    ok: true,
    patient: {
      ...validatedPatient,
      kezelesiTervFelso: normalizedFelso,
      kezelesiTervAlso: normalizedAlso,
    },
  };
}

/**
 * If-Match / stale-write conflict detection.
 * Returns an error response when a conflict is detected, otherwise null.
 */
function buildStaleWriteResponse(
  serverUpdatedAt: Date | null,
  clientUpdatedAt: Date | null,
  correlationId: string
): NextResponse {
  // A beágyazott (objektum-) `error` alak KÖTELEZŐ: a kliens (lib/storage.ts) csak
  // ebből olvassa ki a `code`-ot, és a konfliktus-banner a STALE_WRITE kódra sül el.
  const response = NextResponse.json(
    {
      error: {
        name: 'ConflictError',
        status: 409,
        code: 'STALE_WRITE',
        message: 'Másik felhasználó módosította a beteg adatait közben. Kérjük, frissítse az oldalt és próbálja újra.',
        details: {
          serverUpdatedAt: serverUpdatedAt ? serverUpdatedAt.toISOString() : null,
          clientUpdatedAt: clientUpdatedAt ? clientUpdatedAt.toISOString() : null,
        },
        correlationId,
      },
    },
    { status: 409 }
  );
  response.headers.set('x-correlation-id', correlationId);
  return response;
}

function checkStaleWrite(
  ifMatch: string | null,
  oldPatient: Record<string, unknown>,
  patientId: string,
  correlationId: string,
  userEmail: string
): NextResponse | null {
  const comparison = compareLockToken(ifMatch, oldPatient.updated_at as string | null);

  if (comparison.verdict === 'stale') {
    return buildStaleWriteResponse(comparison.server, comparison.client, correlationId);
  }

  if (comparison.verdict === 'skipped') {
    if (!ifMatch) {
      logger.warn(`[PUT /api/patients/${patientId}] If-Match header missing - allowing update (backward compat)`, {
        correlationId,
        userEmail,
      });
    } else if (!comparison.client) {
      logger.warn(`[PUT /api/patients/${patientId}] Invalid If-Match date format: ${ifMatch}`, {
        correlationId,
        userEmail,
      });
    }
  }
  return null;
}

/**
 * Role-based authorization for editing a patient.
 * Returns an error response when the user is not allowed, otherwise null.
 */
async function checkEditPermission(
  pool: Pool,
  role: string | null,
  userEmail: string | null,
  oldPatient: Record<string, unknown>,
  correlationId: string
): Promise<NextResponse | null> {
  // All authenticated users can edit all patients
  return null;
}

/**
 * Checks that the TAJ number is unique across patients (excluding the current one).
 * Returns an error response on duplicate, otherwise null.
 */
async function checkTajUniqueness(
  pool: Pool,
  newTaj: string | null | undefined,
  oldTaj: string | null | undefined,
  patientId: string,
  correlationId: string
): Promise<NextResponse | null> {
  if (!newTaj || newTaj.trim() === '') return null;

  const normalizedTAJ = newTaj.replace(/-/g, '');
  const oldNormalizedTAJ = oldTaj ? oldTaj.replace(/-/g, '') : '';
  if (normalizedTAJ === oldNormalizedTAJ) return null;

  const existingPatient = await pool.query(
    `SELECT id, nev, taj FROM patients 
     WHERE REPLACE(taj, '-', '') = $1 AND id != $2`,
    [normalizedTAJ, patientId]
  );

  if (existingPatient.rows.length > 0) {
    const existing = existingPatient.rows[0];
    const response = NextResponse.json(
      {
        error: {
          name: 'ConflictError',
          status: 409,
          code: 'DUPLICATE_TAJ',
          message: 'Már létezik beteg ezzel a TAJ-számmal',
          details: `A TAJ-szám (${newTaj}) már használatban van. Beteg: ${existing.nev || 'Név nélküli'} (ID: ${existing.id})`,
          correlationId,
        },
      },
      { status: 409 }
    );
    response.headers.set('x-correlation-id', correlationId);
    return response;
  }
  return null;
}

/**
 * Detects field-level changes between the old DB row and the incoming update,
 * writes them to `patient_changes`, and creates an `activity_logs` entry.
 */
async function trackPatientChanges(
  pool: Pool,
  request: NextRequest,
  patientId: string,
  oldPatient: Record<string, unknown>,
  validatedPatient: ValidatedPatient,
  newPatient: Record<string, unknown>,
  userEmail: string
): Promise<void> {
  const ipHeader = request.headers.get('x-forwarded-for') || '';
  const ipAddress = ipHeader.split(',')[0]?.trim() || null;

  const changes: string[] = [];
  const structuredChanges: Array<{
    fieldName: string;
    fieldDisplayName: string;
    oldValue: string;
    newValue: string;
  }> = [];

  for (const [dbField, displayName] of Object.entries(FIELD_DISPLAY_NAMES)) {
    const oldVal = normalizeFieldValue(oldPatient[dbField], dbField);
    const camelField = DB_TO_CAMEL[dbField] ?? dbField.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    const newVal = normalizeFieldValue(
      (validatedPatient as Record<string, unknown>)[camelField] ?? (validatedPatient as Record<string, unknown>)[dbField],
      dbField
    );

    if (oldVal !== newVal) {
      changes.push(`${displayName}: "${oldVal || '(üres)'}" → "${newVal || '(üres)'}"`);
      structuredChanges.push({
        fieldName: dbField,
        fieldDisplayName: displayName,
        oldValue: oldVal,
        newValue: newVal,
      });
    }
  }

  const jsonbFields = [
    { db: 'meglevo_fogak', patient: 'meglevoFogak', name: 'Meglévő fogak' },
    { db: 'meglevo_implantatumok', patient: 'meglevoImplantatumok', name: 'Meglévő implantátumok' },
  ] as const;

  for (const { db, patient, name } of jsonbFields) {
    const oldJson = oldPatient[db] ? normalizeJSON(oldPatient[db]) : '{}';
    const newJson = (validatedPatient as Record<string, unknown>)[patient]
      ? normalizeJSON((validatedPatient as Record<string, unknown>)[patient])
      : '{}';
    if (oldJson !== newJson) {
      changes.push(`${name}: módosítva`);
      structuredChanges.push({
        fieldName: db,
        fieldDisplayName: name,
        oldValue: oldJson,
        newValue: newJson,
      });
    }
  }

  if (structuredChanges.length > 0) {
    for (const change of structuredChanges) {
      try {
        await pool.query(
          `INSERT INTO patient_changes (patient_id, field_name, field_display_name, old_value, new_value, changed_by, ip_address)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            patientId,
            change.fieldName,
            change.fieldDisplayName,
            change.oldValue || null,
            change.newValue || null,
            userEmail,
            ipAddress,
          ]
        );
      } catch (changeLogError) {
        logger.error('Failed to log structured change:', changeLogError);
      }
    }
  }

  const detailText = changes.length > 0
    ? `Patient ID: ${patientId}, Name: ${(newPatient.nev as string) || 'N/A'}; Módosítások: ${changes.join('; ')}`
    : `Patient ID: ${patientId}, Name: ${(newPatient.nev as string) || 'N/A'}; Nincs változás`;

  await logActivity(request, userEmail, 'patient_updated', detailText);
}

// ─── GET handler ────────────────────────────────────────────────────────────

// Requires a valid session: returns a patient's full PII + clinical record. The
// `technikus` role gets a reduced field set below; an unauthenticated caller must
// get nothing (middleware.ts does not reject unauthenticated requests).
export const GET = authedHandler(async (req, { auth, params, correlationId }) => {
    const pool = getDbPool();
    const role = auth?.role || null;
    const userEmail = auth?.email || null;
    const patientId = params.id;

    const result = await pool.query(
      `SELECT ${PATIENT_SELECT_FIELDS} FROM patients_full WHERE id = $1`,
      [patientId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }
    
    const patient = result.rows[0];
    
    if (role === 'technikus') {
      const TECHNIKUS_ALLOWED_FIELDS = new Set([
        'id', 'nev',
        'kezeleoorvos', 'kezeleoorvosIntezete',
        'kezelesiTervFelso', 'kezelesiTervAlso', 'kezelesiTervArcotErinto', 'kezelesiTervMelleklet',
        'createdAt', 'updatedAt',
      ]);
      for (const key of Object.keys(patient)) {
        if (!TECHNIKUS_ALLOWED_FIELDS.has(key)) {
          patient[key] = null;
        }
      }
    }

    if (auth) {
      await logActivityWithAuth(
        req,
        auth,
        'patient_viewed',
        `Patient ID: ${patientId}, Name: ${result.rows[0].nev || 'N/A'}`
      );
    }

    const response = NextResponse.json({ patient }, { status: 200 });
    response.headers.set('x-correlation-id', correlationId);
    return response;
});

// ─── PUT handler ────────────────────────────────────────────────────────────

export const PUT = authedHandler(async (req, { auth, params, correlationId }) => {
    const patientId = params.id;

    const body = await req.json();
    const parsed = patientSchema.parse(body);

    const pool = getDbPool();

    // 1. Validate & normalize treatment plan codes
    const treatmentResult = await validateAndNormalizeTreatmentPlan(pool, parsed, correlationId);
    if (!treatmentResult.ok) return treatmentResult.response;
    const validatedPatient = treatmentResult.patient;

    const ifMatch = req.headers.get('if-match');
    const saveSource = req.headers.get('x-save-source');
    const userEmail = auth.email;
    const userId = auth.userId;
    const role = auth.role;

    // 2. Fetch old patient for comparison & conflict detection
    const oldPatientResult = await pool.query(
      `SELECT * FROM patients_full WHERE id = $1`,
      [patientId]
    );

    if (oldPatientResult.rows.length === 0) {
      const response = NextResponse.json(
        {
          error: {
            name: 'NotFoundError',
            status: 404,
            message: 'Beteg nem található',
            correlationId,
          },
        },
        { status: 404 }
      );
      response.headers.set('x-correlation-id', correlationId);
      return response;
    }

    const oldPatient = oldPatientResult.rows[0];

    // 3. Conflict detection (If-Match / stale write) — ELŐSZŰRŐ.
    //    A döntő ellenőrzés az írási tranzakcióban van (executePatientUpdate CAS-kapuja);
    //    ez az ág megmarad, mert (a) kapcsolat- és tranzakciónyitás nélkül ad 409-et, és
    //    (b) a 409 precedenciáját tartja a DUPLICATE_TAJ (5. lépés) előtt — a kliens
    //    konfliktus-bannere csak a STALE_WRITE kódra sül el.
    const conflictResponse = checkStaleWrite(ifMatch, oldPatient, patientId, correlationId, userEmail);
    if (conflictResponse) return conflictResponse;

    // 4. Role-based edit permission
    const permResponse = await checkEditPermission(pool, role, userEmail, oldPatient, correlationId);
    if (permResponse) return permResponse;

    // 5. TAJ uniqueness
    const tajResponse = await checkTajUniqueness(pool, validatedPatient.taj, oldPatient.taj, patientId, correlationId);
    if (tajResponse) return tajResponse;

    // 6. Execute per-table updates in a transaction (a CAS-kapuval együtt)
    const updateResult = await executePatientUpdate(
      pool,
      patientId,
      validatedPatient,
      userEmail,
      ifMatch,
      correlationId
    );

    if (!updateResult.ok) {
      if (updateResult.reason === 'not_found') {
        // Verseny: a beteget a 2. lépés olvasása és a CAS között törölték. Korábban
        // ez az FK-sértésen 500-at adott, amit a kliens újra is próbált.
        const response = NextResponse.json(
          {
            error: {
              name: 'NotFoundError',
              status: 404,
              message: 'Beteg nem található',
              correlationId,
            },
          },
          { status: 404 }
        );
        response.headers.set('x-correlation-id', correlationId);
        return response;
      }
      return buildStaleWriteResponse(
        updateResult.serverUpdatedAt,
        updateResult.clientUpdatedAt,
        correlationId
      );
    }

    let newPatient = updateResult.patient;

    // 7. Change tracking & audit logging
    try {
      await trackPatientChanges(pool, req, patientId, oldPatient, validatedPatient, newPatient, userEmail);
    } catch (logError) {
      logger.error('Failed to log activity:', logError);
    }

    // 7b. Kezelőorvos: a form a nevet küldi → feloldjuk user_id-ra és KÉZI
    //     (ragadós) hozzárendelést rögzítünk, amit a recompute nem ír felül.
    //     Üres név → lekapcsolás (a recompute újra seedelhet). Ismeretlen név →
    //     a fenti UPDATE szabad szövege marad, nincs sticky bélyeg.
    let kezeleoorvosTouchedPatients = false;
    try {
      const assign = await applyKezeleoorvosFromForm(patientId, validatedPatient.kezeleoorvos, userId, pool);
      kezeleoorvosTouchedPatients = true;
      if (!assign.resolved) {
        logger.warn(`Kezelőorvos név nem feloldható ismert orvosra (beteg ${patientId}): "${validatedPatient.kezeleoorvos}"`);
      }
    } catch (assignErr) {
      logger.error('Kezelőorvos hozzárendelés sikertelen (update):', assignErr);
    }

    // 7c. Az applyKezeleoorvosFromForm egy MÁSODIK `UPDATE patients`-et futtat, ami a
    //     kezelőorvos-mezőket írja — ezeket újra kell olvasni, hogy a válasz a friss
    //     értéket hordozza.
    //
    //     A ZÁR-TOKENT viszont NEM vesszük át ebből az olvasásból. Két oka van:
    //     (1) a kezelőorvos-írás a 062 óta `app.skip_updated_at`-tel megy
    //         (lib/kezeleoorvos-assignment.ts), tehát nem is bumpol — a korábbi
    //         „önkonfliktus minden 2. mentésnél" indoklás elavult;
    //     (2) ez az olvasás a COMMIT után, zár nélkül fut, így egy közben commitolt
    //         IDEGEN írás (pl. fog-lezárás) tokenjét adhatná vissza. A kliens azt
    //         küldené következő If-Match-ként, és csendben megkerülné a CAS-kaput.
    if (kezeleoorvosTouchedPatients) {
      try {
        const fresh = await pool.query(
          `SELECT ${PATIENT_SELECT_FIELDS} FROM patients_full WHERE id = $1`,
          [patientId]
        );
        if (fresh.rows[0]) {
          const ownToken = newPatient.updatedAt;
          newPatient = fresh.rows[0];
          newPatient.updatedAt = ownToken;
        }
      } catch (rereadErr) {
        logger.error('Failed to re-read patient after kezelőorvos sync:', rereadErr);
      }
    }

    // 8. Create snapshot for manual saves
    if (saveSource === 'manual') {
      try {
        await pool.query(
          `INSERT INTO patient_snapshots (patient_id, snapshot_data, created_by_user_id, source, created_at)
           VALUES ($1, $2::jsonb, $3, $4, CURRENT_TIMESTAMP)`,
          [
            patientId,
            JSON.stringify(newPatient),
            userId,
            'manual',
          ]
        );
      } catch (snapshotError) {
        logger.error('Failed to create patient snapshot:', snapshotError);
      }
    }

    // 9. Ha az adatpótlással már teljes a beteg, a nyitott 'missing_data'
    //    feladatok azonnal záruljanak le (ne csak a heti cron / kézi pipa).
    reconcileMissingDataTasksSilent(patientId);

    // 9b. Beutaló orvos szöveges név → user_id FK frissítése (statisztika +
    //     megbízható emlékeztető-célzás). Fire-and-forget, nem blokkol.
    recomputeReferrerUserIdSilent(patientId);

    // 9c. Szabad szöveges numerikus mezők → származtatott numerikus oszlopok.
    recomputeDerivedNumericsSilent(patientId);

    // 9d. A felvételkor automatikusan nyitott epizód „félkész": a gyors felvétel
    //     űrlapon még nincs beutaló orvos / indokolás / etiológia. Amíg az
    //     epizód automatikus, nyitott és STAGE_0, a pótolt beutaló-adatok
    //     visszaíródnak rá. Fire-and-forget, nem blokkol.
    syncAutoCreatedIntakeEpisodeSilent(pool, patientId, validatedPatient);

    // 10. Tanácsadó adat-teljességi visszajelzés (nem blokkol) — a kliens
    //     jelezheti a hiányokat mentés után. Hiba esetén csendben kihagyjuk.
    let dataQuality = null;
    try {
      const row = await getPatientCompletenessRow(patientId);
      const warnings = getPlausibilityWarnings({
        taj: validatedPatient.taj,
        szuletesiDatum: validatedPatient.szuletesiDatum,
        halalDatum: validatedPatient.halalDatum,
      });
      if (row) {
        dataQuality = {
          completenessScore: row.completenessScore,
          researchReady: row.researchReady,
          clinicalMissing: row.clinicalMissing,
          researchMissing: row.researchMissing,
          warnings,
        };
      }
    } catch (qualityError) {
      logger.error('Failed to compute data quality:', qualityError);
    }

    const response = NextResponse.json({ patient: newPatient, dataQuality }, { status: 200 });
    response.headers.set('x-correlation-id', correlationId);
    return response;
});

// ─── DELETE handler ─────────────────────────────────────────────────────────

export const DELETE = roleHandler(['admin'], async (req, { auth, params }) => {
    const patientId = params.id;
    const pool = getDbPool();
    const userEmail = auth.email;
    
    // Get patient details
    const patientResult = await pool.query(
      'SELECT id, nev, taj, email FROM patients WHERE id = $1',
      [patientId]
    );

    if (patientResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }
    
    const patient = patientResult.rows[0];
    
    const appointmentResult = await pool.query(
      `SELECT 
        a.id,
        a.time_slot_id,
        a.dentist_email,
        a.google_calendar_event_id,
        ats.start_time,
        ats.user_id as time_slot_user_id,
        ats.source as time_slot_source,
        ats.google_calendar_event_id as time_slot_google_calendar_event_id,
        u.email as time_slot_user_email
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN users u ON ats.user_id = u.id
      WHERE a.patient_id = $1`,
      [patientId]
    );

    const appointments = appointmentResult.rows;

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Delete appointments and free up time slots
      for (const appointment of appointments) {
        // Delete the appointment
        await client.query('DELETE FROM appointments WHERE id = $1', [appointment.id]);

        // Update time slot status back to available
        await client.query(
          'UPDATE available_time_slots SET status = $1 WHERE id = $2',
          ['available', appointment.time_slot_id]
        );
      }

      // Delete the patient (this will cascade delete appointments due to ON DELETE CASCADE, but we already handled it)
      await client.query('DELETE FROM patients WHERE id = $1', [patientId]);

      await client.query('COMMIT');

      // Send email notifications and handle Google Calendar events for freed time slots
      for (const appointment of appointments) {
        const startTime = new Date(appointment.start_time);
        
        // Send email to dentist
        if (appointment.dentist_email) {
          try {
            await sendAppointmentTimeSlotFreedNotification(
              appointment.dentist_email,
              patient.nev,
              patient.taj,
              startTime,
              userEmail
            );
          } catch (emailError) {
            logger.error('Failed to send time slot freed email to dentist:', emailError);
            // Don't fail the request if email fails
          }
        }
        
        // Handle Google Calendar events
        if (appointment.google_calendar_event_id && appointment.time_slot_user_id) {
          try {
            // Naptár ID-k lekérése a felhasználó beállításaiból
            const userCalendarResult = await pool.query(
              `SELECT google_calendar_source_calendar_id, google_calendar_target_calendar_id 
               FROM users 
               WHERE id = $1`,
              [appointment.time_slot_user_id]
            );
            const sourceCalendarId = userCalendarResult.rows[0]?.google_calendar_source_calendar_id || 'primary';
            const targetCalendarId = userCalendarResult.rows[0]?.google_calendar_target_calendar_id || 'primary';
            
            // Töröljük a beteg nevével létrehozott eseményt a cél naptárból
            await deleteGoogleCalendarEvent(
              appointment.time_slot_user_id,
              appointment.google_calendar_event_id,
              targetCalendarId
            );
            logger.info('[Patient Deletion] Deleted patient event from target calendar');
            
            // Ha a time slot Google Calendar-ból származik, hozzuk vissza a "szabad" eseményt a forrás naptárba
            const isFromGoogleCalendar = appointment.time_slot_source === 'google_calendar' && appointment.time_slot_google_calendar_event_id;
            
            if (isFromGoogleCalendar) {
              const endTime = new Date(startTime);
              endTime.setMinutes(endTime.getMinutes() + 30); // 30 minutes duration
              
              // Létrehozzuk a "szabad" eseményt a forrás naptárba
              const szabadEventId = await createGoogleCalendarEvent(
                appointment.time_slot_user_id,
                {
                  summary: 'szabad',
                  description: 'Szabad időpont',
                  startTime: startTime,
                  endTime: endTime,
                  location: 'Maxillofaciális Rehabilitáció',
                  calendarId: sourceCalendarId,
                }
              );
              
              if (szabadEventId) {
                logger.info('[Patient Deletion] Recreated "szabad" event in source calendar');
                // Frissítjük a time slot google_calendar_event_id mezőjét az új esemény ID-jával
                await pool.query(
                  `UPDATE available_time_slots 
                   SET google_calendar_event_id = $1 
                   WHERE id = $2`,
                  [szabadEventId, appointment.time_slot_id]
                );
              } else {
                logger.error('[Patient Deletion] Failed to recreate "szabad" event in source calendar');
              }
            }
          } catch (error) {
            logger.error('Failed to handle Google Calendar event during patient deletion:', error);
            // Nem blokkolja a beteg törlését
          }
        }
      }

      // Send email to all admins about freed time slots
      if (appointments.length > 0) {
        try {
          const adminResult = await pool.query(
            'SELECT email FROM users WHERE role = $1 AND active = true',
            ['admin']
          );
          
          if (adminResult.rows.length > 0) {
            const adminEmails = adminResult.rows.map((row: any) => row.email);
            
            // Send notification for each freed appointment
            for (const appointment of appointments) {
              const startTime = new Date(appointment.start_time);
              try {
                await sendAppointmentTimeSlotFreedNotification(
                  adminEmails,
                  patient.nev,
                  patient.taj,
                  startTime,
                  userEmail,
                  appointment.dentist_email
                );
              } catch (emailError) {
                logger.error('Failed to send time slot freed email to admins:', emailError);
                // Don't fail the request if email fails
              }
            }
          }
        } catch (emailError) {
          logger.error('Failed to send time slot freed email to admins:', emailError);
          // Don't fail the request if email fails
        }
      }

      // Activity logging: patient deleted
      const appointmentInfo = appointments.length > 0 
        ? `, ${appointments.length} időpont törölve és felszabadítva`
        : '';
      await logActivity(
        req,
        userEmail,
        'patient_deleted',
        `Patient ID: ${patientId}, Name: ${patient.nev || 'N/A'}${appointmentInfo}`
      );

      return NextResponse.json(
        { 
          message: 'Beteg sikeresen törölve',
          appointmentsFreed: appointments.length
        },
        { status: 200 }
      );
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
});

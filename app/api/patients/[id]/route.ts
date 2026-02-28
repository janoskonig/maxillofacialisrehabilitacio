import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { patientSchema } from '@/lib/types';
import { optionalAuthHandler, authedHandler, roleHandler } from '@/lib/api/route-handler';
import { normalizeToTreatmentTypeCode } from '@/lib/treatment-type-normalize';
import { sendAppointmentTimeSlotFreedNotification } from '@/lib/email';
import { deleteGoogleCalendarEvent, createGoogleCalendarEvent } from '@/lib/google-calendar';
import { logActivity, logActivityWithAuth } from '@/lib/activity';
import { PATIENT_SELECT_FIELDS } from '@/lib/queries/patient-fields';
import { logger } from '@/lib/logger';
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

/** Per-table UPDATE queries for normalized patients schema. */
async function executePatientUpdate(
  pool: Pool,
  patientId: string,
  patient: ValidatedPatient,
  userEmail: string
): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await Promise.all([
      client.query(
        `UPDATE patients SET nev=$2, taj=$3, telefonszam=$4, szuletesi_datum=$5, nem=$6, email=$7, cim=$8, varos=$9, iranyitoszam=$10, kezeleoorvos=$11, kezeleoorvos_intezete=$12, felvetel_datuma=$13, halal_datum=$14, updated_at=CURRENT_TIMESTAMP, updated_by=$15 WHERE id=$1`,
        [patientId, patient.nev, patient.taj||null, patient.telefonszam||null, patient.szuletesiDatum||null, patient.nem||null, patient.email||null, patient.cim||null, patient.varos||null, patient.iranyitoszam||null, patient.kezeleoorvos||null, patient.kezeleoorvosIntezete||null, patient.felvetelDatuma||null, patient.halalDatum||null, userEmail]
      ),
      client.query(
        `UPDATE patient_referral SET beutalo_orvos=$2, beutalo_intezmeny=$3, beutalo_indokolas=$4, primer_mutet_leirasa=$5, mutet_ideje=$6, szovettani_diagnozis=$7, nyaki_blokkdisszekcio=$8 WHERE patient_id=$1`,
        [patientId, patient.beutaloOrvos||null, patient.beutaloIntezmeny||null, patient.beutaloIndokolas||null, patient.primerMutetLeirasa||null, patient.mutetIdeje||null, patient.szovettaniDiagnozis||null, patient.nyakiBlokkdisszekcio||null]
      ),
      client.query(
        `UPDATE patient_anamnesis SET kezelesre_erkezes_indoka=$2, alkoholfogyasztas=$3, dohanyzas_szam=$4, maxilladefektus_van=$5, brown_fuggoleges_osztaly=$6, brown_vizszintes_komponens=$7, mandibuladefektus_van=$8, kovacs_dobak_osztaly=$9, nyelvmozgasok_akadalyozottak=$10, gombocos_beszed=$11, nyalmirigy_allapot=$12, fabian_fejerdy_protetikai_osztaly=$13, fabian_fejerdy_protetikai_osztaly_felso=$14, fabian_fejerdy_protetikai_osztaly_also=$15, radioterapia=$16, radioterapia_dozis=$17, radioterapia_datum_intervallum=$18, chemoterapia=$19, chemoterapia_leiras=$20, tnm_staging=$21, bno=$22, diagnozis=$23, baleset_idopont=$24, baleset_etiologiaja=$25, baleset_egyeb=$26, veleszuletett_rendellenessegek=$27::jsonb, veleszuletett_mutetek_leirasa=$28 WHERE patient_id=$1`,
        [patientId, patient.kezelesreErkezesIndoka||null, patient.alkoholfogyasztas||null, patient.dohanyzasSzam||null, patient.maxilladefektusVan||false, patient.brownFuggolegesOsztaly||null, patient.brownVizszintesKomponens||null, patient.mandibuladefektusVan||false, patient.kovacsDobakOsztaly||null, patient.nyelvmozgásokAkadályozottak||false, patient.gombocosBeszed||false, patient.nyalmirigyAllapot||null, patient.fabianFejerdyProtetikaiOsztaly||null, patient.fabianFejerdyProtetikaiOsztalyFelso||null, patient.fabianFejerdyProtetikaiOsztalyAlso||null, patient.radioterapia||false, patient.radioterapiaDozis||null, patient.radioterapiaDatumIntervallum||null, patient.chemoterapia||false, patient.chemoterapiaLeiras||null, patient.tnmStaging||null, patient.bno||null, patient.diagnozis||null, patient.balesetIdopont||null, patient.balesetEtiologiaja||null, patient.balesetEgyeb||null, Array.isArray(patient.veleszuletettRendellenessegek) ? JSON.stringify(patient.veleszuletettRendellenessegek) : '[]', patient.veleszuletettMutetekLeirasa||null]
      ),
      client.query(
        `UPDATE patient_dental_status SET meglevo_fogak=$2, meglevo_implantatumok=$3, nem_ismert_poziciokban_implantatum=$4, nem_ismert_poziciokban_implantatum_reszletek=$5, felso_fogpotlas_van=$6, felso_fogpotlas_mikor=$7, felso_fogpotlas_keszito=$8, felso_fogpotlas_elegedett=$9, felso_fogpotlas_problema=$10, felso_fogpotlas_tipus=$11, also_fogpotlas_van=$12, also_fogpotlas_mikor=$13, also_fogpotlas_keszito=$14, also_fogpotlas_elegedett=$15, also_fogpotlas_problema=$16, also_fogpotlas_tipus=$17 WHERE patient_id=$1`,
        [patientId, patient.meglevoFogak ? JSON.parse(JSON.stringify(patient.meglevoFogak)) : {}, patient.meglevoImplantatumok ? JSON.parse(JSON.stringify(patient.meglevoImplantatumok)) : {}, patient.nemIsmertPoziciokbanImplantatum||false, patient.nemIsmertPoziciokbanImplantatumRészletek||null, patient.felsoFogpotlasVan||false, patient.felsoFogpotlasMikor||null, patient.felsoFogpotlasKeszito||null, patient.felsoFogpotlasElegedett??true, patient.felsoFogpotlasProblema||null, patient.felsoFogpotlasTipus||null, patient.alsoFogpotlasVan||false, patient.alsoFogpotlasMikor||null, patient.alsoFogpotlasKeszito||null, patient.alsoFogpotlasElegedett??true, patient.alsoFogpotlasProblema||null, patient.alsoFogpotlasTipus||null]
      ),
      client.query(
        `UPDATE patient_treatment_plans SET kezelesi_terv_felso=$2::jsonb, kezelesi_terv_also=$3::jsonb, kezelesi_terv_arcot_erinto=$4::jsonb, kortorteneti_osszefoglalo=$5, kezelesi_terv_melleklet=$6, szakorvosi_velemeny=$7 WHERE patient_id=$1`,
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

  const full = await pool.query(
    `SELECT ${PATIENT_SELECT_FIELDS} FROM patients_full WHERE id = $1`,
    [patientId]
  );
  return full.rows[0];
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
function checkStaleWrite(
  ifMatch: string | null,
  oldPatient: Record<string, unknown>,
  patientId: string,
  correlationId: string,
  userEmail: string
): NextResponse | null {
  if (ifMatch) {
    try {
      const clientUpdatedAt = new Date(ifMatch.trim());
      const serverUpdatedAt = oldPatient.updated_at
        ? new Date(oldPatient.updated_at as string)
        : null;

      if (serverUpdatedAt && clientUpdatedAt.getTime() !== serverUpdatedAt.getTime()) {
        const response = NextResponse.json(
          {
            error: {
              name: 'ConflictError',
              status: 409,
              code: 'STALE_WRITE',
              message: 'Másik felhasználó módosította a beteg adatait közben. Kérjük, frissítse az oldalt és próbálja újra.',
              details: {
                serverUpdatedAt: serverUpdatedAt.toISOString(),
                clientUpdatedAt: clientUpdatedAt.toISOString(),
              },
              correlationId,
            },
          },
          { status: 409 }
        );
        response.headers.set('x-correlation-id', correlationId);
        return response;
      }
    } catch (dateParseError) {
      logger.warn(`[PUT /api/patients/${patientId}] Invalid If-Match date format: ${ifMatch}`, {
        correlationId,
        userEmail,
        error: dateParseError,
      });
    }
  } else {
    logger.warn(`[PUT /api/patients/${patientId}] If-Match header missing - allowing update (backward compat)`, {
      correlationId,
      userEmail,
    });
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
  if (role === 'sebészorvos' && userEmail) {
    const userResult = await pool.query(
      `SELECT doktor_neve FROM users WHERE email = $1`,
      [userEmail]
    );

    if (userResult.rows.length > 0 && userResult.rows[0].doktor_neve) {
      if (oldPatient.beutalo_orvos !== userResult.rows[0].doktor_neve) {
        const response = NextResponse.json(
          {
            error: {
              name: 'ForbiddenError',
              status: 403,
              message: 'Nincs jogosultsága ehhez a beteg szerkesztéséhez. Csak a saját beutalt betegeit szerkesztheti.',
              correlationId,
            },
          },
          { status: 403 }
        );
        response.headers.set('x-correlation-id', correlationId);
        return response;
      }
    } else {
      const response = NextResponse.json(
        {
          error: {
            name: 'ForbiddenError',
            status: 403,
            message: 'Nincs jogosultsága ehhez a beteg szerkesztéséhez. Nincs beállítva doktor_neve.',
            correlationId,
          },
        },
        { status: 403 }
      );
      response.headers.set('x-correlation-id', correlationId);
      return response;
    }
  } else if (role === 'technikus') {
    const arcotErinto = oldPatient.kezelesi_terv_arcot_erinto;
    const hasEpitesis = arcotErinto && Array.isArray(arcotErinto) && arcotErinto.length > 0;
    if (!hasEpitesis) {
      const response = NextResponse.json(
        {
          error: {
            name: 'ForbiddenError',
            status: 403,
            message: 'Nincs jogosultsága ehhez a beteg szerkesztéséhez',
            correlationId,
          },
        },
        { status: 403 }
      );
      response.headers.set('x-correlation-id', correlationId);
      return response;
    }
  }
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
 * Builds the positional parameter array for the PATIENT_UPDATE_SQL query.
 */
function buildUpdateParams(
  patientId: string,
  patient: ValidatedPatient,
  userEmail: string
): unknown[] {
  return [
    patientId,
    patient.nev,
    patient.taj || null,
    patient.telefonszam || null,
    patient.szuletesiDatum || null,
    patient.nem || null,
    patient.email || null,
    patient.cim || null,
    patient.varos || null,
    patient.iranyitoszam || null,
    patient.beutaloOrvos || null,
    patient.beutaloIntezmeny || null,
    patient.beutaloIndokolas || null,
    patient.mutetIdeje || null,
    patient.szovettaniDiagnozis || null,
    patient.nyakiBlokkdisszekcio || null,
    patient.alkoholfogyasztas || null,
    patient.dohanyzasSzam || null,
    patient.kezelesreErkezesIndoka || null,
    patient.maxilladefektusVan || false,
    patient.brownFuggolegesOsztaly || null,
    patient.brownVizszintesKomponens || null,
    patient.mandibuladefektusVan || false,
    patient.kovacsDobakOsztaly || null,
    patient.nyelvmozgásokAkadályozottak || false,
    patient.gombocosBeszed || false,
    patient.nyalmirigyAllapot || null,
    patient.fabianFejerdyProtetikaiOsztalyFelso || null,
    patient.fabianFejerdyProtetikaiOsztalyAlso || null,
    patient.radioterapia || false,
    patient.radioterapiaDozis || null,
    patient.radioterapiaDatumIntervallum || null,
    patient.chemoterapia || false,
    patient.chemoterapiaLeiras || null,
    patient.fabianFejerdyProtetikaiOsztaly || null,
    patient.kezeleoorvos || null,
    patient.kezeleoorvosIntezete || null,
    patient.felvetelDatuma || null,
    patient.felsoFogpotlasVan || false,
    patient.felsoFogpotlasMikor || null,
    patient.felsoFogpotlasKeszito || null,
    patient.felsoFogpotlasElegedett ?? true,
    patient.felsoFogpotlasProblema || null,
    patient.alsoFogpotlasVan || false,
    patient.alsoFogpotlasMikor || null,
    patient.alsoFogpotlasKeszito || null,
    patient.alsoFogpotlasElegedett ?? true,
    patient.alsoFogpotlasProblema || null,
    patient.meglevoFogak
      ? JSON.parse(JSON.stringify(patient.meglevoFogak))
      : {},
    patient.felsoFogpotlasTipus || null,
    patient.alsoFogpotlasTipus || null,
    patient.meglevoImplantatumok
      ? JSON.parse(JSON.stringify(patient.meglevoImplantatumok))
      : {},
    patient.nemIsmertPoziciokbanImplantatum || false,
    patient.nemIsmertPoziciokbanImplantatumRészletek || null,
    patient.tnmStaging || null,
    patient.bno || null,
    patient.diagnozis || null,
    patient.primerMutetLeirasa || null,
    patient.balesetIdopont || null,
    patient.balesetEtiologiaja || null,
    patient.balesetEgyeb || null,
    patient.veleszuletettRendellenessegek && Array.isArray(patient.veleszuletettRendellenessegek)
      ? JSON.stringify(patient.veleszuletettRendellenessegek)
      : '[]',
    patient.veleszuletettMutetekLeirasa || null,
    patient.kezelesiTervFelso && Array.isArray(patient.kezelesiTervFelso)
      ? JSON.stringify(patient.kezelesiTervFelso)
      : '[]',
    patient.kezelesiTervAlso && Array.isArray(patient.kezelesiTervAlso)
      ? JSON.stringify(patient.kezelesiTervAlso)
      : '[]',
    patient.kezelesiTervArcotErinto && Array.isArray(patient.kezelesiTervArcotErinto)
      ? JSON.stringify(patient.kezelesiTervArcotErinto)
      : '[]',
    patient.kortortenetiOsszefoglalo || null,
    patient.kezelesiTervMelleklet || null,
    patient.szakorvosiVelemény || null,
    patient.halalDatum || null,
    userEmail,
  ];
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

export const GET = optionalAuthHandler(async (req, { auth, params, correlationId }) => {
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
    
    // Szerepkör alapú jogosultság ellenőrzés
    if (role === 'technikus') {
      // Technikus: csak azokat a betegeket látja, akikhez epitézist rendeltek
      const hasEpitesis = patient.kezelesiTervArcotErinto && 
                          Array.isArray(patient.kezelesiTervArcotErinto) && 
                          patient.kezelesiTervArcotErinto.length > 0;
      if (!hasEpitesis) {
        const response = NextResponse.json(
          {
            error: {
              name: 'ForbiddenError',
              status: 403,
              message: 'Nincs jogosultsága ehhez a beteghez',
              correlationId,
            },
          },
          { status: 403 }
        );
        response.headers.set('x-correlation-id', correlationId);
        return response;
      }
    }
    // fogpótlástanász, admin, editor, viewer: mindent látnak (nincs szűrés)

    if (auth) {
      await logActivityWithAuth(
        req,
        auth,
        'patient_viewed',
        `Patient ID: ${patientId}, Name: ${result.rows[0].nev || 'N/A'}`
      );
    }

    const response = NextResponse.json({ patient: result.rows[0] }, { status: 200 });
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

    // 3. Conflict detection (If-Match / stale write)
    const conflictResponse = checkStaleWrite(ifMatch, oldPatient, patientId, correlationId, userEmail);
    if (conflictResponse) return conflictResponse;

    // 4. Role-based edit permission
    const permResponse = await checkEditPermission(pool, role, userEmail, oldPatient, correlationId);
    if (permResponse) return permResponse;

    // 5. TAJ uniqueness
    const tajResponse = await checkTajUniqueness(pool, validatedPatient.taj, oldPatient.taj, patientId, correlationId);
    if (tajResponse) return tajResponse;

    // 6. Execute per-table updates in a transaction
    const newPatient = await executePatientUpdate(pool, patientId, validatedPatient, userEmail);

    if (!newPatient) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    // 7. Change tracking & audit logging
    try {
      await trackPatientChanges(pool, req, patientId, oldPatient, validatedPatient, newPatient, userEmail);
    } catch (logError) {
      logger.error('Failed to log activity:', logError);
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

    const response = NextResponse.json({ patient: newPatient }, { status: 200 });
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
    await pool.query('BEGIN');

    try {
      // Delete appointments and free up time slots
      for (const appointment of appointments) {
        // Delete the appointment
        await pool.query('DELETE FROM appointments WHERE id = $1', [appointment.id]);
        
        // Update time slot status back to available
        await pool.query(
          'UPDATE available_time_slots SET status = $1 WHERE id = $2',
          ['available', appointment.time_slot_id]
        );
      }

      // Delete the patient (this will cascade delete appointments due to ON DELETE CASCADE, but we already handled it)
      await pool.query('DELETE FROM patients WHERE id = $1', [patientId]);

      await pool.query('COMMIT');

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
      await pool.query('ROLLBACK');
      throw error;
    }
});

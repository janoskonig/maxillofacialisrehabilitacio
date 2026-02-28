import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { patientSchema } from '@/lib/types';
import { verifyAuth } from '@/lib/auth-server';
import { normalizeToTreatmentTypeCode } from '@/lib/treatment-type-normalize';
import { sendAppointmentTimeSlotFreedNotification } from '@/lib/email';
import { deleteGoogleCalendarEvent, createGoogleCalendarEvent } from '@/lib/google-calendar';
import { logActivity, logActivityWithAuth } from '@/lib/activity';
import { withCorrelation } from '@/lib/api/withCorrelation';
import { handleApiError } from '@/lib/api-error-handler';
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

const PATIENT_UPDATE_SQL = `UPDATE patients SET
  nev = $2,
  taj = $3,
  telefonszam = $4,
  szuletesi_datum = $5,
  nem = $6,
  email = $7,
  cim = $8,
  varos = $9,
  iranyitoszam = $10,
  beutalo_orvos = $11,
  beutalo_intezmeny = $12,
  beutalo_indokolas = $13,
  mutet_ideje = $14,
  szovettani_diagnozis = $15,
  nyaki_blokkdisszekcio = $16,
  alkoholfogyasztas = $17,
  dohanyzas_szam = $18,
  kezelesre_erkezes_indoka = $19,
  maxilladefektus_van = $20,
  brown_fuggoleges_osztaly = $21,
  brown_vizszintes_komponens = $22,
  mandibuladefektus_van = $23,
  kovacs_dobak_osztaly = $24,
  nyelvmozgasok_akadalyozottak = $25,
  gombocos_beszed = $26,
  nyalmirigy_allapot = $27,
  fabian_fejerdy_protetikai_osztaly_felso = $28,
  fabian_fejerdy_protetikai_osztaly_also = $29,
  radioterapia = $30,
  radioterapia_dozis = $31,
  radioterapia_datum_intervallum = $32,
  chemoterapia = $33,
  chemoterapia_leiras = $34,
  fabian_fejerdy_protetikai_osztaly = $35,
  kezeleoorvos = $36,
  kezeleoorvos_intezete = $37,
  felvetel_datuma = $38,
  felso_fogpotlas_van = $39,
  felso_fogpotlas_mikor = $40,
  felso_fogpotlas_keszito = $41,
  felso_fogpotlas_elegedett = $42,
  felso_fogpotlas_problema = $43,
  also_fogpotlas_van = $44,
  also_fogpotlas_mikor = $45,
  also_fogpotlas_keszito = $46,
  also_fogpotlas_elegedett = $47,
  also_fogpotlas_problema = $48,
  meglevo_fogak = $49,
  felso_fogpotlas_tipus = $50,
  also_fogpotlas_tipus = $51,
  meglevo_implantatumok = $52,
  nem_ismert_poziciokban_implantatum = $53,
  nem_ismert_poziciokban_implantatum_reszletek = $54,
  tnm_staging = $55,
  bno = $56,
  diagnozis = $57,
  primer_mutet_leirasa = $58,
  baleset_idopont = $59,
  baleset_etiologiaja = $60,
  baleset_egyeb = $61,
  veleszuletett_rendellenessegek = $62::jsonb,
  veleszuletett_mutetek_leirasa = $63,
  kezelesi_terv_felso = $64::jsonb,
  kezelesi_terv_also = $65::jsonb,
  kezelesi_terv_arcot_erinto = $66::jsonb,
  kortorteneti_osszefoglalo = $67,
  kezelesi_terv_melleklet = $68,
  szakorvosi_velemeny = $69,
  halal_datum = $70,
  updated_at = CURRENT_TIMESTAMP,
  updated_by = $71
WHERE id = $1
RETURNING 
  id, nev, taj, telefonszam, szuletesi_datum as "szuletesiDatum", nem,
  email, cim, varos, iranyitoszam, beutalo_orvos as "beutaloOrvos",
  beutalo_intezmeny as "beutaloIntezmeny", beutalo_indokolas as "beutaloIndokolas",
  primer_mutet_leirasa as "primerMutetLeirasa",
  mutet_ideje as "mutetIdeje", szovettani_diagnozis as "szovettaniDiagnozis",
  nyaki_blokkdisszekcio as "nyakiBlokkdisszekcio", alkoholfogyasztas,
  dohanyzas_szam as "dohanyzasSzam", kezelesre_erkezes_indoka as "kezelesreErkezesIndoka", maxilladefektus_van as "maxilladefektusVan",
  brown_fuggoleges_osztaly as "brownFuggolegesOsztaly",
  brown_vizszintes_komponens as "brownVizszintesKomponens",
  mandibuladefektus_van as "mandibuladefektusVan",
  kovacs_dobak_osztaly as "kovacsDobakOsztaly",
  nyelvmozgasok_akadalyozottak as "nyelvmozgásokAkadályozottak",
  gombocos_beszed as "gombocosBeszed", nyalmirigy_allapot as "nyalmirigyAllapot",
  fabian_fejerdy_protetikai_osztaly_felso as "fabianFejerdyProtetikaiOsztalyFelso",
  fabian_fejerdy_protetikai_osztaly_also as "fabianFejerdyProtetikaiOsztalyAlso",
  radioterapia, radioterapia_dozis as "radioterapiaDozis",
  radioterapia_datum_intervallum as "radioterapiaDatumIntervallum",
  chemoterapia, chemoterapia_leiras as "chemoterapiaLeiras",
  fabian_fejerdy_protetikai_osztaly as "fabianFejerdyProtetikaiOsztaly",
  kezeleoorvos, kezeleoorvos_intezete as "kezeleoorvosIntezete",
  felvetel_datuma as "felvetelDatuma",
  felso_fogpotlas_van as "felsoFogpotlasVan",
  felso_fogpotlas_mikor as "felsoFogpotlasMikor",
  felso_fogpotlas_keszito as "felsoFogpotlasKeszito",
  felso_fogpotlas_elegedett as "felsoFogpotlasElegedett",
  felso_fogpotlas_problema as "felsoFogpotlasProblema",
  also_fogpotlas_van as "alsoFogpotlasVan",
  also_fogpotlas_mikor as "alsoFogpotlasMikor",
  also_fogpotlas_keszito as "alsoFogpotlasKeszito",
  also_fogpotlas_elegedett as "alsoFogpotlasElegedett",
  also_fogpotlas_problema as "alsoFogpotlasProblema",
  meglevo_fogak as "meglevoFogak",
  felso_fogpotlas_tipus as "felsoFogpotlasTipus",
  also_fogpotlas_tipus as "alsoFogpotlasTipus",
  meglevo_implantatumok as "meglevoImplantatumok",
  nem_ismert_poziciokban_implantatum as "nemIsmertPoziciokbanImplantatum",
  nem_ismert_poziciokban_implantatum_reszletek as "nemIsmertPoziciokbanImplantatumRészletek",
  tnm_staging as "tnmStaging",
  bno, diagnozis, primer_mutet_leirasa as "primerMutetLeirasa",
  baleset_idopont as "balesetIdopont",
  baleset_etiologiaja as "balesetEtiologiaja",
  baleset_egyeb as "balesetEgyeb",
  veleszuletett_rendellenessegek as "veleszuletettRendellenessegek",
  veleszuletett_mutetek_leirasa as "veleszuletettMutetekLeirasa",
  kezelesi_terv_felso as "kezelesiTervFelso",
  kezelesi_terv_also as "kezelesiTervAlso",
  kezelesi_terv_arcot_erinto as "kezelesiTervArcotErinto",
  kortorteneti_osszefoglalo as "kortortenetiOsszefoglalo",
  kezelesi_terv_melleklet as "kezelesiTervMelleklet",
  szakorvosi_velemeny as "szakorvosiVelemény",
  halal_datum as "halalDatum",
  created_at as "createdAt", updated_at as "updatedAt",
  created_by as "createdBy", updated_by as "updatedBy"`;

// ─── Private utility functions ──────────────────────────────────────────────

function getCorrelationId(request: NextRequest): string {
  return request.headers.get('x-correlation-id')?.toLowerCase() || 
    (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 
     'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
       const r = (Math.random() * 16) | 0;
       const v = c === 'x' ? r : (r & 0x3) | 0x8;
       return v.toString(16);
     }));
}

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

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const correlationId = getCorrelationId(request);
  
  try {
    const pool = getDbPool();
    
    // Ellenőrizzük a felhasználó szerepkörét és jogosultságait
    const auth = await verifyAuth(request);
    const role = auth?.role || null;
    const userEmail = auth?.email || null;
    
    // Először lekérdezzük a beteget
    const result = await pool.query(
      `SELECT ${PATIENT_SELECT_FIELDS} FROM patients WHERE id = $1`,
      [params.id]
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

    // Activity logging: patient viewed (csak ha be van jelentkezve)
    const authForLogging = await verifyAuth(request);
    if (authForLogging) {
      await logActivityWithAuth(
        request,
        authForLogging,
        'patient_viewed',
        `Patient ID: ${params.id}, Name: ${result.rows[0].nev || 'N/A'}`
      );
    }

    const response = NextResponse.json({ patient: result.rows[0] }, { status: 200 });
    response.headers.set('x-correlation-id', correlationId);
    return response;
  } catch (error) {
    logger.error('Hiba a beteg lekérdezésekor:', error);
    return handleApiError(error, 'Hiba történt a beteg lekérdezésekor', correlationId);
  }
}

// ─── PUT handler ────────────────────────────────────────────────────────────

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const correlationId = getCorrelationId(request);
  
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      const response = NextResponse.json(
        {
          error: {
            name: 'UnauthorizedError',
            status: 401,
            message: 'Bejelentkezés szükséges a módosításhoz',
            correlationId,
          },
        },
        { status: 401 }
      );
      response.headers.set('x-correlation-id', correlationId);
      return response;
    }

    const body = await request.json();
    const parsed = patientSchema.parse(body);

    const pool = getDbPool();

    // 1. Validate & normalize treatment plan codes
    const treatmentResult = await validateAndNormalizeTreatmentPlan(pool, parsed, correlationId);
    if (!treatmentResult.ok) return treatmentResult.response;
    const validatedPatient = treatmentResult.patient;

    const ifMatch = request.headers.get('if-match');
    const saveSource = request.headers.get('x-save-source');
    const userEmail = auth.email;
    const userId = auth.userId;
    const role = auth.role;

    // 2. Fetch old patient for comparison & conflict detection
    const oldPatientResult = await pool.query(
      `SELECT *, updated_at FROM patients WHERE id = $1`,
      [params.id]
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
    const conflictResponse = checkStaleWrite(ifMatch, oldPatient, params.id, correlationId, userEmail);
    if (conflictResponse) return conflictResponse;

    // 4. Role-based edit permission
    const permResponse = await checkEditPermission(pool, role, userEmail, oldPatient, correlationId);
    if (permResponse) return permResponse;

    // 5. TAJ uniqueness
    const tajResponse = await checkTajUniqueness(pool, validatedPatient.taj, oldPatient.taj, params.id, correlationId);
    if (tajResponse) return tajResponse;

    // 6. Execute the update
    const updateParams = buildUpdateParams(params.id, validatedPatient, userEmail);
    const result = await pool.query(PATIENT_UPDATE_SQL, updateParams);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    // 7. Change tracking & audit logging
    try {
      await trackPatientChanges(pool, request, params.id, oldPatient, validatedPatient, result.rows[0], userEmail);
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
            params.id,
            JSON.stringify(result.rows[0]),
            userId,
            'manual',
          ]
        );
      } catch (snapshotError) {
        logger.error('Failed to create patient snapshot:', snapshotError);
      }
    }

    const response = NextResponse.json({ patient: result.rows[0] }, { status: 200 });
    response.headers.set('x-correlation-id', correlationId);
    return response;
  } catch (error: any) {
    logger.error('Hiba a beteg frissítésekor:', error);
    return handleApiError(error, 'Hiba történt a beteg frissítésekor', correlationId);
  }
}

// ─── DELETE handler ─────────────────────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Authorization: require authenticated user
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges a törléshez' },
        { status: 401 }
      );
    }

    // Only admin can delete patients
    if (auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Csak admin törölhet betegeket' },
        { status: 403 }
      );
    }

    const pool = getDbPool();
    const userEmail = auth.email;
    
    // Get patient details
    const patientResult = await pool.query(
      'SELECT id, nev, taj, email FROM patients WHERE id = $1',
      [params.id]
    );

    if (patientResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }
    
    const patient = patientResult.rows[0];
    
    // Check if patient has appointments
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
      [params.id]
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
      await pool.query('DELETE FROM patients WHERE id = $1', [params.id]);

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
        request,
        userEmail,
        'patient_deleted',
        `Patient ID: ${params.id}, Name: ${patient.nev || 'N/A'}${appointmentInfo}`
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
  } catch (error) {
    logger.error('Hiba a beteg törlésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt a beteg törlésekor' },
      { status: 500 }
    );
  }
}

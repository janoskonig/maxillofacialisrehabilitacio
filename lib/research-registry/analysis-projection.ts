/**
 * Elemzésre kész (analysis-ready) kutatási projekció.
 *
 * A meglévő de-identifikálásra (`research-patient-view`) épül, és kibővíti azt a
 * tudományos elemzéshez fontos, de-identifikált, NEM PHI változókkal (klinikai
 * klasszifikációk, kódolt kategóriák, származtatott numerikus értékek, OHIP-14
 * kimenet, adatminőség). A pontos születési dátum / irányítószám SOSEM kerül ki:
 * csak 5 éves életkor-sáv és 2 karakteres régió-előtag, anonimizált kulccsal.
 *
 * Egyetlen forrás (`ANALYSIS_VARIABLES`) írja le a változókat — ebből készül a
 * projekció, a kódkönyv és a Table 1 változó-listája is, hogy ne csússzanak szét.
 */

import {
  anonymizedSubjectKey,
  computeAgeBand,
  regionPrefixFromPostal,
} from './research-patient-view';
import type { CodebookEntry } from './codebook';

export type AnalysisVarKind = 'id' | 'categorical' | 'continuous';

export interface AnalysisVariable {
  key: string;
  label: string;
  kind: AnalysisVarKind;
  /** Kódkönyv-típus (integer/numeric/string/enum/boolean). */
  type: string;
  allowedValues?: string[];
  source: string;
  notes?: string;
}

const ETIOLOGIA_VALUES = [
  'traumás sérülés',
  'veleszületett rendellenesség',
  'onkológiai kezelés utáni állapot',
];

/** Az elemzési adatkészlet változói — a projekció, kódkönyv és Table 1 forrása. */
export const ANALYSIS_VARIABLES: AnalysisVariable[] = [
  { key: 'anonymized_subject_key', label: 'Anonim alany-kulcs', kind: 'id', type: 'string', source: 'derived (SHA-256)', notes: 'Nem visszafejthető; nincs benne közvetlen azonosító.' },
  { key: 'age_band_start', label: 'Életkor-sáv kezdete (5 év)', kind: 'continuous', type: 'integer', source: 'patients.szuletesi_datum → sáv', notes: 'Pontos születési dátum nem kerül ki.' },
  { key: 'region_prefix', label: 'Régió-előtag (irányítószám 2 jegy)', kind: 'categorical', type: 'string', source: 'patients.iranyitoszam[:2]' },
  { key: 'nem', label: 'Nem', kind: 'categorical', type: 'enum', allowedValues: ['ferfi', 'no'], source: 'patients.nem' },
  { key: 'etiologia', label: 'Kezelésre érkezés indoka', kind: 'categorical', type: 'enum', allowedValues: ETIOLOGIA_VALUES, source: 'patient_anamnesis.kezelesre_erkezes_indoka' },
  { key: 'maxilladefektus', label: 'Maxilladefektus', kind: 'categorical', type: 'boolean', source: 'patient_anamnesis.maxilladefektus_van' },
  { key: 'mandibuladefektus', label: 'Mandibuladefektus', kind: 'categorical', type: 'boolean', source: 'patient_anamnesis.mandibuladefektus_van' },
  { key: 'brown_fuggoleges', label: 'Brown-osztály (függőleges)', kind: 'categorical', type: 'enum', allowedValues: ['1', '2', '3', '4'], source: 'patient_anamnesis.brown_fuggoleges_osztaly' },
  { key: 'brown_vizszintes', label: 'Brown komponens (vízszintes)', kind: 'categorical', type: 'enum', allowedValues: ['a', 'b', 'c'], source: 'patient_anamnesis.brown_vizszintes_komponens' },
  { key: 'kovacs_dobak', label: 'Kovács-Dobák-osztály', kind: 'categorical', type: 'enum', allowedValues: ['1', '2', '3', '4', '5'], source: 'patient_anamnesis.kovacs_dobak_osztaly' },
  { key: 'tnm_staging', label: 'TNM-staging', kind: 'categorical', type: 'string', source: 'patient_anamnesis.tnm_staging', notes: 'Szabad szöveg; magas kardinalitású lehet.' },
  { key: 'radioterapia', label: 'Radioterápia', kind: 'categorical', type: 'boolean', source: 'patient_anamnesis.radioterapia' },
  { key: 'radioterapia_dozis_gy', label: 'Radioterápia dózis (Gy)', kind: 'continuous', type: 'numeric', source: 'patient_anamnesis.radioterapia_dozis_gy (származtatott)' },
  { key: 'chemoterapia', label: 'Kemoterápia', kind: 'categorical', type: 'boolean', source: 'patient_anamnesis.chemoterapia' },
  { key: 'dohanyzas_szam_ertek', label: 'Dohányzás (numerikus érték)', kind: 'continuous', type: 'numeric', source: 'patient_anamnesis.dohanyzas_szam_ertek (származtatott)' },
  { key: 'ohip_t0_total', label: 'OHIP-14 összpont (T0)', kind: 'continuous', type: 'numeric', source: 'ohip14_responses (T0)' },
  { key: 'ohip_t1_total', label: 'OHIP-14 összpont (T1)', kind: 'continuous', type: 'numeric', source: 'ohip14_responses (T1)' },
  { key: 'ohip_t2_total', label: 'OHIP-14 összpont (T2)', kind: 'continuous', type: 'numeric', source: 'ohip14_responses (T2)' },
  { key: 'ohip_t3_total', label: 'OHIP-14 összpont (T3)', kind: 'continuous', type: 'numeric', source: 'ohip14_responses (T3)' },
  { key: 'uwqol_composite_t0', label: 'UW-QOL kompozit (T0)', kind: 'continuous', type: 'numeric', source: 'pro_responses (UWQOL, T0)' },
  { key: 'uwqol_composite_t1', label: 'UW-QOL kompozit (T1)', kind: 'continuous', type: 'numeric', source: 'pro_responses (UWQOL, T1)' },
  { key: 'uwqol_composite_t2', label: 'UW-QOL kompozit (T2)', kind: 'continuous', type: 'numeric', source: 'pro_responses (UWQOL, T2)' },
  { key: 'uwqol_composite_t3', label: 'UW-QOL kompozit (T3)', kind: 'continuous', type: 'numeric', source: 'pro_responses (UWQOL, T3)' },
  { key: 'completeness_score', label: 'Adat-teljességi pontszám (0–100)', kind: 'continuous', type: 'numeric', source: 'patient-data-completeness' },
];

/** A projekció kimeneti sora (kulcsok = ANALYSIS_VARIABLES.key, PHI nélkül). */
export type AnalysisRow = Record<string, string | number | boolean | null>;

function asStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
function asNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function asBool(v: unknown): boolean | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === 't' || s === '1') return true;
  if (s === 'false' || s === 'f' || s === '0') return false;
  return null;
}

/**
 * Egy nyers (patients + patient_anamnesis + OHIP + completeness join) sorból
 * de-identifikált, elemzésre kész sort képez. A kimenetben SEMMILYEN közvetlen
 * azonosító nincs (a betegazonosító csak az anonim kulcs számításához kell).
 */
export function buildAnalysisRow(row: Record<string, unknown>, salt = ''): AnalysisRow {
  const patientId = String(row.id ?? row.patient_id ?? '');
  return {
    anonymized_subject_key: anonymizedSubjectKey(patientId, salt),
    age_band_start: computeAgeBand((row.szuletesi_datum as string | null) ?? null),
    region_prefix: regionPrefixFromPostal(row.iranyitoszam as string | null),
    nem: asStr(row.nem),
    etiologia: asStr(row.kezelesre_erkezes_indoka),
    maxilladefektus: asBool(row.maxilladefektus_van),
    mandibuladefektus: asBool(row.mandibuladefektus_van),
    brown_fuggoleges: asStr(row.brown_fuggoleges_osztaly),
    brown_vizszintes: asStr(row.brown_vizszintes_komponens),
    kovacs_dobak: asStr(row.kovacs_dobak_osztaly),
    tnm_staging: asStr(row.tnm_staging),
    radioterapia: asBool(row.radioterapia),
    radioterapia_dozis_gy: asNum(row.radioterapia_dozis_gy),
    chemoterapia: asBool(row.chemoterapia),
    dohanyzas_szam_ertek: asNum(row.dohanyzas_szam_ertek),
    ohip_t0_total: asNum(row.ohip_t0_total),
    ohip_t1_total: asNum(row.ohip_t1_total),
    ohip_t2_total: asNum(row.ohip_t2_total),
    ohip_t3_total: asNum(row.ohip_t3_total),
    uwqol_composite_t0: asNum(row.uwqol_composite_t0),
    uwqol_composite_t1: asNum(row.uwqol_composite_t1),
    uwqol_composite_t2: asNum(row.uwqol_composite_t2),
    uwqol_composite_t3: asNum(row.uwqol_composite_t3),
    completeness_score: asNum(row.completeness_score),
  };
}

/** Az elemzési változók kódkönyv-bejegyzésként (a generateCodebook bővítéséhez). */
export const ANALYSIS_CODEBOOK_ENTRIES: CodebookEntry[] = ANALYSIS_VARIABLES.map((v) => ({
  variable: v.key,
  label: v.label,
  type: v.type,
  allowedValues: v.allowedValues,
  source: v.source,
  notes: v.notes,
}));

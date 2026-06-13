import { getDbPool } from '@/lib/db';
import {
  REQUIRED_DOC_RULES,
  getMissingRequiredFields,
  type RequiredField,
} from '@/lib/clinical-rules';
import type { Patient } from '@/lib/types';

/**
 * Betegenkénti adat-teljességi (adathiány) riport a Vezetői nézethez.
 *
 * Két, külön kezelt mezőcsoport:
 *  - `clinical`  — NEAK/klinikai minimum protokoll (lib/clinical-rules.ts a forrás),
 *                  hogy a riport egyezzen a betegűrlap checklistájával.
 *  - `research`  — tudományos elemzéshez fontos, FELTÉTELES mezők
 *                  (csak ott hiány, ahol az adott betegre értelmezhető).
 */

export type MissingItemGroup = 'clinical' | 'research';

export type MissingItem = {
  key: string;
  label: string;
  group: MissingItemGroup;
};

export type PatientCompletenessRow = {
  patientId: string;
  patientName: string | null;
  kezeleoorvos: string | null;
  etiologia: string | null;
  clinicalMissing: MissingItem[];
  researchMissing: MissingItem[];
  clinicalComplete: boolean;
  researchComplete: boolean;
};

export type FieldGapSummary = {
  key: string;
  label: string;
  group: MissingItemGroup;
  count: number;
};

export type PatientCompletenessReport = {
  patients: PatientCompletenessRow[];
  summary: {
    total: number;
    clinicalComplete: number;
    clinicalIncomplete: number;
    researchComplete: number;
    missingOhipT0: number;
    byField: FieldGapSummary[];
  };
};

const ONKO = 'onkológiai kezelés utáni állapot';

/** Kutatási mezők feltételes szabályai (cikkhez fontos változók). */
type ResearchRule = {
  key: string;
  label: string;
  /** Értelmezhető-e az adott betegre? */
  applicable: (r: Record<string, unknown>) => boolean;
  /** Hiányzik-e az adott betegnél? (csak ha applicable) */
  missing: (r: Record<string, unknown>) => boolean;
};

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

const RESEARCH_RULES: ResearchRule[] = [
  {
    key: 'ohipT0',
    label: 'OHIP-14 kiindulási (T0) kitöltés',
    applicable: () => true,
    missing: (r) => r.has_ohip_t0 !== true,
  },
  {
    key: 'tnmStaging',
    label: 'TNM-staging',
    applicable: (r) => r.kezelesre_erkezes_indoka === ONKO,
    missing: (r) => isBlank(r.tnm_staging),
  },
  {
    key: 'brownFuggoleges',
    label: 'Brown-osztály (függőleges)',
    applicable: (r) => r.maxilladefektus_van === true,
    missing: (r) => isBlank(r.brown_fuggoleges_osztaly),
  },
  {
    key: 'brownVizszintes',
    label: 'Brown vízszintes komponens',
    applicable: (r) => r.maxilladefektus_van === true,
    missing: (r) => isBlank(r.brown_vizszintes_komponens),
  },
  {
    key: 'kovacsDobak',
    label: 'Kovács-Dobák-osztály',
    applicable: (r) => r.mandibuladefektus_van === true,
    missing: (r) => isBlank(r.kovacs_dobak_osztaly),
  },
  {
    key: 'radioterapiaDozis',
    label: 'Radioterápia dózis',
    applicable: (r) => r.radioterapia === true,
    missing: (r) => isBlank(r.radioterapia_dozis),
  },
];

export async function getPatientDataCompleteness(): Promise<PatientCompletenessReport> {
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT
        p.id,
        p.nev,
        p.nem,
        p.szuletesi_datum,
        p.taj,
        p.email,
        ku.doktor_neve AS kezeleoorvos_name,
        p.kezeleoorvos AS kezeleoorvos_text,
        a.kezelesre_erkezes_indoka,
        a.diagnozis,
        a.tnm_staging,
        a.brown_fuggoleges_osztaly,
        a.brown_vizszintes_komponens,
        a.kovacs_dobak_osztaly,
        a.maxilladefektus_van,
        a.mandibuladefektus_van,
        a.radioterapia,
        a.radioterapia_dozis,
        d.meglevo_fogak,
        COALESCE(op.op_count, 0)::int AS op_count,
        EXISTS (
          SELECT 1 FROM ohip14_responses o
          WHERE o.patient_id = p.id AND o.timepoint = 'T0'
        ) AS has_ohip_t0
     FROM patients p
     LEFT JOIN patient_anamnesis a ON a.patient_id = p.id
     LEFT JOIN patient_dental_status d ON d.patient_id = p.id
     LEFT JOIN users ku ON ku.id = p.kezeleoorvos_user_id
     LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS op_count
        FROM patient_documents pd
        WHERE pd.patient_id = p.id
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(pd.tags, '[]'::jsonb)) tg
            WHERE lower(tg) = 'op'
          )
     ) op ON true
     ORDER BY p.nev ASC NULLS LAST`,
  );

  const fieldGapMap = new Map<string, FieldGapSummary>();
  const bump = (item: MissingItem) => {
    const existing = fieldGapMap.get(item.key);
    if (existing) existing.count += 1;
    else fieldGapMap.set(item.key, { key: item.key, label: item.label, group: item.group, count: 1 });
  };

  let clinicalComplete = 0;
  let researchComplete = 0;
  let missingOhipT0 = 0;

  const patients: PatientCompletenessRow[] = result.rows.map((row) => {
    // --- Klinikai minimum (clinical-rules.ts a forrás) ---
    const patientLike = {
      nev: row.nev,
      nem: row.nem,
      szuletesiDatum: row.szuletesi_datum,
      taj: row.taj,
      email: row.email,
      kezelesreErkezesIndoka: row.kezelesre_erkezes_indoka,
      diagnozis: row.diagnozis,
      meglevoFogak: normalizeFogak(row.meglevo_fogak),
    } as unknown as Patient;

    const clinicalMissing: MissingItem[] = getMissingRequiredFields(patientLike).map(
      (f: RequiredField) => ({ key: String(f.key), label: f.label, group: 'clinical' as const }),
    );

    // Kötelező dokumentum: OP röntgen (min. 1)
    const opRule = REQUIRED_DOC_RULES.find((r) => r.tag === 'op');
    if (opRule && (row.op_count ?? 0) < opRule.minCount) {
      clinicalMissing.push({ key: 'doc:op', label: opRule.label, group: 'clinical' });
    }

    // --- Kutatási mezők (feltételes) ---
    const researchMissing: MissingItem[] = [];
    for (const rule of RESEARCH_RULES) {
      if (rule.applicable(row) && rule.missing(row)) {
        researchMissing.push({ key: rule.key, label: rule.label, group: 'research' });
      }
    }

    clinicalMissing.forEach(bump);
    researchMissing.forEach(bump);

    if (clinicalMissing.length === 0) clinicalComplete += 1;
    if (researchMissing.length === 0) researchComplete += 1;
    if (row.has_ohip_t0 !== true) missingOhipT0 += 1;

    return {
      patientId: row.id as string,
      patientName: (row.nev as string) ?? null,
      kezeleoorvos: (row.kezeleoorvos_name as string) || (row.kezeleoorvos_text as string) || null,
      etiologia: (row.kezelesre_erkezes_indoka as string) ?? null,
      clinicalMissing,
      researchMissing,
      clinicalComplete: clinicalMissing.length === 0,
      researchComplete: researchMissing.length === 0,
    };
  });

  const byField = Array.from(fieldGapMap.values()).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'hu'),
  );

  return {
    patients,
    summary: {
      total: patients.length,
      clinicalComplete,
      clinicalIncomplete: patients.length - clinicalComplete,
      researchComplete,
      missingOhipT0,
      byField,
    },
  };
}

/** JSONB-ből érkező fogazati státusz normalizálása a hiány-ellenőrzéshez. */
function normalizeFogak(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length > 0) {
    return v as Record<string, unknown>;
  }
  return undefined; // null / {} → hiányzónak számít
}

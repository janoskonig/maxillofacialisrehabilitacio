import { getDbPool } from '@/lib/db';
import {
  REQUIRED_FIELDS,
  REQUIRED_DOC_RULES,
  getMissingRequiredFields,
  type RequiredField,
} from '@/lib/clinical-rules';
import type { Patient } from '@/lib/types';

/** Mindig értelmezhető klinikai tételek száma: kötelező mezők + kötelező dokumentumok. */
const CLINICAL_APPLICABLE = REQUIRED_FIELDS.length + REQUIRED_DOC_RULES.length;

/**
 * Adat-teljességi pontszám (0–100) az értelmezhető (applicable) tételek arányából.
 * A nevező az adott betegre értelmezhető klinikai + kutatási mezők száma, a számláló
 * a meglévők száma. Ha semmi nem értelmezhető (elvi eset), 100-at adunk vissza.
 */
export function computeCompletenessScore(input: {
  clinicalApplicable: number;
  clinicalMissing: number;
  researchApplicable: number;
  researchMissing: number;
}): number {
  const applicable = input.clinicalApplicable + input.researchApplicable;
  if (applicable <= 0) return 100;
  const present = applicable - (input.clinicalMissing + input.researchMissing);
  const pct = (present / applicable) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

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
  /** Explicit N/A-ként ("nem értelmezhető / nem ismert") megjelölt mezők. */
  naMarked: MissingItem[];
  /** Az adott betegre értelmezhető (klinikai + kutatási) tételek száma. */
  applicableCount: number;
  /** Adat-teljességi pontszám 0–100 (a meglévő / értelmezhető tételek aránya). */
  completenessScore: number;
  /** Elemzésre kész: nincs sem klinikai, sem kutatási hiány. */
  researchReady: boolean;
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
    /** Elemzésre kész betegek száma (sem klinikai, sem kutatási hiány). */
    researchReady: number;
    /** Az összes beteg átlagos adat-teljességi pontszáma (0–100). */
    avgCompletenessScore: number;
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

/**
 * N/A-ként megjelölhető mező-kulcsok (a feltételes kutatási mezők). A klinikai
 * minimum mezői (név, TAJ, email…) nem jelölhetők N/A-nak.
 */
export const NA_ELIGIBLE_KEYS: ReadonlySet<string> = new Set(
  RESEARCH_RULES.map((r) => r.key),
);

/** Egy N/A-jelölhető kulcs ember által olvasható címkéje (UI / API visszajelzéshez). */
export function naFieldLabel(key: string): string | null {
  return RESEARCH_RULES.find((r) => r.key === key)?.label ?? null;
}

export async function getPatientDataCompleteness(
  options?: { patientId?: string },
): Promise<PatientCompletenessReport> {
  const pool = getDbPool();

  const params: unknown[] = [];
  let whereClause = '';
  if (options?.patientId) {
    params.push(options.patientId);
    whereClause = `WHERE p.id = $1`;
  }

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
        ) AS has_ohip_t0,
        COALESCE(na.keys, ARRAY[]::text[]) AS na_keys
     FROM patients p
     LEFT JOIN patient_anamnesis a ON a.patient_id = p.id
     LEFT JOIN patient_dental_status d ON d.patient_id = p.id
     LEFT JOIN users ku ON ku.id = p.kezeleoorvos_user_id
     LEFT JOIN LATERAL (
        SELECT array_agg(field_key) AS keys
        FROM patient_field_na
        WHERE patient_id = p.id
     ) na ON true
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
     ${whereClause}
     ORDER BY p.nev ASC NULLS LAST`,
    params,
  );

  const fieldGapMap = new Map<string, FieldGapSummary>();
  const bump = (item: MissingItem) => {
    const existing = fieldGapMap.get(item.key);
    if (existing) existing.count += 1;
    else fieldGapMap.set(item.key, { key: item.key, label: item.label, group: item.group, count: 1 });
  };

  let clinicalComplete = 0;
  let researchComplete = 0;
  let researchReadyCount = 0;
  let scoreSum = 0;
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
    // Egy mező "rendezett", ha ki van töltve VAGY explicit N/A-ként megjelölt.
    const naKeys = new Set<string>((row.na_keys as string[] | null) ?? []);
    const researchMissing: MissingItem[] = [];
    const naMarked: MissingItem[] = [];
    let researchApplicable = 0;
    for (const rule of RESEARCH_RULES) {
      if (!rule.applicable(row)) continue;
      researchApplicable += 1;
      if (naKeys.has(rule.key)) {
        naMarked.push({ key: rule.key, label: rule.label, group: 'research' });
        continue; // N/A → rendezett, nem hiány
      }
      if (rule.missing(row)) {
        researchMissing.push({ key: rule.key, label: rule.label, group: 'research' });
      }
    }

    clinicalMissing.forEach(bump);
    researchMissing.forEach(bump);

    const isClinicalComplete = clinicalMissing.length === 0;
    const isResearchComplete = researchMissing.length === 0;
    const isResearchReady = isClinicalComplete && isResearchComplete;
    const applicableCount = CLINICAL_APPLICABLE + researchApplicable;
    const completenessScore = computeCompletenessScore({
      clinicalApplicable: CLINICAL_APPLICABLE,
      clinicalMissing: clinicalMissing.length,
      researchApplicable,
      researchMissing: researchMissing.length,
    });

    if (isClinicalComplete) clinicalComplete += 1;
    if (isResearchComplete) researchComplete += 1;
    if (isResearchReady) researchReadyCount += 1;
    scoreSum += completenessScore;
    if (row.has_ohip_t0 !== true) missingOhipT0 += 1;

    return {
      patientId: row.id as string,
      patientName: (row.nev as string) ?? null,
      kezeleoorvos: (row.kezeleoorvos_name as string) || (row.kezeleoorvos_text as string) || null,
      etiologia: (row.kezelesre_erkezes_indoka as string) ?? null,
      clinicalMissing,
      researchMissing,
      clinicalComplete: isClinicalComplete,
      researchComplete: isResearchComplete,
      naMarked,
      applicableCount,
      completenessScore,
      researchReady: isResearchReady,
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
      researchReady: researchReadyCount,
      avgCompletenessScore: patients.length > 0 ? Math.round(scoreSum / patients.length) : 100,
      missingOhipT0,
      byField,
    },
  };
}

/**
 * Egyetlen beteg adat-teljességi sora (a teljes riporttal azonos logikából).
 * Mentés utáni tanácsadó visszajelzéshez — nem blokkol, csak jelez.
 */
export async function getPatientCompletenessRow(
  patientId: string,
): Promise<PatientCompletenessRow | null> {
  const report = await getPatientDataCompleteness({ patientId });
  return report.patients[0] ?? null;
}

/** JSONB-ből érkező fogazati státusz normalizálása a hiány-ellenőrzéshez. */
function normalizeFogak(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length > 0) {
    return v as Record<string, unknown>;
  }
  return undefined; // null / {} → hiányzónak számít
}

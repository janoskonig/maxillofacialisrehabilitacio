/**
 * Effective treatment type: episode > pathway > patient (derived from kezelesiTerv).
 * Single source of truth for care-plan-steps and wip-next-appointments.
 */

import type { Pool } from 'pg';
import { extractSuggestedTreatmentTypeCodes } from './treatment-type-normalize';

export type TreatmentTypeSource = 'episode' | 'pathway' | 'patient' | null;

export interface EffectiveTreatmentTypeResult {
  id: string | null;
  code: string | null;
  label: string | null;
  source: TreatmentTypeSource;
}

type KezelesiTervItem = { tipus?: string; treatmentTypeCode?: string };

/**
 * Resolve effective treatment type by precedence: episode > pathway > patient.
 * @param pool - DB pool for treatment_types lookup
 * @param params - episode/pathway IDs and patient kezelesiTerv for fallback
 */
export async function getEffectiveTreatmentType(
  pool: Pool,
  params: {
    episodeTreatmentTypeId: string | null | undefined;
    pathwayTreatmentTypeId: string | null | undefined;
    kezelesiTervFelso?: KezelesiTervItem[] | null;
    kezelesiTervAlso?: KezelesiTervItem[] | null;
  }
): Promise<EffectiveTreatmentTypeResult> {
  const empty: EffectiveTreatmentTypeResult = {
    id: null,
    code: null,
    label: null,
    source: null,
  };

  const lookupById = async (id: string): Promise<{ id: string; code: string; label_hu: string } | null> => {
    const r = await pool.query(
      'SELECT id, code, label_hu FROM treatment_types WHERE id = $1',
      [id]
    );
    return r.rows[0] ?? null;
  };

  const lookupByCode = async (code: string): Promise<{ id: string; code: string; label_hu: string } | null> => {
    const r = await pool.query(
      'SELECT id, code, label_hu FROM treatment_types WHERE code = $1',
      [code]
    );
    return r.rows[0] ?? null;
  };

  // 1. Episode
  if (params.episodeTreatmentTypeId) {
    const row = await lookupById(params.episodeTreatmentTypeId);
    if (row) {
      return {
        id: row.id,
        code: row.code,
        label: row.label_hu,
        source: 'episode',
      };
    }
  }

  // 2. Pathway
  if (params.pathwayTreatmentTypeId) {
    const row = await lookupById(params.pathwayTreatmentTypeId);
    if (row) {
      return {
        id: row.id,
        code: row.code,
        label: row.label_hu,
        source: 'pathway',
      };
    }
  }

  // 3. Patient derived (kezelesiTerv felso + also)
  const codes = extractSuggestedTreatmentTypeCodes(
    params.kezelesiTervFelso,
    params.kezelesiTervAlso
  );
  if (codes.length > 0) {
    const row = await lookupByCode(codes[0]);
    if (row) {
      return {
        id: row.id,
        code: row.code,
        label: row.label_hu,
        source: 'patient',
      };
    }
  }

  return empty;
}

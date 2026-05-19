/**
 * CRF skeleton registry — form/field version metadata.
 */

import type { Pool } from 'pg';
import { getDbPool } from '@/lib/db';

export interface CrfFieldRequirement {
  fieldCode: string;
  requiredForQuality: boolean;
  requiredForUi: boolean;
  requiredForExport: boolean;
}

export async function getActiveCrfFields(
  formCode: string,
  pool?: Pool
): Promise<CrfFieldRequirement[]> {
  const db = pool ?? getDbPool();
  const r = await db.query(
    `SELECT fv.field_code, fv.required_for_quality, fv.required_for_ui, fv.required_for_export
     FROM crf_field_versions fv
     JOIN crf_form_versions f ON f.id = fv.form_version_id
     WHERE f.form_code = $1 AND f.lifecycle = 'active' AND fv.deprecated = false`,
    [formCode]
  );
  return r.rows.map((row) => ({
    fieldCode: row.field_code,
    requiredForQuality: row.required_for_quality === true,
    requiredForUi: row.required_for_ui === true,
    requiredForExport: row.required_for_export === true,
  }));
}

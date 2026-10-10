import type { Pool } from 'pg';
import type { NeakTreatmentSources } from '@/lib/neak-treatment-content';

export async function loadNeakTreatmentSources(pool: Pick<Pool, 'query'>, patientId: string): Promise<NeakTreatmentSources> {
  const types = await pool.query('SELECT code, label_hu AS label FROM treatment_types');
  const sources: NeakTreatmentSources = {
    labels: new Map(types.rows.map((r: { code: string; label: string }) => [r.code, r.label])),
    toothTreatments: [], episodes: [], warnings: [],
  };
  const schema = await pool.query(`SELECT
    to_regclass('public.tooth_treatments') IS NOT NULL AS "hasToothTreatments",
    to_regclass('public.tooth_treatment_catalog') IS NOT NULL AS "hasToothCatalog",
    to_regclass('public.patient_episodes') IS NOT NULL AS "hasEpisodes",
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'patient_episodes' AND column_name = 'treatment_plan') AS "hasEpisodeTreatmentPlan"`);
  const availability = schema.rows[0];
  if (availability?.hasToothTreatments && availability?.hasToothCatalog) {
    const result = await pool.query(
      `SELECT tt.id, tt.tooth_number AS "toothNumber", tt.treatment_code AS "treatmentCode",
              tc.label_hu AS "labelHu", tt.status, tt.notes, tt.completed_at AS "completedAt"
       FROM tooth_treatments tt
       LEFT JOIN tooth_treatment_catalog tc ON tc.code = tt.treatment_code
       WHERE tt.patient_id = $1
       ORDER BY tt.tooth_number, tt.created_at, tt.id`, [patientId]
    );
    sources.toothTreatments = result.rows;
  } else {
    sources.warnings.push('A fogankénti kezelési igények adatforrása nem érhető el ezen a rendszeren.');
  }
  if (availability?.hasEpisodes) {
    const result = await pool.query(
      `SELECT pe.id, pe.case_title AS "caseTitle", pe.chief_complaint AS "chiefComplaint", pe.status,
              ${availability.hasEpisodeTreatmentPlan ? 'pe.treatment_plan' : 'NULL::text'} AS "treatmentPlan",
              tt.label_hu AS "treatmentTypeLabel"
       FROM patient_episodes pe
       LEFT JOIN treatment_types tt ON tt.id = pe.treatment_type_id
       WHERE pe.patient_id = $1 AND pe.status IN ('open', 'paused')
       ORDER BY pe.opened_at DESC, pe.id`, [patientId]
    );
    sources.episodes = result.rows;
    if (!availability.hasEpisodeTreatmentPlan) {
      sources.warnings.push('Az epizódonkénti kezelési terv mezőjéhez az adatbázis frissítése szükséges.');
    }
  } else {
    sources.warnings.push('Az ellátási epizódok adatforrása nem érhető el ezen a rendszeren.');
  }
  return sources;
}

/**
 * Read-model vs write-model boundary enforcement.
 */

import { assertAuthoritativeWrite } from './source-of-truth-registry';

export const CLINICAL_WRITE_ENTITIES = [
  'patient',
  'patient_episodes',
  'appointments',
  'ohip14_responses',
  'patient_documents',
] as const;

export const RESEARCH_READ_MODELS = [
  'entity_quality_state',
  'research_patient_view',
  'analysis_exports',
] as const;

export type ClinicalWriteEntity = (typeof CLINICAL_WRITE_ENTITIES)[number];
export type ResearchReadModel = (typeof RESEARCH_READ_MODELS)[number];

/** Guard clinical API writes — blocks direct writes to read models. */
export function guardClinicalWrite(entityName: string, fieldPath = '*'): void {
  if ((RESEARCH_READ_MODELS as readonly string[]).includes(entityName)) {
    throw new Error(
      `Clinical write API cannot mutate read model "${entityName}". Use rebuild/enqueue pipeline.`
    );
  }
  assertAuthoritativeWrite(entityName, fieldPath);
}

/** Document that research exports must use read models only. */
export const READ_WRITE_POLICY = {
  clinicalWrite: CLINICAL_WRITE_ENTITIES,
  researchRead: RESEARCH_READ_MODELS,
  syncPolicy: 'eventual_consistency' as const,
} as const;

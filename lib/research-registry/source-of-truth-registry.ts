/**
 * Source-of-truth registry for registry compliance.
 * Canonical definitions in code; mirrored in domain_source_registry (migration 033).
 */

export type AuthoritativeSource =
  | 'clinical_write'
  | 'derived'
  | 'quality_engine'
  | 'frozen_artifact'
  | 'snapshot'
  | 'audit_bus';

export interface SourceOfTruthEntry {
  entityName: string;
  fieldPath: string;
  authoritativeSource: AuthoritativeSource;
  recomputable: boolean;
  isCache: boolean;
  immutable: boolean;
  notes?: string;
}

export const SOURCE_OF_TRUTH_REGISTRY: readonly SourceOfTruthEntry[] = [
  {
    entityName: 'patient',
    fieldPath: '*',
    authoritativeSource: 'clinical_write',
    recomputable: false,
    isCache: false,
    immutable: false,
  },
  {
    entityName: 'ohip14_responses',
    fieldPath: 'answers',
    authoritativeSource: 'clinical_write',
    recomputable: false,
    isCache: false,
    immutable: false,
  },
  {
    entityName: 'ohip14_responses',
    fieldPath: 'summary',
    authoritativeSource: 'derived',
    recomputable: true,
    isCache: false,
    immutable: false,
  },
  {
    entityName: 'entity_quality_state',
    fieldPath: '*',
    authoritativeSource: 'quality_engine',
    recomputable: true,
    isCache: true,
    immutable: false,
  },
  {
    entityName: 'episode_forecast_cache',
    fieldPath: '*',
    authoritativeSource: 'derived',
    recomputable: true,
    isCache: true,
    immutable: false,
  },
  {
    entityName: 'analysis_exports',
    fieldPath: '*',
    authoritativeSource: 'frozen_artifact',
    recomputable: false,
    isCache: false,
    immutable: true,
  },
  {
    entityName: 'patient_snapshots',
    fieldPath: '*',
    authoritativeSource: 'snapshot',
    recomputable: false,
    isCache: false,
    immutable: true,
  },
  {
    entityName: 'audit_events',
    fieldPath: '*',
    authoritativeSource: 'audit_bus',
    recomputable: false,
    isCache: false,
    immutable: true,
  },
] as const;

export function getSourceOfTruth(
  entityName: string,
  fieldPath = '*'
): SourceOfTruthEntry | undefined {
  const exact = SOURCE_OF_TRUTH_REGISTRY.find(
    (e) => e.entityName === entityName && e.fieldPath === fieldPath
  );
  if (exact) return exact;
  return SOURCE_OF_TRUTH_REGISTRY.find(
    (e) => e.entityName === entityName && e.fieldPath === '*'
  );
}

/** Throws if a write targets a non-authoritative (read-model) entity. */
export function assertAuthoritativeWrite(entityName: string, fieldPath = '*'): void {
  const entry = getSourceOfTruth(entityName, fieldPath);
  if (!entry) return;
  if (entry.authoritativeSource === 'quality_engine' || entry.immutable) {
    const allowed =
      entry.authoritativeSource === 'quality_engine' && entry.recomputable;
    if (!allowed) {
      throw new Error(
        `Direct write blocked for ${entityName}.${fieldPath}: authoritative_source=${entry.authoritativeSource}`
      );
    }
  }
}

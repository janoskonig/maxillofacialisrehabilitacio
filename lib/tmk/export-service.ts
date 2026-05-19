/**
 * Research export service — frozen analysis_exports artifacts.
 */

import type { Pool } from 'pg';
import { getDbPool } from '@/lib/db';
import { getComplianceFeatureFlag } from './feature-flags';
import {
  buildChecksumHierarchy,
  computeExportContentHash,
  computeManifestHash,
} from './export-determinism';
import { assertExportPhiSafe } from './phi-safety';
import { assertExportSchemaCompatible } from './schema-evolution';

export const CURRENT_EXPORT_SCHEMA_VERSION = '1.0';

export interface CreateExportInput {
  exportLabel: string;
  schemaVersion: string;
  queryDefinition: Record<string, unknown>;
  filterPolicy?: Record<string, unknown>;
  rows: Record<string, unknown>[];
  keyColumns: string[];
  createdBy?: string;
  patientIds?: string[];
}

export async function createAnalysisExport(
  input: CreateExportInput,
  pool?: Pool
): Promise<{ id: string; contentHash: string } | null> {
  if (!(await getComplianceFeatureFlag('research_export_pipeline'))) {
    return null;
  }

  assertExportSchemaCompatible(input.schemaVersion, CURRENT_EXPORT_SCHEMA_VERSION);
  assertExportPhiSafe(input.rows);

  const db = pool ?? getDbPool();
  const contentHash = computeExportContentHash(input.rows, input.keyColumns);
  const manifestHash = computeManifestHash({
    exportLabel: input.exportLabel,
    schemaVersion: input.schemaVersion,
    queryDefinition: input.queryDefinition,
    contentHash,
  });
  const checksumHierarchy = buildChecksumHierarchy(contentHash);

  const r = await db.query(
    `INSERT INTO analysis_exports (
       export_label, schema_version, query_definition, filter_policy,
       row_count, content_hash, manifest_hash, checksum_hierarchy, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      input.exportLabel,
      input.schemaVersion,
      JSON.stringify(input.queryDefinition),
      JSON.stringify(input.filterPolicy ?? {}),
      input.rows.length,
      contentHash,
      manifestHash,
      JSON.stringify(checksumHierarchy),
      input.createdBy ?? null,
    ]
  );

  const exportId = r.rows[0].id as string;

  if (input.patientIds?.length) {
    for (const patientId of input.patientIds) {
      const anonKey = computeExportContentHash([{ patientId }], ['patientId']).slice(0, 16);
      await db.query(
        `INSERT INTO analysis_export_subjects (export_id, patient_id, anonymized_subject_key)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [exportId, patientId, anonKey]
      );
      await db.query(
        `INSERT INTO consent_export_manifest (patient_id, export_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [patientId, exportId]
      );
    }
  }

  await db.query(
    `INSERT INTO dataset_derivation_runs (export_id, algorithm_id, output_hash, lineage_tier, completed_at)
     SELECT $1, ar.id, $2, 'hot', CURRENT_TIMESTAMP
     FROM algorithm_registry ar
     WHERE ar.algorithm_code = 'export_deterministic_hash'
     LIMIT 1`,
    [exportId, contentHash]
  );

  return { id: exportId, contentHash };
}

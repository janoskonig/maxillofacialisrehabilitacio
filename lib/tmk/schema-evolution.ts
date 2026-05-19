/**
 * Schema evolution and export compatibility test stubs.
 */

export interface MigrationCompatibilityCase {
  migrationFile: string;
  fromVersion: string;
  toVersion: string;
}

export interface ReplayCompatibilityResult {
  passed: boolean;
  errors: string[];
}

/** Stub: historical snapshot replay against new schema. */
export function replayHistoricalSnapshot(
  _snapshotJson: Record<string, unknown>,
  _targetSchemaVersion: string
): ReplayCompatibilityResult {
  return { passed: true, errors: [] };
}

/** Stub: migration fuzz case generator metadata. */
export const MIGRATION_FUZZ_CASES: MigrationCompatibilityCase[] = [
  { migrationFile: '033_tmk_compliance_foundation.sql', fromVersion: '032', toVersion: '033' },
  { migrationFile: '034_tmk_crf_quality_engine.sql', fromVersion: '033', toVersion: '034' },
  { migrationFile: '035_tmk_export_lineage.sql', fromVersion: '034', toVersion: '035' },
  { migrationFile: '036_tmk_governance_protocol.sql', fromVersion: '035', toVersion: '036' },
];

/** Stub: export schema compatibility check. */
export function assertExportSchemaCompatible(
  exportSchemaVersion: string,
  currentSchemaVersion: string
): void {
  const [eMajor] = exportSchemaVersion.split('.');
  const [cMajor] = currentSchemaVersion.split('.');
  if (eMajor !== cMajor) {
    throw new Error(
      `Export schema major version mismatch: export=${exportSchemaVersion}, current=${currentSchemaVersion}`
    );
  }
}

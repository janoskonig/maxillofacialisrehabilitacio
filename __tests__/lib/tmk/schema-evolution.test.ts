import { describe, it, expect } from 'vitest';
import {
  assertExportSchemaCompatible,
  MIGRATION_FUZZ_CASES,
  replayHistoricalSnapshot,
} from '@/lib/tmk/schema-evolution';
import { CURRENT_EXPORT_SCHEMA_VERSION } from '@/lib/tmk/export-service';

describe('schema-evolution', () => {
  it('allows same major export schema version', () => {
    expect(() =>
      assertExportSchemaCompatible('1.2', CURRENT_EXPORT_SCHEMA_VERSION)
    ).not.toThrow();
  });

  it('rejects major version mismatch', () => {
    expect(() => assertExportSchemaCompatible('2.0', '1.0')).toThrow(/major version/);
  });

  it('replays historical snapshot stub as passed', () => {
    const result = replayHistoricalSnapshot({ patientId: 'x' }, '1.0');
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('lists TMK migration compatibility cases', () => {
    expect(MIGRATION_FUZZ_CASES.length).toBeGreaterThanOrEqual(4);
    expect(MIGRATION_FUZZ_CASES[0].migrationFile).toMatch(/033_/);
  });
});

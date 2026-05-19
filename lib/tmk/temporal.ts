/**
 * Canonical temporal field vocabulary for TMK-critical entities.
 */

export interface TemporalFields {
  recordedAt?: Date | string | null;
  effectiveAt?: Date | string | null;
  approvedAt?: Date | string | null;
  exportedAt?: Date | string | null;
}

export type TemporalFieldKey = keyof TemporalFields;

export const TEMPORAL_FIELD_LABELS: Record<TemporalFieldKey, string> = {
  recordedAt: 'recorded_at — when the system captured the event',
  effectiveAt: 'effective_at — when the clinical fact became true',
  approvedAt: 'approved_at — when approval/lock occurred',
  exportedAt: 'exported_at — when included in a frozen research export',
};

/** Default timestamps for a new clinical write. */
export function defaultTemporalOnWrite(now = new Date()): Pick<TemporalFields, 'recordedAt' | 'effectiveAt'> {
  return { recordedAt: now, effectiveAt: now };
}

/** SQL SET clause fragments for temporal columns on update. */
export function temporalUpdateSql(
  tableAlias: string,
  opts: { setApproved?: boolean; setExported?: boolean }
): string {
  const parts: string[] = [
    `${tableAlias}.recorded_at = COALESCE(${tableAlias}.recorded_at, CURRENT_TIMESTAMP)`,
    `${tableAlias}.effective_at = CURRENT_TIMESTAMP`,
  ];
  if (opts.setApproved) {
    parts.push(`${tableAlias}.approved_at = CURRENT_TIMESTAMP`);
  }
  if (opts.setExported) {
    parts.push(`${tableAlias}.exported_at = CURRENT_TIMESTAMP`);
  }
  return parts.join(', ');
}

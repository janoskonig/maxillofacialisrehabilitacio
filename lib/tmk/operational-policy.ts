/**
 * TMK operational decisions (product / legal / compliance).
 * Update when stakeholders change policy — see docs/tmk-operational-decisions.md
 */

export type FrozenExportPolicy = 'exclude_future_only' | 'tombstone_artifact' | 'hard_delete';
export type SoftDeletePolicy = 'tombstone_only' | 'phi_hard_delete';
export type ResearchExportMode = 'disabled' | 'consent_required';

/** Consent withdrawal: frozen artifacts stay; subject excluded from future exports only. */
export const CONSENT_WITHDRAWAL_POLICY = {
  frozenExportPolicy: 'exclude_future_only' as FrozenExportPolicy,
} as const;

/** Research reproducibility: logical delete / tombstone; no hard delete by default. */
export const SOFT_DELETE_POLICY: SoftDeletePolicy = 'tombstone_only';

/**
 * Research cohort export gate.
 * - `disabled`: no patient cohort exports (current decision: not exporting yet).
 * - `consent_required`: only `consent_status = granted` and verified compliance status.
 */
export const RESEARCH_EXPORT_MODE: ResearchExportMode = 'disabled';

/** Production flag rollout order (enable one at a time after backfill). */
export const PRODUCTION_FLAG_ROLLOUT_ORDER = [
  'unified_audit_events',
  'entity_revision_locking',
  'quality_recompute_queue',
  'research_export_pipeline',
  'tighten_snapshot_changes_access',
] as const;

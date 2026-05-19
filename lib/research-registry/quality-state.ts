/**
 * Quality state machine for registry compliance.
 */

export const QUALITY_STATES = [
  'DRAFT',
  'LOCAL_REVIEW',
  'CENTER_APPROVED',
  'REGISTRY_APPROVED',
  'LOCKED_FOR_ANALYSIS',
  'LEGACY_UNVERIFIED',
  'IMPORTED_LEGACY',
] as const;

export type QualityState = (typeof QUALITY_STATES)[number];

export const LEGACY_TRANSITIONAL_STATES: QualityState[] = [
  'LEGACY_UNVERIFIED',
  'IMPORTED_LEGACY',
];

const VALID_TRANSITIONS: Record<QualityState, QualityState[]> = {
  DRAFT: ['LOCAL_REVIEW', 'LEGACY_UNVERIFIED'],
  LOCAL_REVIEW: ['CENTER_APPROVED', 'DRAFT'],
  CENTER_APPROVED: ['REGISTRY_APPROVED', 'LOCAL_REVIEW'],
  REGISTRY_APPROVED: ['LOCKED_FOR_ANALYSIS', 'CENTER_APPROVED'],
  LOCKED_FOR_ANALYSIS: [],
  LEGACY_UNVERIFIED: ['LOCAL_REVIEW', 'IMPORTED_LEGACY'],
  IMPORTED_LEGACY: ['LOCAL_REVIEW', 'LEGACY_UNVERIFIED'],
};

export function canTransitionQuality(from: QualityState, to: QualityState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertQualityTransition(from: QualityState, to: QualityState): void {
  if (!canTransitionQuality(from, to)) {
    throw new Error(`Invalid quality transition: ${from} -> ${to}`);
  }
}

/** States that block research export without override. */
export function isExportEligible(state: QualityState): boolean {
  return state === 'REGISTRY_APPROVED' || state === 'LOCKED_FOR_ANALYSIS';
}

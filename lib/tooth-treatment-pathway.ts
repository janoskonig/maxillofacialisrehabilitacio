import type { ToothTreatment } from '@/lib/types';

/**
 * Whether this tooth treatment no longer needs scheduling / Zsigmondy "open" badge.
 * Canonical: completed in DB, or linked episode work phase (merge-aware primary) is completed/skipped.
 */
export function isToothTreatmentPathwayDone(
  t: Pick<ToothTreatment, 'status'> & { pathwayClosed?: boolean | null },
): boolean {
  if (t.status === 'completed') return true;
  return t.pathwayClosed === true;
}

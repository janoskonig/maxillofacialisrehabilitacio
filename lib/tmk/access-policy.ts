/**
 * Tightened access policy for changes/snapshots endpoints.
 */

import type { AuthPayload } from '@/lib/auth-server';
import { getComplianceFeatureFlag } from './feature-flags';

const CLINICAL_ROLES: AuthPayload['role'][] = [
  'admin',
  'beutalo_orvos',
  'fogpótlástanász',
];

export async function canAccessPatientAuditTrail(auth: AuthPayload): Promise<boolean> {
  if (!(await getComplianceFeatureFlag('tighten_snapshot_changes_access'))) {
    return true;
  }
  return CLINICAL_ROLES.includes(auth.role);
}

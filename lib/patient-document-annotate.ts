import type { AuthUser } from '@/lib/auth';

/** Megegyezik a `/api/patients/.../annotations` POST szerepkörökkel. */
export const PATIENT_DOCUMENT_ANNOTATE_ROLES = ['admin', 'fogpótlástanász', 'beutalo_orvos'] as const;

export function userCanAnnotatePatientDocuments(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  return (PATIENT_DOCUMENT_ANNOTATE_ROLES as readonly string[]).includes(user.role);
}

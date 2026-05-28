import { verifyAuth } from '@/lib/auth-server';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import type { NextRequest } from 'next/server';
import type { ContextLinkViewer } from './context-links';

export async function resolveContextLinkViewer(
  req: NextRequest,
): Promise<ContextLinkViewer | null> {
  const auth = await verifyAuth(req);
  if (auth) {
    return {
      kind: 'staff',
      userId: auth.userId,
      role: auth.role,
      email: auth.email,
    };
  }

  const patientId = await verifyPatientPortalSession(req);
  if (patientId) {
    return { kind: 'patient_portal', patientId };
  }

  return null;
}

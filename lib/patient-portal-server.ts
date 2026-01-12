import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';
import { NextRequest } from 'next/server';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

interface PortalSession {
  patientId: string;
  type: 'patient_portal';
  impersonatedBy?: string; // Opcionális: ki impersonálta (ha van)
}

export interface PatientPortalSessionInfo {
  patientId: string;
  impersonatedBy?: string;
}

/**
 * Verify patient portal session from cookie
 * Returns patient ID if valid, null otherwise
 */
export async function verifyPatientPortalSession(
  request: NextRequest
): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('patient_portal_session');

    if (!sessionCookie?.value) {
      return null;
    }

    const { payload } = await jwtVerify<PortalSession>(
      sessionCookie.value,
      JWT_SECRET
    );

    if (payload.type !== 'patient_portal' || !payload.patientId) {
      return null;
    }

    return payload.patientId;
  } catch (error) {
    console.error('Error verifying portal session:', error);
    return null;
  }
}

/**
 * Get full patient portal session info including impersonatedBy
 * Returns session info if valid, null otherwise
 */
export async function getPatientPortalSessionInfo(
  request: NextRequest
): Promise<PatientPortalSessionInfo | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('patient_portal_session');

    if (!sessionCookie?.value) {
      return null;
    }

    const { payload } = await jwtVerify<PortalSession>(
      sessionCookie.value,
      JWT_SECRET
    );

    if (payload.type !== 'patient_portal' || !payload.patientId) {
      return null;
    }

    return {
      patientId: payload.patientId,
      impersonatedBy: payload.impersonatedBy,
    };
  } catch (error) {
    console.error('Error getting portal session info:', error);
    return null;
  }
}

/**
 * Clear patient portal session
 */
export async function clearPatientPortalSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete('patient_portal_session');
}









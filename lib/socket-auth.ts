import { jwtVerify } from 'jose';
import { getDbPool } from './db';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

export interface SocketAuthPayload {
  userId: string;
  email: string;
  role?: 'admin' | 'editor' | 'viewer' | 'fogpótlástanász' | 'technikus' | 'sebészorvos';
  userType: 'doctor' | 'patient';
  patientId?: string; // Ha beteg, akkor a beteg ID-ja
}

/**
 * Socket.io handshake authentication
 * Verifies JWT token from cookies or handshake auth
 */
export async function verifySocketAuth(
  cookies: Record<string, string>
): Promise<SocketAuthPayload | null> {
  try {
    // Próbáljuk meg az orvos token-t
    const authToken = cookies['auth-token'];
    if (authToken) {
      try {
        const { payload } = await jwtVerify(authToken, JWT_SECRET);
        const userId = payload.userId as string;
        const email = payload.email as string;
        const role = payload.role as 'admin' | 'editor' | 'viewer' | 'fogpótlástanász' | 'technikus' | 'sebészorvos';

        // Ellenőrizzük, hogy a felhasználó aktív-e
        const pool = getDbPool();
        const userResult = await pool.query(
          'SELECT active FROM users WHERE id = $1',
          [userId]
        );

        if (userResult.rows.length === 0 || !userResult.rows[0].active) {
          return null;
        }

        return {
          userId,
          email,
          role,
          userType: 'doctor',
        };
      } catch {
        // Ha az orvos token nem érvényes, próbáljuk a beteg session-t
      }
    }

    // Próbáljuk meg a beteg portal session-t
    const patientSession = cookies['patient_portal_session'];
    if (patientSession) {
      try {
        const { payload } = await jwtVerify(patientSession, JWT_SECRET);
        
        if (payload.type === 'patient_portal' && payload.patientId) {
          return {
            userId: payload.patientId as string,
            email: '',
            userType: 'patient',
            patientId: payload.patientId as string,
          };
        }
      } catch {
        return null;
      }
    }

    return null;
  } catch (error) {
    console.error('Socket auth error:', error);
    return null;
  }
}

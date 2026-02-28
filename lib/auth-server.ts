import { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

export type AuthPayload = {
  userId: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer' | 'fogpótlástanász' | 'technikus' | 'sebészorvos';
  restrictedView?: boolean;
};

/**
 * Thrown by requireAuth / requireRole; handled automatically by handleApiError.
 */
export class HttpError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/**
 * JWT token ellenőrzése és payload visszaadása
 * @returns AuthPayload vagy null, ha nincs érvényes token
 */
export async function verifyAuth(request: NextRequest): Promise<AuthPayload | null> {
  const token = request.cookies.get('auth-token')?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      role: payload.role as 'admin' | 'editor' | 'viewer' | 'fogpótlástanász' | 'technikus' | 'sebészorvos',
      restrictedView: payload.restrictedView as boolean | undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Like verifyAuth, but throws HttpError(401) when there is no valid session.
 * Use inside route handlers wrapped with withCorrelation / try-catch + handleApiError.
 */
export async function requireAuth(request: NextRequest): Promise<AuthPayload> {
  const auth = await verifyAuth(request);
  if (!auth) throw new HttpError(401, 'Bejelentkezés szükséges', 'UNAUTHENTICATED');
  return auth;
}

/**
 * Like requireAuth, but also asserts the user has one of the given roles.
 * Throws HttpError(403) when the role check fails.
 */
export async function requireRole(
  request: NextRequest,
  allowedRoles: AuthPayload['role'][],
): Promise<AuthPayload> {
  const auth = await requireAuth(request);
  if (!allowedRoles.includes(auth.role)) {
    throw new HttpError(403, 'Nincs jogosultság', 'FORBIDDEN');
  }
  return auth;
}

/**
 * Ellenőrzi, hogy a felhasználó aktív-e az adatbázisban
 */
export async function verifyUserActive(pool: any, userId: string): Promise<boolean> {
  try {
    const result = await pool.query('SELECT active FROM users WHERE id = $1', [userId]);
    return result.rows.length > 0 && result.rows[0].active === true;
  } catch {
    return false;
  }
}


import { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

export type AuthPayload = {
  userId: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
};

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
      role: payload.role as 'admin' | 'editor' | 'viewer',
    };
  } catch {
    return null;
  }
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


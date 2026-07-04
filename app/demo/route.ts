import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { getDbPool } from '@/lib/db';

/**
 * Egykattintásos DEMÓ auto-login.
 *
 * BIZTONSÁG: kizárólag akkor csinál bármit, ha a DEMO_MODE env === 'true'.
 * Éles telepítésen (ahol DEMO_MODE nincs beállítva) a route inert: a /login-ra
 * irányít, jelszó nélküli bejelentkezést SOHA nem enged. A demó-instance saját,
 * szintetikus adatbázissal fut — így valós beteg-adathoz ez az útvonal nem fér.
 *
 * A demó-instance-on a route a DEMO_USER_EMAIL (alap: demo@demo.local) fiókra
 * állít ki egy JWT-t, beállítja az auth-token cookie-t, és a főoldalra visz.
 */
export const dynamic = 'force-dynamic';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production',
);
const JWT_EXPIRES_IN_S = 7 * 24 * 60 * 60;

export async function GET(req: NextRequest) {
  const loginUrl = new URL('/login', req.url);

  // Kapu: éles instance-on nincs demó-auto-login.
  if (process.env.DEMO_MODE !== 'true') {
    return NextResponse.redirect(loginUrl);
  }

  const demoEmail = (process.env.DEMO_USER_EMAIL || 'demo@demo.local').toLowerCase();

  let user: { id: string; email: string; role: string; restricted_view: boolean } | null = null;
  try {
    const r = await getDbPool().query(
      'SELECT id, email, role, COALESCE(restricted_view, false) AS restricted_view FROM users WHERE email = $1 AND active = true',
      [demoEmail],
    );
    user = r.rows[0] ?? null;
  } catch {
    user = null;
  }

  if (!user) {
    const err = new URL('/login', req.url);
    err.searchParams.set('demo_error', 'A demó-felhasználó nem található. Futott a demó-seed?');
    return NextResponse.redirect(err);
  }

  const token = await new SignJWT({
    userId: user.id,
    email: user.email,
    role: user.role,
    restrictedView: user.restricted_view,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET);

  const res = NextResponse.redirect(new URL('/', req.url));
  res.cookies.set('auth-token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: JWT_EXPIRES_IN_S,
    path: '/',
  });
  return res;
}

import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { SignJWT } from 'jose';
import { logActivity } from '@/lib/activity';
import { roleHandler } from '@/lib/api/route-handler';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

const JWT_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000;

export const dynamic = 'force-dynamic';

export const POST = roleHandler(['admin'], async (req, { auth }) => {
  const body = await req.json();
  const { userId } = body;

  if (!userId) {
    return NextResponse.json(
      { error: 'Felhasználó ID megadása kötelező' },
      { status: 400 }
    );
  }

  const pool = getDbPool();
  
  const userResult = await pool.query(
    'SELECT id, email, role, active, restricted_view FROM users WHERE id = $1',
    [userId]
  );

  if (userResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Felhasználó nem található' },
      { status: 404 }
    );
  }

  const user = userResult.rows[0];

  if (!user.active) {
    return NextResponse.json(
      { error: 'A felhasználói fiók inaktív' },
      { status: 403 }
    );
  }

  const token = await new SignJWT({
    userId: user.id,
    email: user.email,
    role: user.role,
    restrictedView: user.restricted_view || false,
    impersonatedBy: auth.userId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET);

  await logActivity(req, auth.email, 'impersonate', `Belépés mint: ${user.email}`);

  const response = NextResponse.json({
    success: true,
    user: {
      email: user.email,
      role: user.role,
    },
  });

  response.cookies.set('auth-token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: JWT_EXPIRES_IN / 1000,
    path: '/',
  });

  return response;
});

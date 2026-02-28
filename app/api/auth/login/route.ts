import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { logActivity } from '@/lib/activity';
import { apiHandler } from '@/lib/api/route-handler';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

const JWT_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000;

export const dynamic = 'force-dynamic';

export const POST = apiHandler(async (req) => {
  const body = await req.json();
  const { email, password } = body;

  if (!email || !password) {
    return NextResponse.json(
      { error: 'Email cím és jelszó megadása kötelező' },
      { status: 400 }
    );
  }

  const pool = getDbPool();
  
  const userResult = await pool.query(
    'SELECT id, email, password_hash, role, active, restricted_view FROM users WHERE email = $1',
    [email.toLowerCase().trim()]
  );

  if (userResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Hibás email cím vagy jelszó' },
      { status: 401 }
    );
  }

  const user = userResult.rows[0];

  if (!user.active) {
    return NextResponse.json(
      { error: 'A felhasználói fiók inaktív' },
      { status: 403 }
    );
  }

  const isValidPassword = await bcrypt.compare(password, user.password_hash);
  
  if (!isValidPassword) {
    return NextResponse.json(
      { error: 'Hibás email cím vagy jelszó' },
      { status: 401 }
    );
  }

  const token = await new SignJWT({
    userId: user.id,
    email: user.email,
    role: user.role,
    restrictedView: user.restricted_view || false,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET);

  await pool.query(
    'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
    [user.id]
  );

  await logActivity(req, user.email, 'login', 'success');

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

import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { correlationId, auth }) => {
  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json(
      { error: 'Google Calendar integráció nincs beállítva' },
      { status: 500 }
    );
  }

  const host = req.headers.get('host');
  let protocol = req.headers.get('x-forwarded-proto') || 'https';
  if (host && (host.includes('localhost') || host.includes('127.0.0.1'))) {
    protocol = 'http';
  }
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `${protocol}://${host}`;
  const redirectUri = GOOGLE_REDIRECT_URI || `${baseUrl}/api/google-calendar/callback`;

  const stateToken = await new SignJWT({
    userId: auth.userId,
    email: auth.email,
    timestamp: Date.now(),
    random: Math.random().toString(36).substring(7),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(JWT_SECRET);

  const pool = getDbPool();
  const userResult = await pool.query(
    `SELECT google_calendar_refresh_token 
     FROM users 
     WHERE id = $1`,
    [auth.userId]
  );

  const hasRefreshToken = userResult.rows.length > 0 && userResult.rows[0].google_calendar_refresh_token;

  const searchParams = req.nextUrl.searchParams;
  const isReconnect = searchParams.get('reconnect') === '1';

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly');
  authUrl.searchParams.set('access_type', 'offline');

  if (!hasRefreshToken || isReconnect) {
    authUrl.searchParams.set('prompt', 'consent');
  }

  authUrl.searchParams.set('state', stateToken);

  return NextResponse.json({ authUrl: authUrl.toString() });
});

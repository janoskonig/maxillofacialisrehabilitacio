import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

/**
 * OAuth2 authorization URL generálása és redirect
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    if (!GOOGLE_CLIENT_ID) {
      return NextResponse.json(
        { error: 'Google Calendar integráció nincs beállítva' },
        { status: 500 }
      );
    }

    // Dinamikus redirect URI generálás
    const host = request.headers.get('host');
    // Protocol detection: localhost esetén http, egyébként https (vagy x-forwarded-proto)
    let protocol = request.headers.get('x-forwarded-proto') || 'https';
    if (host && (host.includes('localhost') || host.includes('127.0.0.1'))) {
      protocol = 'http';
    }
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `${protocol}://${host}`;
    const redirectUri = GOOGLE_REDIRECT_URI || `${baseUrl}/api/google-calendar/callback`;

    // State paraméter generálása (CSRF védelem)
    const stateToken = await new SignJWT({
      userId: auth.userId,
      email: auth.email,
      timestamp: Date.now(),
      random: Math.random().toString(36).substring(7),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('10m') // 10 perc élettartam
      .sign(JWT_SECRET);

    // Google OAuth2 authorization URL
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    // Szükséges scope-ok: események kezelése és naptárak listázása
    authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly');
    authUrl.searchParams.set('access_type', 'offline'); // Refresh token kérése
    authUrl.searchParams.set('prompt', 'consent'); // Mindig kérjük a consent-et (refresh token miatt)
    authUrl.searchParams.set('state', stateToken);

    return NextResponse.json({ authUrl: authUrl.toString() });
  } catch (error) {
    console.error('Error generating OAuth2 URL:', error);
    return NextResponse.json(
      { error: 'Hiba történt az OAuth2 URL generálásakor' },
      { status: 500 }
    );
  }
}


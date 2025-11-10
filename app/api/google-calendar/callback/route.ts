import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { getDbPool } from '@/lib/db';
import { encryptToken } from '@/lib/google-calendar';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

/**
 * OAuth2 callback feldolgozása
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Ha hiba van, redirect a settings oldalra
    if (error) {
      return NextResponse.redirect(
        new URL('/settings?google_calendar_error=' + encodeURIComponent(error), request.url)
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL('/settings?google_calendar_error=missing_params', request.url)
      );
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return NextResponse.redirect(
        new URL('/settings?google_calendar_error=not_configured', request.url)
      );
    }

    // State validáció (CSRF védelem)
    let statePayload;
    try {
      const { payload } = await jwtVerify(state, JWT_SECRET);
      statePayload = payload as { userId: string; email: string; timestamp: number; random: string };
    } catch (error) {
      console.error('Invalid state token:', error);
      return NextResponse.redirect(
        new URL('/settings?google_calendar_error=invalid_state', request.url)
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
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/google-calendar/callback`;

    // Authorization code exchange access token-re
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code: code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}));
      console.error('Token exchange error:', errorData);
      return NextResponse.redirect(
        new URL('/settings?google_calendar_error=token_exchange_failed', request.url)
      );
    }

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token || !tokenData.refresh_token) {
      return NextResponse.redirect(
        new URL('/settings?google_calendar_error=missing_tokens', request.url)
      );
    }

    // Google user info lekérése (email címhez)
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    let googleEmail = statePayload.email; // Fallback
    if (userInfoResponse.ok) {
      const userInfo = await userInfoResponse.json();
      googleEmail = userInfo.email || statePayload.email;
    }

    // Tokenek mentése adatbázisba (titkosítva)
    const pool = getDbPool();
    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : new Date(Date.now() + 3600 * 1000); // Default 1 óra

    await pool.query(
      `UPDATE users 
       SET google_calendar_refresh_token = $1,
           google_calendar_access_token = $2,
           google_calendar_token_expires_at = $3,
           google_calendar_enabled = true,
           google_calendar_email = $4
       WHERE id = $5`,
      [
        encryptToken(tokenData.refresh_token),
        encryptToken(tokenData.access_token),
        expiresAt,
        googleEmail,
        statePayload.userId,
      ]
    );

    // Sikeres redirect a settings oldalra
    return NextResponse.redirect(
      new URL('/settings?google_calendar_success=true', request.url)
    );
  } catch (error) {
    console.error('Error processing OAuth2 callback:', error);
    return NextResponse.redirect(
      new URL('/settings?google_calendar_error=internal_error', request.url)
    );
  }
}


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
 * Get base URL for redirects (production-proof, proxy-aware)
 * Priority: 1) NEXT_PUBLIC_BASE_URL env var, 2) x-forwarded-host/proto, 3) host header, 4) request.url
 */
function getBaseUrl(request: NextRequest): string {
  // 1) Prefer public canonical URL (recommended)
  const envUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (envUrl) {
    // normalize: remove trailing slash
    return envUrl.endsWith('/') ? envUrl.slice(0, -1) : envUrl;
  }

  // 2) Proxy-aware fallback
  // Next/Edge: headers may include forwarded values
  const xfProto = request.headers.get('x-forwarded-proto');
  const xfHost = request.headers.get('x-forwarded-host');
  if (xfHost) {
    const proto = xfProto ?? 'https';
    return `${proto}://${xfHost}`;
  }

  // 3) Direct host fallback
  const host = request.headers.get('host');
  if (host) {
    const proto = xfProto ?? (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https');
    return `${proto}://${host}`;
  }

  // 4) Last resort: derive from request.url (may be internal)
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}

/**
 * OAuth2 callback feldolgozása
 */
export async function GET(request: NextRequest) {
  // Base URL meghatározása a handler elején (minden redirect előtt)
  const baseUrl = getBaseUrl(request);

  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Ha hiba van, redirect a settings oldalra
    if (error) {
      return NextResponse.redirect(
        new URL('/settings?google_calendar_error=' + encodeURIComponent(error), baseUrl)
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL('/settings?google_calendar_error=missing_params', baseUrl)
      );
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return NextResponse.redirect(
        new URL('/settings?google_calendar_error=not_configured', baseUrl)
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
        new URL('/settings?google_calendar_error=invalid_state', baseUrl)
      );
    }

    // Dinamikus redirect URI generálás (Google OAuth callback URL-hez)
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
        new URL('/settings?google_calendar_error=token_exchange_failed', baseUrl)
      );
    }

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token || !tokenData.refresh_token) {
      return NextResponse.redirect(
        new URL('/settings?google_calendar_error=missing_tokens', baseUrl)
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

    // KRITIKUS: Refresh token mindig mentése, de csak akkor frissítjük, ha új érkezik
    // (Token rotation esetén az új refresh token felülírja a régit)
    await pool.query(
      `UPDATE users 
       SET google_calendar_refresh_token = $1,
           google_calendar_access_token = $2,
           google_calendar_token_expires_at = $3,
           google_calendar_enabled = true,
           google_calendar_email = $4,
           google_calendar_status = 'active',
           google_calendar_last_error_code = NULL,
           google_calendar_last_error_at = NULL
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
      new URL('/settings?google_calendar_success=true', baseUrl)
    );
  } catch (error) {
    console.error('Error processing OAuth2 callback:', error);
    return NextResponse.redirect(
      new URL('/settings?google_calendar_error=internal_error', baseUrl)
    );
  }
}


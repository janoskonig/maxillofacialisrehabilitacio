import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { getDbPool } from '@/lib/db';
import { encryptToken } from '@/lib/google-calendar';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

type CallbackStep =
  | "parse_params"
  | "validate_state"
  | "token_exchange"
  | "token_encryption"
  | "database_update"
  | "success_redirect";

function normalizeError(err: unknown) {
  const e = err as any;
  const isError = err instanceof Error;

  return {
    name: isError ? err.name : (typeof e?.name === "string" ? e.name : "UnknownError"),
    message: isError ? err.message : String(err),
    stack: isError ? err.stack : undefined,
    // Postgres / node / http kliens kódok (ha vannak)
    code: typeof e?.code === "string" ? e.code : undefined,
    status: typeof e?.response?.status === "number" ? e.response.status : undefined,
  };
}

function detectErrorType(n: ReturnType<typeof normalizeError>, step: CallbackStep): {
  errorType: "database_error" | "encryption_error" | "internal_error";
  errorStep: CallbackStep;
} {
  // Postgres tipikus error codes:
  // 42703 = undefined_column
  // 42P01 = undefined_table
  // 28xxx = invalid authorization specification (auth)
  // 57P01 = admin shutdown
  // 08006 = connection failure
  const pgCodesDb = new Set(["42703", "42P01", "42601", "08006", "57P01"]);

  const msg = (n.message || "").toLowerCase();

  // Encryption
  const looksLikeEncryption =
    msg.includes("encryption_key") ||
    msg.includes("encrypt") ||
    msg.includes("decrypt") ||
    msg.includes("cipher") ||
    msg.includes("invalid key length");

  // Database
  const looksLikeDb =
    pgCodesDb.has(n.code ?? "") ||
    (msg.includes("column") && msg.includes("does not exist")) ||
    (msg.includes("relation") && msg.includes("does not exist")) ||
    msg.includes("syntax error") ||
    (msg.includes("connect") && msg.includes("timeout"));

  if (looksLikeEncryption || step === "token_encryption") {
    return { errorType: "encryption_error", errorStep: step };
  }

  if (looksLikeDb || step === "database_update") {
    return { errorType: "database_error", errorStep: step };
  }

  return { errorType: "internal_error", errorStep: step };
}

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
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Base URL meghatározása a handler elején (minden redirect előtt)
  const baseUrl = getBaseUrl(request);
  let step: CallbackStep = "parse_params";
  let statePayload: { userId: string; email: string; timestamp: number; random: string } | null = null;

  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Korai hibák: itt is baseUrl-t használj
  if (error) {
    console.error("[Google Calendar Callback] OAuth error param", {
      error,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
    return NextResponse.redirect(
      new URL('/settings?google_calendar_error=' + encodeURIComponent(error), baseUrl)
    );
  }

  if (!code || !state) {
    console.error("[Google Calendar Callback] Missing params", { hasCode: !!code, hasState: !!state });
    return NextResponse.redirect(
      new URL('/settings?google_calendar_error=missing_params', baseUrl)
    );
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(
      new URL('/settings?google_calendar_error=not_configured', baseUrl)
    );
  }

  try {
    // 1) State validáció (CSRF védelem)
    step = "validate_state";
    try {
      const { payload } = await jwtVerify(state, JWT_SECRET);
      statePayload = payload as { userId: string; email: string; timestamp: number; random: string };
    } catch (error) {
      const n = normalizeError(error);
      console.error("[Google Calendar Callback] Invalid state token", {
        step,
        errorName: n.name,
        errorMessage: n.message,
      });
      return NextResponse.redirect(
        new URL('/settings?google_calendar_error=invalid_state', baseUrl)
      );
    }

    // 2) Token exchange
    step = "token_exchange";
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/google-calendar/callback`;

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
      console.error("[Google Calendar Callback] Token exchange error", {
        step,
        userId: statePayload?.userId ?? "unknown",
        httpStatus: tokenResponse.status,
        errorData: errorData.error ? { error: errorData.error } : undefined,
      });
      return NextResponse.redirect(
        new URL('/settings?google_calendar_error=token_exchange_failed', baseUrl)
      );
    }

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token || !tokenData.refresh_token) {
      console.error("[Google Calendar Callback] Missing tokens in response", {
        step,
        userId: statePayload?.userId ?? "unknown",
        hasAccessToken: !!tokenData.access_token,
        hasRefreshToken: !!tokenData.refresh_token,
      });
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

    // 3) Encryption
    step = "token_encryption";
    let encryptedRefreshToken: string;
    let encryptedAccessToken: string;

    try {
      encryptedRefreshToken = encryptToken(tokenData.refresh_token);
      encryptedAccessToken = encryptToken(tokenData.access_token);
    } catch (encryptErr) {
      const n = normalizeError(encryptErr);
      console.error("[Google Calendar Callback] Encryption error", {
        step,
        userId: statePayload?.userId ?? "unknown",
        errorName: n.name,
        errorMessage: n.message,
        errorCode: n.code,
      });
      throw encryptErr;
    }

    // 4) Database update
    step = "database_update";
    const pool = getDbPool();
    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : new Date(Date.now() + 3600 * 1000); // Default 1 óra

    try {
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
          encryptedRefreshToken,
          encryptedAccessToken,
          expiresAt,
          googleEmail,
          statePayload.userId,
        ]
      );
    } catch (dbErr) {
      const n = normalizeError(dbErr);
      console.error("[Google Calendar Callback] Database error", {
        step,
        userId: statePayload?.userId ?? "unknown",
        pgCode: n.code,
        errorName: n.name,
        errorMessage: n.message,
      });
      throw dbErr;
    }

    // 5) Success redirect
    step = "success_redirect";
    return NextResponse.redirect(
      new URL('/settings?google_calendar_success=true', baseUrl)
    );
  } catch (err) {
    const n = normalizeError(err);
    const { errorType, errorStep } = detectErrorType(n, step);

    // Strukturált log – ne logolj code/state tartalmat, csak bool/metadata
    console.error("[Google Calendar Callback] Error processing OAuth callback", {
      errorType,
      errorStep,
      errorName: n.name,
      errorMessage: n.message,
      errorStack: n.stack,
      // PG / HTTP meta, ha van
      errorCode: n.code,
      httpStatus: n.status,
      // user context, ha már van
      userId: statePayload?.userId ?? "unknown",
      userEmail: statePayload?.email ?? "unknown",
      // request context (safe)
      requestUrl: request.url,
      hasCode: true,
      hasState: true,
      userAgent: request.headers.get("user-agent") ?? undefined,
      forwardedHost: request.headers.get("x-forwarded-host") ?? undefined,
      forwardedProto: request.headers.get("x-forwarded-proto") ?? undefined,
    });

    return NextResponse.redirect(
      new URL(`/settings?google_calendar_error=${encodeURIComponent(errorType)}`, baseUrl)
    );
  }
}


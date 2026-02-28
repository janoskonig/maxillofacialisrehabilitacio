import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { getDbPool } from '@/lib/db';
import { encryptToken } from '@/lib/google-calendar';
import { apiHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

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
    code: typeof e?.code === "string" ? e.code : undefined,
    status: typeof e?.response?.status === "number" ? e.response.status : undefined,
  };
}

function detectErrorType(n: ReturnType<typeof normalizeError>, step: CallbackStep): {
  errorType: "database_error" | "encryption_error" | "internal_error";
  errorStep: CallbackStep;
} {
  const pgCodesDb = new Set(["42703", "42P01", "42601", "08006", "57P01"]);

  const msg = (n.message || "").toLowerCase();

  const looksLikeEncryption =
    msg.includes("encryption_key") ||
    msg.includes("encrypt") ||
    msg.includes("decrypt") ||
    msg.includes("cipher") ||
    msg.includes("invalid key length");

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

function getBaseUrl(request: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (envUrl) {
    return envUrl.endsWith('/') ? envUrl.slice(0, -1) : envUrl;
  }

  const xfProto = request.headers.get('x-forwarded-proto');
  const xfHost = request.headers.get('x-forwarded-host');
  if (xfHost) {
    const proto = xfProto ?? 'https';
    return `${proto}://${xfHost}`;
  }

  const host = request.headers.get('host');
  if (host) {
    const proto = xfProto ?? (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https');
    return `${proto}://${host}`;
  }

  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req, { correlationId }) => {
  const baseUrl = getBaseUrl(req);
  let step: CallbackStep = "parse_params";
  let statePayload: { userId: string; email: string; timestamp: number; random: string } | null = null;

  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    logger.error("[Google Calendar Callback] OAuth error param", {
      error,
      requestId: req.headers.get("x-request-id") ?? undefined,
    });
    return NextResponse.redirect(
      new URL('/settings?google_calendar_error=' + encodeURIComponent(error), baseUrl)
    );
  }

  if (!code || !state) {
    logger.error("[Google Calendar Callback] Missing params", { hasCode: !!code, hasState: !!state });
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
    step = "validate_state";
    try {
      const { payload } = await jwtVerify(state, JWT_SECRET);
      statePayload = payload as { userId: string; email: string; timestamp: number; random: string };
    } catch (error) {
      const n = normalizeError(error);
      logger.error("[Google Calendar Callback] Invalid state token", {
        step,
        errorName: n.name,
        errorMessage: n.message,
      });
      return NextResponse.redirect(
        new URL('/settings?google_calendar_error=invalid_state', baseUrl)
      );
    }

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
      logger.error("[Google Calendar Callback] Token exchange error", {
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
      logger.error("[Google Calendar Callback] Missing tokens in response", {
        step,
        userId: statePayload?.userId ?? "unknown",
        hasAccessToken: !!tokenData.access_token,
        hasRefreshToken: !!tokenData.refresh_token,
      });
      return NextResponse.redirect(
        new URL('/settings?google_calendar_error=missing_tokens', baseUrl)
      );
    }

    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    let googleEmail = statePayload.email;
    if (userInfoResponse.ok) {
      const userInfo = await userInfoResponse.json();
      googleEmail = userInfo.email || statePayload.email;
    }

    step = "token_encryption";
    let encryptedRefreshToken: string;
    let encryptedAccessToken: string;

    try {
      encryptedRefreshToken = encryptToken(tokenData.refresh_token);
      encryptedAccessToken = encryptToken(tokenData.access_token);
    } catch (encryptErr) {
      const n = normalizeError(encryptErr);
      logger.error("[Google Calendar Callback] Encryption error", {
        step,
        userId: statePayload?.userId ?? "unknown",
        errorName: n.name,
        errorMessage: n.message,
        errorCode: n.code,
      });
      throw encryptErr;
    }

    step = "database_update";
    const pool = getDbPool();
    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : new Date(Date.now() + 3600 * 1000);

    try {
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
      logger.error("[Google Calendar Callback] Database error", {
        step,
        userId: statePayload?.userId ?? "unknown",
        pgCode: n.code,
        errorName: n.name,
        errorMessage: n.message,
      });
      throw dbErr;
    }

    step = "success_redirect";
    return NextResponse.redirect(
      new URL('/settings?google_calendar_success=true', baseUrl)
    );
  } catch (err) {
    const n = normalizeError(err);
    const { errorType, errorStep } = detectErrorType(n, step);

    logger.error("[Google Calendar Callback] Error processing OAuth callback", {
      errorType,
      errorStep,
      errorName: n.name,
      errorMessage: n.message,
      errorStack: n.stack,
      errorCode: n.code,
      httpStatus: n.status,
      userId: statePayload?.userId ?? "unknown",
      userEmail: statePayload?.email ?? "unknown",
      requestUrl: req.url,
      hasCode: true,
      hasState: true,
      userAgent: req.headers.get("user-agent") ?? undefined,
      forwardedHost: req.headers.get("x-forwarded-host") ?? undefined,
      forwardedProto: req.headers.get("x-forwarded-proto") ?? undefined,
    });

    return NextResponse.redirect(
      new URL(`/settings?google_calendar_error=${encodeURIComponent(errorType)}`, baseUrl)
    );
  }
});

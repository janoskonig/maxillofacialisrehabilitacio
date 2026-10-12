import { SignJWT } from 'jose';
import { NextRequest, NextResponse } from 'next/server';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

/** Keep host-only session cookies and subsequent navigation on the same host. */
export function getPortalRequestBaseUrl(request: NextRequest): URL {
  // Next's custom-server adapter can build nextUrl with the internal hostname.
  // Host is the HTTP request's browser-visible host, including a local dev port.
  let host = request.headers.get('host') || request.nextUrl.host;
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  // Accept a proxy-rewritten host only when it names this request's host or a
  // configured deployment. Arbitrary forwarded hosts must not receive tokens.
  if (forwardedHost) {
    const allowedHosts = new Set([host, 'rehabilitacios-protetika.hu', 'www.rehabilitacios-protetika.hu']);
    for (const configuredUrl of [process.env.NEXT_PUBLIC_BASE_URL, process.env.RENDER_EXTERNAL_URL]) {
      if (!configuredUrl) continue;
      try { allowedHosts.add(new URL(configuredUrl).host); } catch { /* Ignore malformed configuration. */ }
    }
    if (allowedHosts.has(forwardedHost)) host = forwardedHost;
  }
  // TLS may terminate at the reverse proxy before reaching the custom server.
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'https'
    ? 'https:' : request.nextUrl.protocol;
  return new URL(`${protocol}//${host}`);
}

export function portalRedirect(request: NextRequest, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, getPortalRequestBaseUrl(request)), 303);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export function isCrossOriginPortalPost(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  return request.headers.get('sec-fetch-site') === 'cross-site'
    || (origin !== null && origin !== getPortalRequestBaseUrl(request).origin);
}

export async function createPatientPortalSession(
  patientId: string,
  impersonatedBy?: string,
): Promise<string> {
  return new SignJWT({
    patientId,
    type: 'patient_portal',
    ...(impersonatedBy ? { impersonatedBy } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET);
}

export function setPatientPortalSessionCookie(
  response: NextResponse,
  request: NextRequest,
  sessionToken: string,
): void {
  response.cookies.set('patient_portal_session', sessionToken, {
    httpOnly: true,
    secure: getPortalRequestBaseUrl(request).protocol === 'https:',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
}

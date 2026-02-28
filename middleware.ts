import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { checkRateLimit } from '@/lib/rate-limit';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

const PUBLIC_API_PREFIXES = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/patient-portal/auth/',
  '/api/bno-codes',
  '/api/push/public-key',
  '/api/push/reminders',
  '/api/ohip14/reminders',
  '/api/scheduling/events-worker',
  '/api/scheduling/event-retention',
  '/api/scheduling/hold-expiry',
  '/api/scheduling/intent-expiry',
  '/api/scheduling/google-reconcile',
  '/api/google-calendar/callback',
  '/api/google-calendar/sync/cron',
  '/api/appointments/approve',
  '/api/appointments/reject',
  '/api/appointments/request-new',
  '/api/institutions',
  '/api/events',
  '/api/feedback',
  '/api/health',
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

const AUTH_PREFIXES = ['/api/auth/login', '/api/auth/register', '/api/auth/forgot-password', '/api/auth/reset-password'];
const AUTH_RATE_LIMIT = 10;
const AUTH_RATE_WINDOW = 60_000;
const API_RATE_LIMIT = 100;
const API_RATE_WINDOW = 60_000;

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown';
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Rate limiting
  const ip = getClientIp(request);
  const isAuthRoute = AUTH_PREFIXES.some(p => pathname.startsWith(p));
  const rlKey = isAuthRoute ? `auth:${ip}` : `api:${ip}`;
  const rlMax = isAuthRoute ? AUTH_RATE_LIMIT : API_RATE_LIMIT;
  const rlWindow = isAuthRoute ? AUTH_RATE_WINDOW : API_RATE_WINDOW;
  const rl = checkRateLimit(rlKey, rlMax, rlWindow);

  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
          'X-RateLimit-Limit': String(rlMax),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get('auth-token')?.value;
  if (!token) {
    return NextResponse.next();
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-id', payload.userId as string);
    requestHeaders.set('x-user-email', payload.email as string);
    requestHeaders.set('x-user-role', payload.role as string);

    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  matcher: ['/api/:path*'],
};

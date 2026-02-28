import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

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
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
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

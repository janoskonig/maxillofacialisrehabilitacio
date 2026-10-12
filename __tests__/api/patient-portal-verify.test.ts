// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, type NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  verifySession: vi.fn(),
  query: vi.fn(),
  patientInfo: vi.fn(),
  patientMail: vi.fn(),
  adminMail: vi.fn(),
}));

vi.mock('@/lib/patient-portal-auth', () => ({ verifyPortalToken: mocks.verifyToken }));
vi.mock('@/lib/patient-portal-server', () => ({ verifyPatientPortalSession: mocks.verifySession }));
vi.mock('@/lib/db', () => ({ getDbPool: () => ({ query: mocks.query }) }));
vi.mock('@/lib/patient-portal-email', () => ({
  getPatientEmailInfo: mocks.patientInfo,
  sendPatientLoginNotification: mocks.patientMail,
}));
vi.mock('@/lib/email', () => ({ sendPatientLoginNotificationToAdmins: mocks.adminMail }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/api/route-handler', () => ({
  apiHandler: (handler: (req: NextRequest) => Promise<NextResponse>) => handler,
}));

import { GET, POST } from '@/app/api/patient-portal/auth/verify/route';
import { GET as EMAIL_GET, POST as EMAIL_POST } from '@/app/api/patient-portal/auth/verify-email/route';

const TOKEN = 'a'.repeat(64);
const PATIENT_ID = '00000000-0000-4000-8000-000000000001';
const PUBLIC_ORIGIN = 'https://patients.example.test';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const jwtSecret = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production',
);

function request(options: {
  email?: boolean;
  method?: 'GET' | 'POST';
  token?: string | null;
  headers?: Record<string, string>;
  publicOrigin?: string;
} = {}) {
  const publicOrigin = options.publicOrigin || PUBLIC_ORIGIN;
  const route = options.email ? 'verify-email' : 'verify';
  // Next's internal URL differs from the browser-visible Host behind TLS termination.
  const url = new URL(`/api/patient-portal/auth/${route}`, 'http://localhost:3000');
  const method = options.method || 'GET';
  const token = options.token === undefined ? TOKEN : options.token;
  const headers: Record<string, string> = {
    host: new URL(publicOrigin).host,
    'x-forwarded-proto': new URL(publicOrigin).protocol.slice(0, -1),
    ...options.headers,
  };
  if (method === 'GET') {
    if (token !== null) url.searchParams.set('token', token);
    return new NextRequest(url, { headers });
  }
  const body = new URLSearchParams();
  if (token !== null) body.set('token', token);
  return new NextRequest(url, {
    method,
    headers: {
      origin: publicOrigin,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: body.toString(),
  });
}

async function expectSession(response: NextResponse) {
  const cookie = response.cookies.get('patient_portal_session');
  expect(cookie?.value).toBeTruthy();
  const { payload } = await jwtVerify(cookie!.value, jwtSecret);
  expect(payload.patientId).toBe(PATIENT_ID);
  expect(payload.type).toBe('patient_portal');
  expect(payload.exp! - payload.iat!).toBe(SESSION_SECONDS);
  const header = response.headers.get('set-cookie');
  expect(header).toContain(`Max-Age=${SESSION_SECONDS}`);
  expect(header).toMatch(/HttpOnly/i);
  expect(header).toMatch(/Secure/i);
  expect(header).toMatch(/SameSite=lax/i);
  expect(header).toContain('Path=/');
  expect(header).not.toMatch(/Domain=/i);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-12T08:00:00.000Z'));
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://canonical.example.test');
  mocks.verifyToken.mockResolvedValue({ patientId: PATIENT_ID, isUsed: false });
  mocks.verifySession.mockResolvedValue(null);
  mocks.patientInfo.mockResolvedValue({ email: 'patient@example.test', name: 'Test Patient' });
  mocks.patientMail.mockResolvedValue(undefined);
  mocks.adminMail.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (sql: string) => ({
    rows: /^SELECT id FROM patients/.test(sql) ? [{ id: PATIENT_ID }] : [],
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe.each([
  { email: false, get: GET, post: POST, tokenType: 'magic_link' },
  { email: true, get: EMAIL_GET, post: EMAIL_POST, tokenType: 'email_verification' },
])('patient portal $tokenType verification', ({ email, get, post, tokenType }) => {
  it('lets scanners open GET links without consuming tokens or creating sessions', async () => {
    const response = await get(request({ email }));

    expect(response.status).toBe(303);
    const destination = new URL(response.headers.get('location')!);
    expect(destination.origin).toBe(PUBLIC_ORIGIN);
    expect(destination.pathname).toBe('/patient-portal/sign-in');
    expect(destination.searchParams.get('token')).toBe(TOKEN);
    expect(destination.searchParams.get('mode')).toBe(email ? 'email' : null);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.verifyToken).not.toHaveBeenCalled();
    expect(mocks.patientInfo).not.toHaveBeenCalled();
    expect(mocks.patientMail).not.toHaveBeenCalled();
    expect(mocks.adminMail).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('sets a seven-day cookie and redirects on the browser host after form submission', async () => {
    const response = await post(request({ email, method: 'POST' }));

    expect(mocks.verifyToken).toHaveBeenCalledWith(TOKEN, tokenType);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `${PUBLIC_ORIGIN}/patient-portal/dashboard${email ? '?verified=true' : ''}`,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expectSession(response);
  });

  it.each<Record<string, string>>([
    { origin: 'https://attacker.example.test' },
    { 'sec-fetch-site': 'cross-site' },
  ])('rejects cross-origin form submissions before consuming a token: %j', async headers => {
    const response = await post(request({ email, method: 'POST', headers }));
    expect(response.status).toBe(403);
    expect(mocks.verifyToken).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each([
    { token: null, error: 'missing_token' },
    { token: 'not-a-token', error: 'invalid_token' },
    { token: 'a'.repeat(65), error: 'invalid_token' },
  ])('rejects a malformed token before verification: $error / $token', async ({ token, error }) => {
    for (const method of ['GET', 'POST'] as const) {
      const response = await (method === 'GET' ? get : post)(request({ email, method, token }));
      expect(response.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/patient-portal?error=${error}`);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
    expect(mocks.verifyToken).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired database token without creating a session', async () => {
    mocks.verifyToken.mockResolvedValue(null);
    const response = await post(request({ email, method: 'POST' }));
    expect(response.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/patient-portal?error=invalid_token`);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.patientMail).not.toHaveBeenCalled();
  });
});

describe('magic-link retry and notification delivery', () => {
  it.each([
    ['NEXT_PUBLIC_BASE_URL', 'https://canonical.example.test'],
    ['RENDER_EXTERNAL_URL', 'https://render-external.example.test'],
  ])('uses an allowed forwarded browser host configured by %s', async (env, publicOrigin) => {
    vi.stubEnv(env, publicOrigin);
    const headers = {
      host: 'internal-service:10000',
      'x-forwarded-host': `${new URL(publicOrigin).host}, internal-proxy`,
    };
    const getResponse = await GET(request({ headers, publicOrigin }));
    expect(new URL(getResponse.headers.get('location')!).origin).toBe(publicOrigin);

    const response = await POST(request({ method: 'POST', headers, publicOrigin }));
    expect(response.headers.get('location')).toBe(`${publicOrigin}/patient-portal/dashboard`);
    await expectSession(response);
  });

  it('ignores an untrusted forwarded host when redirecting or setting a session', async () => {
    const headers = { 'x-forwarded-host': 'attacker.example.test' };
    const getResponse = await GET(request({ headers }));
    expect(new URL(getResponse.headers.get('location')!).origin).toBe(PUBLIC_ORIGIN);

    const response = await POST(request({ method: 'POST', headers }));
    expect(response.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/patient-portal/dashboard`);
    await expectSession(response);
  });

  it.each([null, 'a-different-patient'])('cannot replay a used link without its matching session: %s', async session => {
    mocks.verifyToken.mockResolvedValue({ patientId: PATIENT_ID, isUsed: true });
    mocks.verifySession.mockResolvedValue(session);
    const response = await POST(request({ method: 'POST' }));
    expect(response.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/patient-portal?error=token_used`);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.patientMail).not.toHaveBeenCalled();
  });

  it('resumes an existing matching session when its link is submitted again', async () => {
    mocks.verifyToken.mockResolvedValue({ patientId: PATIENT_ID, isUsed: true });
    mocks.verifySession.mockResolvedValue(PATIENT_ID);
    const response = await POST(request({ method: 'POST' }));
    expect(response.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/patient-portal/dashboard`);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.patientMail).not.toHaveBeenCalled();
  });

  it('returns the session cookie while SMTP is still pending', async () => {
    let finishMail!: () => void;
    let mailCompleted = false;
    mocks.patientMail.mockImplementationOnce(() => new Promise<void>(resolve => {
      finishMail = () => { mailCompleted = true; resolve(); };
    }));
    const response = await POST(request({ method: 'POST' }));
    expect(mocks.patientMail).toHaveBeenCalledTimes(1);
    expect(mailCompleted).toBe(false);
    await expectSession(response);
    finishMail();
  }, 1_000);

  it('keeps local HTTP login cookies usable without a Secure attribute', async () => {
    const response = await POST(request({ method: 'POST', publicOrigin: 'http://localhost:3001' }));
    expect(response.headers.get('location')).toBe('http://localhost:3001/patient-portal/dashboard');
    expect(response.headers.get('set-cookie')).not.toMatch(/; Secure/i);
  });
});

it('does not create an email-verification session when the patient no longer exists', async () => {
  mocks.query.mockResolvedValue({ rows: [] });
  const response = await EMAIL_POST(request({ email: true, method: 'POST' }));
  expect(response.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/patient-portal?error=patient_not_found`);
  expect(response.headers.get('set-cookie')).toBeNull();
});

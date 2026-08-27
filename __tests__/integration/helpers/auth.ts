import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';

/**
 * JWT és NextRequest gyártása route-handlereket közvetlenül hívó tesztekhez.
 * A claim-alak a login route-tal (app/api/auth/login/route.ts) egyezik.
 */

export type TestAuthUser = {
  id: string;
  email: string;
  role: 'admin' | 'fogpótlástanász' | 'technikus' | 'beutalo_orvos';
  restrictedView?: boolean;
};

export async function tokenFor(user: TestAuthUser): Promise<string> {
  const secret = new TextEncoder().encode(
    process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
  );
  return await new SignJWT({
    userId: user.id,
    email: user.email,
    role: user.role,
    restrictedView: user.restrictedView ?? false,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

export async function authedRequest(
  url: string,
  opts: {
    user: TestAuthUser;
    method?: string;
    body?: unknown;
  }
): Promise<NextRequest> {
  const token = await tokenFor(opts.user);
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  return new NextRequest(url, {
    method: opts.method ?? 'GET',
    headers,
    body,
  });
}

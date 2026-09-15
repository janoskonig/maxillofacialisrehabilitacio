import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';

const isUserActiveMock = vi.fn();
vi.mock('@/lib/user-active-check', () => ({
  isUserActive: (...args: unknown[]) => isUserActiveMock(...args),
}));

import { verifyAuth, requireAuth, HttpError } from '@/lib/auth-server';

/**
 * verifyAuth: érvényes JWT + inaktivált fiók → nincs session (a 7 napos
 * token nem éli túl az inaktiválást).
 */
const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
);

async function tokenFor(userId: string) {
  return await new SignJWT({ userId, email: 'x@y.hu', role: 'fogpótlástanász' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(SECRET);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('verifyAuth + fiók-aktivitás', () => {
  it('aktív fiók: a payload visszajön', async () => {
    isUserActiveMock.mockResolvedValue(true);
    const req = new NextRequest('http://localhost/api/x', {
      headers: { authorization: `Bearer ${await tokenFor('u1')}` },
    });
    const auth = await verifyAuth(req);
    expect(auth?.userId).toBe('u1');
    expect(isUserActiveMock).toHaveBeenCalledWith('u1');
  });

  it('inaktivált fiók: érvényes token ellenére null / 401', async () => {
    isUserActiveMock.mockResolvedValue(false);
    const req = new NextRequest('http://localhost/api/x', {
      headers: { authorization: `Bearer ${await tokenFor('u2')}` },
    });
    expect(await verifyAuth(req)).toBeNull();
    await expect(requireAuth(req)).rejects.toBeInstanceOf(HttpError);
  });

  it('token nélkül nem kérdezi a DB-t', async () => {
    const req = new NextRequest('http://localhost/api/x');
    expect(await verifyAuth(req)).toBeNull();
    expect(isUserActiveMock).not.toHaveBeenCalled();
  });
});

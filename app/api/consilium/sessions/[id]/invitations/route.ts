import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getScopedSessionOrThrow, getUserInstitution } from '@/lib/consilium';
import { listInvitationsForSession } from '@/lib/consilium-invitations';

export const dynamic = 'force-dynamic';

/**
 * Visszaadja a kiválasztott alkalom meghívóit (RSVP státusz táblázat
 * a UI-on a jelenlévők mellé). Csak azonos intézményű felhasználó látja.
 */
export const GET = authedHandler(async (_req, { auth, params }) => {
  const sessionId = params.id;
  const institutionId = await getUserInstitution(auth);
  await getScopedSessionOrThrow(sessionId, institutionId);

  const invitations = await listInvitationsForSession(sessionId);
  return NextResponse.json({ invitations });
});

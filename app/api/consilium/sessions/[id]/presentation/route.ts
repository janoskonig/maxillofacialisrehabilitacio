import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getUserInstitution } from '@/lib/consilium';
import { buildConsiliumPresentationPayload } from '@/lib/consilium-presentation';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (_req, { auth, params }) => {
  const sessionId = params.id;
  const institutionId = await getUserInstitution(auth);
  const payload = await buildConsiliumPresentationPayload(sessionId, institutionId);
  if (!payload) {
    return NextResponse.json({ error: 'Konzílium alkalom nem található' }, { status: 404 });
  }
  return NextResponse.json(payload);
});

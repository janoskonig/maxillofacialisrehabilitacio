import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getUserInstitution } from '@/lib/consilium';
import { buildConsiliumPresentationPayload } from '@/lib/consilium-presentation';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth, params }) => {
  const sessionId = params.id;
  const institutionId = await getUserInstitution(auth);
  const payload = await buildConsiliumPresentationPayload(sessionId, institutionId);
  if (!payload) {
    return NextResponse.json({ error: 'Konzílium alkalom nem található' }, { status: 404 });
  }

  await logActivity(
    req,
    auth.email,
    'consilium_live_presentation_loaded',
    JSON.stringify({
      sessionId,
      itemCount: payload.items?.length ?? 0,
      sessionStatus: payload.session?.status,
    }),
    { skipAdminNotificationQueue: true },
  );

  return NextResponse.json(payload);
});

import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { assertPrepTokenOrThrow, listPrepCommentsForItem } from '@/lib/consilium-prep-share';
import { buildConsiliumPresentationItemPayload } from '@/lib/consilium-presentation';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth, params }) => {
  const rawToken = decodeURIComponent(params.token ?? '');
  if (!rawToken) {
    return NextResponse.json({ error: 'Hiányzó token' }, { status: 400 });
  }

  const prep = await assertPrepTokenOrThrow(rawToken);

  const payload = await buildConsiliumPresentationItemPayload(prep.sessionId, prep.institutionId, prep.itemId);
  if (!payload) {
    return NextResponse.json({ error: 'Előkészítő adat nem tölthető' }, { status: 404 });
  }

  await logActivity(
    req,
    auth.email,
    'consilium_prep_presentation_loaded',
    JSON.stringify({
      sessionId: prep.sessionId,
      itemId: prep.itemId,
      sessionStatus: prep.sessionStatus,
    }),
    { skipAdminNotificationQueue: true },
  );

  const prepComments = await listPrepCommentsForItem(prep.itemId);

  return NextResponse.json({
    ...payload,
    prepComments,
    prepMeta: {
      sessionId: prep.sessionId,
      itemId: prep.itemId,
      sessionStatus: prep.sessionStatus,
    },
  });
});

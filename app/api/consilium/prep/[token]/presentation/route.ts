import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { assertPrepTokenOrThrow, listPrepCommentsForItem } from '@/lib/consilium-prep-share';
import { buildConsiliumPresentationItemPayload } from '@/lib/consilium-presentation';
import { getUserInstitution } from '@/lib/consilium';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (_req, { auth, params }) => {
  const rawToken = decodeURIComponent(params.token ?? '');
  if (!rawToken) {
    return NextResponse.json({ error: 'Hiányzó token' }, { status: 400 });
  }

  const institutionId = await getUserInstitution(auth);
  const prep = await assertPrepTokenOrThrow(rawToken, institutionId);

  const payload = await buildConsiliumPresentationItemPayload(prep.sessionId, institutionId, prep.itemId);
  if (!payload) {
    return NextResponse.json({ error: 'Előkészítő adat nem tölthető' }, { status: 404 });
  }

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

import { NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api/route-handler';
import { validateLimit, validateOffset } from '@/lib/validation';
import { resolveContextLinkViewer } from '@/lib/messaging/context-link-viewer';
import {
  getMessagesForEntity,
  parseContextEntityType,
  parseContextEntityId,
} from '@/lib/messaging/context-links';

export const dynamic = 'force-dynamic';

/**
 * GET /api/messages/context?entityType=document&entityId=...
 * Üzenetek, amelyekhez strukturált link kapcsolódik (beteg csatorna).
 */
export const GET = apiHandler(async (req) => {
  const viewer = await resolveContextLinkViewer(req);
  if (!viewer) {
    return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const entityType = parseContextEntityType(sp.get('entityType'));
  const entityId = parseContextEntityId(sp.get('entityId'));
  const limit = validateLimit(
    sp.get('limit') ? parseInt(sp.get('limit')!, 10) : undefined,
  );
  const offset = validateOffset(
    sp.get('offset') ? parseInt(sp.get('offset')!, 10) : undefined,
  );

  const messages = await getMessagesForEntity(
    'patient',
    entityType,
    entityId,
    viewer,
    { limit, offset },
  );

  return NextResponse.json({ success: true, messages });
});

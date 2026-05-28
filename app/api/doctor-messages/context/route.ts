import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { validateLimit, validateOffset } from '@/lib/validation';
import {
  getMessagesForEntity,
  parseContextEntityType,
  parseContextEntityId,
} from '@/lib/messaging/context-links';

export const dynamic = 'force-dynamic';

/**
 * GET /api/doctor-messages/context?entityType=...&entityId=...
 */
export const GET = authedHandler(async (req, { auth }) => {
  const sp = req.nextUrl.searchParams;
  const entityType = parseContextEntityType(sp.get('entityType'));
  const entityId = parseContextEntityId(sp.get('entityId'));
  const limit = validateLimit(
    sp.get('limit') ? parseInt(sp.get('limit')!, 10) : undefined,
  );
  const offset = validateOffset(
    sp.get('offset') ? parseInt(sp.get('offset')!, 10) : undefined,
  );

  const viewer = {
    kind: 'staff' as const,
    userId: auth.userId,
    role: auth.role,
    email: auth.email,
  };

  const messages = await getMessagesForEntity(
    'doctor',
    entityType,
    entityId,
    viewer,
    { limit, offset },
  );

  return NextResponse.json({ success: true, messages });
});

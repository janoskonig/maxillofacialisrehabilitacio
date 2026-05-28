import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { validateUUID } from '@/lib/validation';
import {
  getMessageContextLinks,
  linkMessageToEntity,
  unlinkMessageContextLink,
  parseContextEntityType,
  parseContextEntityId,
} from '@/lib/messaging/context-links';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth, params }) => {
  const messageId = validateUUID(params.id, 'Üzenet ID');
  const viewer = {
    kind: 'staff' as const,
    userId: auth.userId,
    role: auth.role,
    email: auth.email,
  };
  const links = await getMessageContextLinks('doctor', messageId, viewer);
  return NextResponse.json({ success: true, links });
});

export const POST = authedHandler(async (req, { auth, params }) => {
  const messageId = validateUUID(params.id, 'Üzenet ID');
  const body = await req.json();
  const entityType = parseContextEntityType(body.entityType);
  const entityId = parseContextEntityId(body.entityId);

  const link = await linkMessageToEntity(
    'doctor',
    messageId,
    entityType,
    entityId,
    {
      kind: 'staff',
      userId: auth.userId,
      role: auth.role,
      email: auth.email,
    },
  );

  return NextResponse.json({ success: true, link }, { status: 201 });
});

export const DELETE = authedHandler(async (req, { auth, params }) => {
  const messageId = validateUUID(params.id, 'Üzenet ID');
  const body = await req.json().catch(() => ({}));
  const linkId = parseContextEntityId(body.linkId ?? req.nextUrl.searchParams.get('linkId'));

  await unlinkMessageContextLink('doctor', messageId, linkId, {
    kind: 'staff',
    userId: auth.userId,
    role: auth.role,
    email: auth.email,
  });

  return NextResponse.json({ success: true });
});

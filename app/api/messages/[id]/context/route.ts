import { NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api/route-handler';
import { validateUUID } from '@/lib/validation';
import { resolveContextLinkViewer } from '@/lib/messaging/context-link-viewer';
import {
  getMessageContextLinks,
  linkMessageToEntity,
  unlinkMessageContextLink,
  parseContextEntityType,
  parseContextEntityId,
} from '@/lib/messaging/context-links';

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req, { params }) => {
  const viewer = await resolveContextLinkViewer(req);
  if (!viewer) {
    return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
  }

  const messageId = validateUUID(params.id, 'Üzenet ID');
  const links = await getMessageContextLinks('patient', messageId, viewer);
  return NextResponse.json({ success: true, links });
});

export const POST = apiHandler(async (req, { params }) => {
  const viewer = await resolveContextLinkViewer(req);
  if (!viewer || viewer.kind !== 'staff') {
    return NextResponse.json(
      { error: 'Csak bejelentkezett orvosi felhasználó csatolhat strukturált linket' },
      { status: 403 },
    );
  }

  const messageId = validateUUID(params.id, 'Üzenet ID');
  const body = await req.json();
  const entityType = parseContextEntityType(body.entityType);
  const entityId = parseContextEntityId(body.entityId);

  const link = await linkMessageToEntity(
    'patient',
    messageId,
    entityType,
    entityId,
    viewer,
  );

  return NextResponse.json({ success: true, link }, { status: 201 });
});

export const DELETE = apiHandler(async (req, { params }) => {
  const viewer = await resolveContextLinkViewer(req);
  if (!viewer || viewer.kind !== 'staff') {
    return NextResponse.json(
      { error: 'Csak bejelentkezett orvosi felhasználó távolíthat el strukturált linket' },
      { status: 403 },
    );
  }

  const messageId = validateUUID(params.id, 'Üzenet ID');
  const body = await req.json().catch(() => ({}));
  const linkId = parseContextEntityId(body.linkId ?? req.nextUrl.searchParams.get('linkId'));

  await unlinkMessageContextLink('patient', messageId, linkId, viewer);
  return NextResponse.json({ success: true });
});

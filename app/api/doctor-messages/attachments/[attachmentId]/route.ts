import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { isUuid } from '@/lib/messaging/document-link-marker';
import {
  getDoctorMessageAttachmentForViewer,
  toPublicAttachment,
} from '@/lib/messaging/doctor-message-attachments';

export const dynamic = 'force-dynamic';

/** GET /api/doctor-messages/attachments/[attachmentId] — melléklet metaadat (jogosultság-ellenőrzéssel). */
export const GET = authedHandler(async (_req, { auth, params }) => {
  const attachmentId = params.attachmentId;
  if (!attachmentId || !isUuid(attachmentId)) {
    return NextResponse.json({ error: 'Érvénytelen melléklet azonosító' }, { status: 400 });
  }

  const attachment = await getDoctorMessageAttachmentForViewer(attachmentId, auth);
  if (!attachment) {
    return NextResponse.json({ error: 'Melléklet nem található' }, { status: 404 });
  }

  return NextResponse.json({ attachment: toPublicAttachment(attachment) });
});

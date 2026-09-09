import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { downloadChatAttachment } from '@/lib/ftp-client';
import { isUuid } from '@/lib/messaging/document-link-marker';
import { getDoctorMessageAttachmentForViewer } from '@/lib/messaging/doctor-message-attachments';

export const dynamic = 'force-dynamic';

/**
 * GET /api/doctor-messages/attachments/[attachmentId]/file — a kép bájtjai.
 * Alapból inline (böngészőben megjelenik); `?download=true` → letöltés.
 */
export const GET = authedHandler(async (req, { auth, params }) => {
  const attachmentId = params.attachmentId;
  if (!attachmentId || !isUuid(attachmentId)) {
    return NextResponse.json({ error: 'Érvénytelen melléklet azonosító' }, { status: 400 });
  }

  const attachment = await getDoctorMessageAttachmentForViewer(attachmentId, auth);
  if (!attachment) {
    return NextResponse.json({ error: 'Melléklet nem található' }, { status: 404 });
  }

  const fileBuffer = await downloadChatAttachment(attachment.filePath);
  const download = new URL(req.url).searchParams.get('download') === 'true';
  const encodedName = encodeURIComponent(attachment.filename);

  return new NextResponse(new Uint8Array(fileBuffer), {
    status: 200,
    headers: {
      'Content-Type': attachment.mimeType || 'application/octet-stream',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${encodedName}"`,
      'Content-Length': String(fileBuffer.length),
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

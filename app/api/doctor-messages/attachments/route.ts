import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import {
  isFtpConfigured,
  getMaxFileSize,
  generateDocumentFilename,
  uploadChatAttachment,
} from '@/lib/ftp-client';
import { logActivityWithAuth } from '@/lib/activity';
import { checkRateLimitAsync, buildRateLimitedResponse } from '@/lib/api/rate-limit';
import {
  insertDoctorMessageAttachment,
  toPublicAttachment,
} from '@/lib/messaging/doctor-message-attachments';
import { CHAT_IMAGE_DOCUMENT_TAG } from '@/lib/messaging/chat-image-marker';

export const dynamic = 'force-dynamic';

/**
 * POST /api/doctor-messages/attachments — chat-kép feltöltése beteghez rendelés
 * NÉLKÜL (orvos–orvos chat). Multipart: `file` (csak image/*).
 *
 * A válasz `attachment.id`-jával a kliens `[CHAT_IMAGE:<id>]` markert tesz az
 * üzenetbe; küldéskor a szerver a melléklethez köti az üzenetet
 * (bindChatImageAttachmentsToMessage), és attól fogva a beszélgetés
 * résztvevői is letölthetik.
 */
export const POST = authedHandler(async (req, { auth }) => {
  if (!isFtpConfigured()) {
    return NextResponse.json({ error: 'FTP szerver nincs konfigurálva' }, { status: 500 });
  }

  const rl = await checkRateLimitAsync({
    key: `msg-attachment:${auth.userId}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    const { body, retryAfterSeconds } = buildRateLimitedResponse(rl);
    return NextResponse.json(body, {
      status: 429,
      headers: { 'Retry-After': String(retryAfterSeconds) },
    });
  }

  const formData = await req.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Fájl kötelező' }, { status: 400 });
  }

  const mimeType = (file.type || '').toLowerCase();
  if (!mimeType.startsWith('image/')) {
    return NextResponse.json({ error: 'Csak képfájl csatolható az üzenethez' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'A fájl üres' }, { status: 400 });
  }
  const maxSize = getMaxFileSize();
  if (file.size > maxSize) {
    return NextResponse.json(
      { error: `Fájlméret túllépi a maximumot (${Math.round(maxSize / 1024 / 1024)}MB)` },
      { status: 400 },
    );
  }

  // Ugyanaz a névséma, mint a beteg-dokumentumoknál: {cimke}_{tulajdonos}_{datum}_{ido}_{rand}.{ext}
  // — itt a „tulajdonos” a feltöltő user id-ja (nincs beteg).
  const filename = generateDocumentFilename(file.name || 'kep.jpg', [CHAT_IMAGE_DOCUMENT_TAG], auth.userId, new Date());
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const filePath = await uploadChatAttachment(fileBuffer, filename);

  const attachment = await insertDoctorMessageAttachment({
    uploadedBy: auth.userId,
    filename,
    filePath,
    fileSize: file.size,
    mimeType: mimeType || null,
  });

  await logActivityWithAuth(
    req,
    auth,
    'doctor_message_attachment_uploaded',
    `Attachment: ${filename}, Size: ${file.size} bytes`,
  );

  return NextResponse.json({ attachment: toPublicAttachment(attachment) }, { status: 201 });
});

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import { ensurePrepTokenForItem } from '@/lib/consilium-prep-share';
import { getScopedSessionOrThrow, getUserInstitution } from '@/lib/consilium';
import { sendDoctorMessage } from '@/lib/doctor-communication';
import { sendDoctorMessageNotification } from '@/lib/email';
import { sendPushNotification } from '@/lib/push-notifications';
import { logActivityWithAuth } from '@/lib/activity';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const PREP_NOTE_MAX = 1000;

const shareBodySchema = z.object({
  recipientIds: z.array(z.string().uuid()).min(1).max(30),
  note: z.string().max(PREP_NOTE_MAX).optional(),
});

function resolvePublicBaseUrl(req: Request): string {
  const envBase = (process.env.NEXT_PUBLIC_BASE_URL || '').trim();
  if (envBase) return envBase.replace(/\/+$/, '');
  const h = req.headers;
  const xfHost = (h.get('x-forwarded-host') || '').trim();
  const host = xfHost || (h.get('host') || '').trim();
  const xfProto = (h.get('x-forwarded-proto') || '').trim();
  const proto = xfProto || (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https');
  if (host) return `${proto}://${host}`;
  return 'https://rehabilitacios-protetika.hu';
}

function composeMessageBody(token: string, note: string | null | undefined): string {
  const cleanNote = (note || '').trim();
  const marker = `[CONSILIUM_PREP:${token}]`;
  if (!cleanNote) return marker;
  return `${cleanNote}\n\n${marker}`;
}

export const POST = authedHandler(async (req, { auth, params }) => {
  const sessionId = params.id;
  const itemId = params.itemId;

  const institutionId = await getUserInstitution(auth);
  await getScopedSessionOrThrow(sessionId, institutionId);

  const body = await req.json().catch(() => ({}));
  const parsed = shareBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, 'Érvénytelen kérés', 'INVALID_REQUEST');
  }

  const recipientIds = Array.from(new Set(parsed.data.recipientIds.filter((x) => x !== auth.userId)));
  if (recipientIds.length === 0) {
    throw new HttpError(400, 'Adj meg legalább egy címzettet (saját magadat nem)', 'NO_RECIPIENTS');
  }

  const note = parsed.data.note?.trim() || null;

  const pool = getDbPool();

  const itemCheck = await pool.query<{ patientId: string | null }>(
    `SELECT patient_id as "patientId" FROM consilium_session_items
     WHERE id = $1::uuid AND session_id = $2::uuid`,
    [itemId, sessionId],
  );
  if (itemCheck.rows.length === 0) {
    throw new HttpError(404, 'Elem nem található ebben az alkalomban', 'ITEM_NOT_FOUND');
  }
  const patientId = itemCheck.rows[0].patientId;

  let patientName: string | null = null;
  if (patientId) {
    const pRes = await pool.query<{ nev: string | null }>(
      `SELECT nev FROM patients_full WHERE id = $1::uuid`,
      [patientId],
    );
    patientName = pRes.rows[0]?.nev?.trim?.() || null;
  }

  const recipientsRes = await pool.query<{
    id: string;
    email: string;
    doktorNeve: string | null;
    intezmeny: string | null;
    active: boolean;
  }>(
    `SELECT id, email, doktor_neve as "doktorNeve", intezmeny, active
     FROM users
     WHERE id = ANY($1::uuid[])`,
    [recipientIds],
  );

  const recipients = recipientsRes.rows.filter((r) => r.active);
  if (recipients.length === 0) {
    throw new HttpError(404, 'Nem található aktív címzett', 'NO_ACTIVE_RECIPIENTS');
  }

  const senderRes = await pool.query<{ doktorNeve: string | null }>(
    `SELECT doktor_neve as "doktorNeve" FROM users WHERE id = $1`,
    [auth.userId],
  );
  const senderName = senderRes.rows[0]?.doktorNeve?.trim?.() || null;

  const client = await pool.connect();
  let rawToken: string;
  try {
    await client.query('BEGIN');
    const ensured = await ensurePrepTokenForItem(client, {
      sessionId,
      itemId,
      createdBy: auth.email,
    });
    rawToken = ensured.rawToken;
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const prepPath = `/consilium/prep/${encodeURIComponent(rawToken)}`;
  const baseUrl = resolvePublicBaseUrl(req);
  const prepUrl = `${baseUrl}${prepPath}`;
  const subject = patientName
    ? `Konzílium előkészítő – ${patientName}`
    : 'Konzílium előkészítő';
  const messageBody = composeMessageBody(rawToken, note);

  const sentMessageIds: string[] = [];
  const skippedMismatchInstitution: string[] = [];

  for (const recipient of recipients) {
    const recipientInst = (recipient.intezmeny || '').trim();
    if (recipientInst !== institutionId) {
      skippedMismatchInstitution.push(recipient.id);
      continue;
    }
    try {
      const newMessage = await sendDoctorMessage({
        recipientId: recipient.id,
        senderId: auth.userId,
        senderEmail: auth.email,
        senderName,
        subject,
        message: messageBody,
      });
      sentMessageIds.push(newMessage.id);

      try {
        await sendDoctorMessageNotification(
          recipient.email,
          recipient.doktorNeve || recipient.email,
          senderName || auth.email,
          subject,
          note ? `${note}\n\nElőkészítő link: ${prepUrl}` : `Konzílium előkészítő link: ${prepUrl}`,
          baseUrl,
        );
      } catch (emailError) {
        logger.error('[consilium-prep-share] email notification failed', {
          recipientId: recipient.id,
          error: String(emailError),
        });
      }

      try {
        await sendPushNotification(recipient.id, {
          title: 'Konzílium előkészítő megosztva',
          body: patientName
            ? `${senderName || auth.email}: ${patientName}`
            : `${senderName || auth.email} megosztott egy konzílium előkészítőt`,
          icon: '/icon-192x192.png',
          tag: `consilium-prep-share-${newMessage.id}`,
          data: {
            url: `/messages?recipientId=${auth.userId}`,
            type: 'message',
            id: newMessage.id,
          },
        });
      } catch (pushError) {
        logger.error('[consilium-prep-share] push notification failed', {
          recipientId: recipient.id,
          error: String(pushError),
        });
      }
    } catch (sendError) {
      logger.error('[consilium-prep-share] send message failed', {
        recipientId: recipient.id,
        error: String(sendError),
      });
    }
  }

  await logActivityWithAuth(
    req,
    auth,
    'consilium_prep_link_shared',
    `Konzílium előkészítő link megosztva ${sentMessageIds.length} címzettnek (session=${sessionId}, item=${itemId})`,
  );

  return NextResponse.json(
    {
      token: rawToken,
      prepPath,
      prepUrl,
      sentCount: sentMessageIds.length,
      sentMessageIds,
      skippedMismatchInstitution,
    },
    { status: 200 },
  );
});

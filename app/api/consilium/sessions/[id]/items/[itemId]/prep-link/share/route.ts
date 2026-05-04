import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import { ensurePrepTokenForItem } from '@/lib/consilium-prep-share';
import { getScopedSessionOrThrow, getUserInstitution } from '@/lib/consilium';
import { sendDoctorMessage } from '@/lib/doctor-communication';
import { sendConsiliumPrepShareEmail } from '@/lib/email';
import { sendPushNotification } from '@/lib/push-notifications';
import { logActivityWithAuth } from '@/lib/activity';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const PREP_NOTE_MAX = 1000;

const shareBodySchema = z
  .object({
    recipientIds: z.array(z.string().uuid()).max(30).optional(),
    recipientEmails: z.array(z.string().trim().toLowerCase().email()).max(30).optional(),
    note: z.string().max(PREP_NOTE_MAX).optional(),
  })
  .refine(
    (d) =>
      (d.recipientIds && d.recipientIds.length > 0) ||
      (d.recipientEmails && d.recipientEmails.length > 0),
    { message: 'Adj meg legalább egy címzettet (felhasználó vagy e-mail).' },
  );

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

  const recipientIds = Array.from(
    new Set((parsed.data.recipientIds || []).filter((x) => x !== auth.userId)),
  );
  const recipientEmailsRaw = Array.from(
    new Set((parsed.data.recipientEmails || []).map((e) => e.trim().toLowerCase()).filter(Boolean)),
  );

  if (recipientIds.length === 0 && recipientEmailsRaw.length === 0) {
    throw new HttpError(400, 'Adj meg legalább egy címzettet', 'NO_RECIPIENTS');
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

  // Regisztrált címzettek lekérése (id-k alapján).
  let registeredRecipients: Array<{
    id: string;
    email: string;
    doktorNeve: string | null;
    active: boolean;
  }> = [];
  if (recipientIds.length > 0) {
    const recipientsRes = await pool.query<{
      id: string;
      email: string;
      doktorNeve: string | null;
      active: boolean;
    }>(
      `SELECT id, email, doktor_neve as "doktorNeve", active
       FROM users
       WHERE id = ANY($1::uuid[])`,
      [recipientIds],
    );
    registeredRecipients = recipientsRes.rows.filter((r) => r.active);
  }

  // Az e-mail címek közül kihagyjuk azokat, amik már a regisztrált címzettek között
  // szerepelnek (id-vel) — ne kapja meg dupán ugyanaz a kolléga.
  const registeredEmailSet = new Set(
    registeredRecipients.map((r) => r.email.trim().toLowerCase()),
  );
  // Saját email is kihagyandó.
  const selfEmail = (auth.email || '').trim().toLowerCase();

  // Az e-mail címeket szétválasztjuk: amelyik létezik a users táblában aktív fiókkal,
  // azt regisztráltként kezeljük (in-app üzenet + email). A többi: csak külső email.
  let externalEmails: string[] = [];
  if (recipientEmailsRaw.length > 0) {
    const filtered = recipientEmailsRaw.filter(
      (e) => !registeredEmailSet.has(e) && e !== selfEmail,
    );
    if (filtered.length > 0) {
      const lookupRes = await pool.query<{
        id: string;
        email: string;
        doktorNeve: string | null;
        active: boolean;
      }>(
        `SELECT id, email, doktor_neve as "doktorNeve", active
         FROM users
         WHERE lower(btrim(email)) = ANY($1::text[]) AND active = true`,
        [filtered],
      );
      const matchedByEmail = lookupRes.rows;
      // Hozzáfűzzük a regisztrált listához (deduplikálva id alapján).
      const existingIds = new Set(registeredRecipients.map((r) => r.id));
      for (const u of matchedByEmail) {
        if (!existingIds.has(u.id) && u.id !== auth.userId) {
          registeredRecipients.push(u);
          existingIds.add(u.id);
        }
      }
      const matchedEmails = new Set(matchedByEmail.map((u) => u.email.trim().toLowerCase()));
      externalEmails = filtered.filter((e) => !matchedEmails.has(e));
    }
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
  const sentEmails: string[] = [];

  for (const recipient of registeredRecipients) {
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
        await sendConsiliumPrepShareEmail(
          recipient.email,
          recipient.doktorNeve,
          senderName || auth.email,
          patientName,
          prepUrl,
          baseUrl,
          note,
        );
        sentEmails.push(recipient.email);
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

  for (const email of externalEmails) {
    try {
      await sendConsiliumPrepShareEmail(
        email,
        null,
        senderName || auth.email,
        patientName,
        prepUrl,
        baseUrl,
        note,
      );
      sentEmails.push(email);
    } catch (emailError) {
      logger.error('[consilium-prep-share] external email failed', {
        email,
        error: String(emailError),
      });
    }
  }

  await logActivityWithAuth(
    req,
    auth,
    'consilium_prep_link_shared',
    `Konzílium előkészítő link megosztva: ${sentMessageIds.length} in-app, ${sentEmails.length} email (session=${sessionId}, item=${itemId})`,
  );

  return NextResponse.json(
    {
      token: rawToken,
      prepPath,
      prepUrl,
      sentInAppCount: sentMessageIds.length,
      sentEmailCount: sentEmails.length,
      sentMessageIds,
      sentEmails,
    },
    { status: 200 },
  );
});

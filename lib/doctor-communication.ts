import { getDbPool } from './db';
import { extractPatientMentions } from './mention-parser';
import {
  parseReplyToMessageId,
  isDoctorReplyTargetInScope,
  buildQuotedMessagePreview,
  ReplyTargetNotFoundError,
  type DoctorReplyScope,
} from './message-reply';
import type {
  MessageContextLink,
  QuotedMessagePreview,
  ServerDeliveryStatus,
} from './types/messaging';
import { enrichMessagesWithContextLinks } from './messaging/attach-context-links';
import { syncDocumentContextLinkFromMarker } from './messaging/sync-context-link-from-marker';
import type { StaffViewer } from './messaging/context-links';
import {
  batchDoctorMessageReplyCounts,
  attachReplyCounts,
} from './message-reply-counts';
import {
  markDoctorMessagesDeliveredForViewer,
  parseServerDeliveryStatus,
  notifyDeliveryStatusUpdates,
} from './message-delivery';

export interface DoctorMessage {
  id: string;
  senderId: string;
  recipientId: string | null; // Lehet NULL csoportos beszélgetésnél
  groupId?: string | null; // Új mező a csoport ID-hoz
  senderEmail: string;
  senderName: string | null;
  recipientName?: string | null; // Címzett neve (opcionális, csak megjelenítéshez)
  groupName?: string | null; // Csoport neve (opcionális, csak megjelenítéshez)
  groupParticipantCount?: number; // Csoport résztvevők száma (opcionális, csak megjelenítéshez)
  subject: string | null;
  message: string;
  readAt: Date | null;
  createdAt: Date;
  mentionedPatientIds?: string[]; // Új mező a megemlített betegek ID-ihoz
  /** Az említett betegek neve (id + nev), hogy a renderer lekérés nélkül linkelhessen. */
  mentionedPatients?: Array<{ id: string; nev: string; taj?: string | null }>;
  /** 041_message_replies óta: ha válasz, az eredeti doctor_messages.id. */
  replyToMessageId?: string | null;
  /** Szerver által összerakott előnézet az eredeti üzenetről (csak reply-nál). */
  quotedMessage?: QuotedMessagePreview | null;
  /** Fázis 1.1: közvetlen válaszok száma. */
  replyCount?: number;
  /** Fázis 1.2: szerveroldali kézbesítési állapot. */
  deliveryStatus?: ServerDeliveryStatus;
  readBy?: Array<{ // Új mező: ki olvasta az üzenetet (group chat-ekhez)
    userId: string;
    userName: string | null;
    readAt: Date;
  }>;
  contextLinks?: MessageContextLink[];
}

export interface CreateDoctorMessageInput {
  recipientId?: string; // Opcionális egy-egy beszélgetéshez
  senderId: string;
  senderEmail: string;
  senderName?: string | null;
  subject?: string | null;
  message: string;
  groupId?: string; // Opcionális csoportos beszélgetéshez
  /**
   * Reply target üzenet ID-ja ugyanebben a szálban. Ha megadott, a backend
   * ellenőrzi, hogy a target tényleg ebbe a beszélgetésbe (group_id ill.
   * 1:1 pár) tartozik — máskülönben `ReplyTargetNotFoundError` (HTTP 404).
   */
  replyToMessageId?: string | null;
  /**
   * Slice 0.8: kliens-oldali idempotencia kulcs. Ha a `(sender_id,
   * client_message_id)` páros már létezik, a meglévő üzenetet adjuk vissza,
   * nem dobunk hibát. NULL-ra hagyva normál INSERT történik.
   */
  clientMessageId?: string | null;
  /**
   * Automatikus beteg-felismerésnél a felhasználó által megerősített beteg
   * ID-k. A `@`-jelöléssel kinyert ID-kkel egyesítve kerülnek a
   * `mentioned_patient_ids`-be (ez köti az üzenetet a beteg-profilhoz).
   */
  confirmedPatientIds?: string[];
}

/**
 * Belső helper: validálja és betölti a reply target üzenetet adott scope-ban.
 *
 * Visszatérési érték a `QuotedMessagePreview` az `INSERT ... RETURNING` után
 * visszaadott DoctorMessage-hez, hogy a kliens egyetlen roundtripben megkapja
 * mind a saját új üzenetét, mind az idézett szövegrészt.
 */
async function loadDoctorReplyTargetForScope(
  replyToMessageId: string,
  scope: DoctorReplyScope,
): Promise<QuotedMessagePreview> {
  const pool = getDbPool();

  // doktor_neve a felhasználói táblából kell, hogy a quote-ban
  // ugyanazt a megjelenítendő nevet lássuk, mint a többi buborékon.
  const targetResult = await pool.query(
    `SELECT dm.id, dm.group_id, dm.sender_id, dm.recipient_id,
            dm.sender_name, dm.message, dm.created_at,
            u.doktor_neve AS sender_doctor_name
       FROM doctor_messages dm
       LEFT JOIN users u ON u.id = dm.sender_id
      WHERE dm.id = $1`,
    [replyToMessageId],
  );

  if (targetResult.rows.length === 0) {
    throw new ReplyTargetNotFoundError();
  }

  const row = targetResult.rows[0];
  const inScope = isDoctorReplyTargetInScope(
    {
      groupId: row.group_id ?? null,
      senderId: row.sender_id,
      recipientId: row.recipient_id ?? null,
    },
    scope,
  );

  if (!inScope) {
    // Szándékosan ugyanaz a hibatípus, mint a "nem létezik" eset —
    // ne adjunk infót más szálak üzeneteiről.
    throw new ReplyTargetNotFoundError();
  }

  return buildQuotedMessagePreview({
    id: row.id,
    channel: 'doctor',
    senderId: row.sender_id,
    senderName: row.sender_doctor_name ?? row.sender_name ?? null,
    message: row.message,
    createdAt: row.created_at,
  });
}

/**
 * Belső helper: a doctor_messages DB sorból `DoctorMessage` DTO. A 0.8-as
 * idempotencia ágban használjuk, amikor egy meglévő üzenetet kell visszaadni
 * dupla POST esetén — a `quotedMessageOverride` opcióval a hívó beadhatja
 * az újra-felkért preview-t (a parent is változatlan, nem érdemes újra
 * lekérni).
 */
function buildDoctorMessageFromRow(
  row: any,
  opts?: { quotedMessageOverride?: QuotedMessagePreview | null },
): DoctorMessage {
  let mentionedPatientIdsParsed: string[] = [];
  if (row.mentioned_patient_ids) {
    if (typeof row.mentioned_patient_ids === 'string') {
      mentionedPatientIdsParsed = JSON.parse(row.mentioned_patient_ids);
    } else if (Array.isArray(row.mentioned_patient_ids)) {
      mentionedPatientIdsParsed = row.mentioned_patient_ids;
    }
  }
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id || null,
    groupId: row.group_id || null,
    senderEmail: row.sender_email,
    senderName: row.sender_name,
    subject: row.subject,
    message: row.message,
    readAt: row.read_at ? new Date(row.read_at) : null,
    createdAt: new Date(row.created_at),
    mentionedPatientIds: mentionedPatientIdsParsed,
    replyToMessageId: row.reply_to_message_id ?? null,
    quotedMessage: opts?.quotedMessageOverride ?? null,
    deliveryStatus: parseServerDeliveryStatus(row.delivery_status),
  };
}

/**
 * Belső helper: tömegesen betölti a quoted preview-kat egy ID-listához
 * (egy SELECT a doctor_messages táblára). A hívó réteg (getDoctorMessages,
 * getGroupMessages) gondoskodik róla, hogy csak ugyanezen szálban látható
 * üzenetek `reply_to_message_id`-jait adja be — a 0.2 POST-scope check +
 * 041 self-FK miatt a parent garantáltan ugyanabban a szálban van.
 */
async function loadDoctorQuotePreviewMap(
  ids: string[],
): Promise<Map<string, QuotedMessagePreview>> {
  const map = new Map<string, QuotedMessagePreview>();
  if (ids.length === 0) return map;

  const pool = getDbPool();
  const result = await pool.query(
    `SELECT dm.id, dm.sender_id, dm.sender_name, dm.message, dm.created_at,
            u.doktor_neve AS sender_doctor_name
       FROM doctor_messages dm
       LEFT JOIN users u ON u.id = dm.sender_id
      WHERE dm.id = ANY($1::uuid[])`,
    [ids],
  );

  for (const row of result.rows) {
    map.set(
      row.id,
      buildQuotedMessagePreview({
        id: row.id,
        channel: 'doctor',
        senderId: row.sender_id,
        senderName: row.sender_doctor_name ?? row.sender_name ?? null,
        message: row.message,
        createdAt: row.created_at,
      }),
    );
  }
  return map;
}

function effectiveDoctorDeliveryStatus(
  row: { delivery_status: unknown; sender_id: string },
  viewerUserId: string,
): ServerDeliveryStatus {
  let status = parseServerDeliveryStatus(row.delivery_status);
  if (status === 'sent' && row.sender_id !== viewerUserId) {
    status = 'delivered';
  }
  return status;
}

/** A JSONB `mentioned_patient_ids` oszlop tömbbé alakítása (string vagy array jöhet). */
function parseMentionedPatientIds(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? (value as string[]) : [];
}

/**
 * Az említett betegek nevének egyszeri, kötegelt betöltése a sorokhoz — így a
 * renderer közvetlenül linkelhet (nincs per-pill `/api/patients` lekérés).
 */
async function loadMentionedPatientsMap(
  rows: any[],
): Promise<Map<string, { id: string; nev: string; taj: string | null }>> {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const id of parseMentionedPatientIds(row.mentioned_patient_ids)) ids.add(id);
  }
  const map = new Map<string, { id: string; nev: string; taj: string | null }>();
  if (ids.size === 0) return map;
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT id, nev, taj FROM patients WHERE id = ANY($1::uuid[])`,
    [Array.from(ids)],
  );
  for (const r of result.rows) {
    map.set(r.id, { id: r.id, nev: r.nev, taj: r.taj ?? null });
  }
  return map;
}

async function mapDoctorMessageRows(
  rows: any[],
  viewerUserId: string,
  readByMap: Map<string, Array<{ userId: string; userName: string | null; readAt: Date }>>,
): Promise<DoctorMessage[]> {
  const messageIds = rows.map((row) => row.id as string);
  if (messageIds.length > 0) {
    const deliveredUpdates = await markDoctorMessagesDeliveredForViewer(messageIds, viewerUserId);
    notifyDeliveryStatusUpdates(deliveredUpdates);
  }

  const parentIds = Array.from(
    new Set(
      rows
        .map((row) => row.reply_to_message_id)
        .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0),
    ),
  );
  const quoteMap = await loadDoctorQuotePreviewMap(parentIds);
  const replyCountMap = await batchDoctorMessageReplyCounts(messageIds);
  const mentionedPatientsMap = await loadMentionedPatientsMap(rows);

  const mapped = rows.map((row) => {
    const mentionedPatientIds = parseMentionedPatientIds(row.mentioned_patient_ids);
    return {
      id: row.id,
      senderId: row.sender_id,
      recipientId: row.recipient_id || null,
      groupId: row.group_id || null,
      senderEmail: row.sender_email,
      senderName: row.sender_name,
      subject: row.subject,
      message: row.message,
      readAt: row.read_at ? new Date(row.read_at) : null,
      createdAt: new Date(row.created_at),
      replyToMessageId: row.reply_to_message_id ?? null,
      quotedMessage: row.reply_to_message_id
        ? quoteMap.get(row.reply_to_message_id) ?? null
        : null,
      readBy: row.group_id ? readByMap.get(row.id) || [] : undefined,
      deliveryStatus: effectiveDoctorDeliveryStatus(row, viewerUserId),
      mentionedPatientIds,
      mentionedPatients: mentionedPatientIds
        .map((id) => mentionedPatientsMap.get(id))
        .filter((p): p is { id: string; nev: string; taj: string | null } => Boolean(p)),
    };
  });

  return attachReplyCounts(mapped, replyCountMap);
}

async function enrichDoctorMessagesWithContextLinks(
  rows: DoctorMessage[],
  viewerUserId: string,
  viewerRole: string,
): Promise<DoctorMessage[]> {
  return enrichMessagesWithContextLinks('doctor', rows, {
    kind: 'staff',
    userId: viewerUserId,
    role: viewerRole,
  });
}

/**
 * Üzenet küldése orvosnak (1:1 vagy csoport).
 *
 * Reply támogatás (Szelet 0.2):
 *  - `replyToMessageId` opcionális UUID; ha érvénytelen formátum → throw 400-ként
 *    (parseReplyToMessageId), ha másik szálra mutat → `ReplyTargetNotFoundError`
 *    (HTTP 404, így nem leakelünk létezés-infót).
 *  - Sikeres válasz esetén a visszaadott `DoctorMessage`-be belekerül a
 *    `quotedMessage` preview is, hogy a kliensnek ne kelljen külön roundtrip.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Megerősített beteg ID-k szűrése: csak az érvényes UUID-formátumú, ténylegesen
 * létező beteg-ID-k maradnak (védelem hamis/elavult kliens-adat ellen).
 */
async function validatePatientIds(
  pool: ReturnType<typeof getDbPool>,
  ids: string[] | undefined,
): Promise<string[]> {
  const candidates = Array.from(
    new Set((ids ?? []).filter((id) => typeof id === 'string' && UUID_RE.test(id))),
  );
  if (candidates.length === 0) return [];
  const result = await pool.query(
    `SELECT id FROM patients WHERE id = ANY($1::uuid[])`,
    [candidates],
  );
  return result.rows.map((r: any) => r.id);
}

export async function sendDoctorMessage(input: CreateDoctorMessageInput): Promise<DoctorMessage> {
  const pool = getDbPool();

  // Beteg-hivatkozások: a legacy `@`-jelölésből kinyert ID-k egyesítve a
  // (szabad-szöveges felismerésből) megerősített ID-kkal. Ez a tömb köti az
  // üzenetet a beteg-profilhoz (`mentioned_patient_ids`).
  const mentionedFromText = await extractPatientMentions(input.message);
  const confirmedIds = await validatePatientIds(pool, input.confirmedPatientIds);
  const mentionedPatientIds = Array.from(
    new Set([...mentionedFromText, ...confirmedIds]),
  );

  // Reply target normalizálás + scope ACL ellenőrzés (Szelet 0.2)
  const normalizedReplyToId = parseReplyToMessageId(input.replyToMessageId);
  let quotedMessage: QuotedMessagePreview | null = null;
  if (normalizedReplyToId) {
    const scope: DoctorReplyScope = input.groupId
      ? { kind: 'group', groupId: input.groupId }
      : {
          kind: 'direct',
          userAId: input.senderId,
          userBId: input.recipientId ?? '',
        };
    quotedMessage = await loadDoctorReplyTargetForScope(normalizedReplyToId, scope);
  }

  // Slice 0.8: idempotencia — ha (sender_id, client_message_id) már él,
  // a meglévő sort adjuk vissza, ne csapjon meg 23505.
  const normalizedClientMessageId =
    typeof input.clientMessageId === 'string' && input.clientMessageId.trim().length > 0
      ? input.clientMessageId.trim()
      : null;

  if (normalizedClientMessageId) {
    const existing = await pool.query(
      `SELECT id, sender_id, recipient_id, group_id, sender_email, sender_name,
              subject, message, read_at, created_at, mentioned_patient_ids,
              reply_to_message_id
         FROM doctor_messages
        WHERE sender_id = $1 AND client_message_id = $2
        LIMIT 1`,
      [input.senderId, normalizedClientMessageId],
    );
    if (existing.rows.length > 0) {
      return buildDoctorMessageFromRow(existing.rows[0], { quotedMessageOverride: quotedMessage });
    }
  }

  // Üzenet mentése (groupId + reply_to_message_id + client_message_id támogatással)
  const result = await pool.query(
    `INSERT INTO doctor_messages
       (sender_id, recipient_id, sender_email, sender_name, subject, message,
        mentioned_patient_ids, group_id, reply_to_message_id, client_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, sender_id, recipient_id, sender_email, sender_name, subject, message,
               read_at, created_at, mentioned_patient_ids, group_id, reply_to_message_id`,
    [
      input.senderId,
      input.recipientId || null,
      input.senderEmail,
      input.senderName || null,
      input.subject || null,
      input.message,
      JSON.stringify(mentionedPatientIds),
      input.groupId || null,
      normalizedReplyToId,
      normalizedClientMessageId,
    ]
  );


  const row = result.rows[0];
  
  // Parse mentioned_patient_ids - PostgreSQL JSONB returns as object/array, not string
  let mentionedPatientIdsParsed: string[] = [];
  if (row.mentioned_patient_ids) {
    if (typeof row.mentioned_patient_ids === 'string') {
      mentionedPatientIdsParsed = JSON.parse(row.mentioned_patient_ids);
    } else if (Array.isArray(row.mentioned_patient_ids)) {
      mentionedPatientIdsParsed = row.mentioned_patient_ids;
    }
  }
  
  const message: DoctorMessage = {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id || null,
    groupId: row.group_id || null,
    senderEmail: row.sender_email,
    senderName: row.sender_name,
    subject: row.subject,
    message: row.message,
    readAt: row.read_at ? new Date(row.read_at) : null,
    createdAt: new Date(row.created_at),
    mentionedPatientIds: mentionedPatientIdsParsed,
    replyToMessageId: row.reply_to_message_id ?? null,
    quotedMessage,
  };

  const roleRow = await pool.query('SELECT role FROM users WHERE id = $1', [input.senderId]);
  const role = (roleRow.rows[0]?.role as string) ?? 'fogpótlástanász';
  await syncDocumentContextLinkFromMarker({
    channel: 'doctor',
    messageId: message.id,
    messageText: input.message,
    patientId: mentionedPatientIds[0] ?? '',
    actor: { kind: 'staff', userId: input.senderId, role },
  });

  return message;
}

/**
 * Orvos üzeneteinek lekérése
 * @param userId - Az orvos user ID-ja
 * @param options - Szűrési opciók
 */
export async function getDoctorMessages(
  userId: string,
  options?: {
    recipientId?: string; // Ha meg van adva, csak az adott orvossal való beszélgetés
    sentOnly?: boolean; // Csak küldött üzenetek
    receivedOnly?: boolean; // Csak fogadott üzenetek
    unreadOnly?: boolean; // Csak olvasatlan üzenetek
    limit?: number;
    offset?: number;
    viewerRole?: string;
  }
): Promise<DoctorMessage[]> {
  const pool = getDbPool();

  let query = `
    SELECT id, sender_id, recipient_id, group_id, sender_email, sender_name, subject, message, read_at, created_at, reply_to_message_id, delivery_status, mentioned_patient_ids
    FROM doctor_messages
    WHERE (sender_id = $1 OR recipient_id = $1)
  `;
  const params: any[] = [userId];

  if (options?.recipientId) {
    // Konverzáció egy adott orvossal
    query += ` AND ((sender_id = $1 AND recipient_id = $${params.length + 1}) OR (sender_id = $${params.length + 1} AND recipient_id = $1))`;
    params.push(options.recipientId);
  } else if (options?.sentOnly) {
    query += ` AND sender_id = $1`;
  } else if (options?.receivedOnly) {
    query += ` AND recipient_id = $1`;
  }

  if (options?.unreadOnly) {
    query += ` AND read_at IS NULL AND recipient_id = $1`;
  }

  query += ' ORDER BY created_at ASC'; // ASC, hogy a legrégebbi legyen először (chat nézethez)

  if (options?.limit) {
    query += ` LIMIT $${params.length + 1}`;
    params.push(options.limit);
  }

  if (options?.offset) {
    query += ` OFFSET $${params.length + 1}`;
    params.push(options.offset);
  }

  const result = await pool.query(query, params);

  // Lekérjük az olvasókat group chat üzenetekhez
  const groupMessageIds = result.rows
    .filter((row: any) => row.group_id)
    .map((row: any) => row.id);
  const readByMap = new Map<string, Array<{ userId: string; userName: string | null; readAt: Date }>>();
  
  if (groupMessageIds.length > 0) {
    const readsResult = await pool.query(
      `SELECT dmr.message_id, dmr.user_id, dmr.read_at, u.doktor_neve
       FROM doctor_message_reads dmr
       LEFT JOIN users u ON u.id = dmr.user_id
       WHERE dmr.message_id = ANY($1::uuid[])
       ORDER BY dmr.read_at ASC`,
      [groupMessageIds]
    );

    for (const readRow of readsResult.rows) {
      if (!readByMap.has(readRow.message_id)) {
        readByMap.set(readRow.message_id, []);
      }
      readByMap.get(readRow.message_id)!.push({
        userId: readRow.user_id,
        userName: readRow.doktor_neve || null,
        readAt: new Date(readRow.read_at),
      });
    }
  }

  const mapped = await mapDoctorMessageRows(result.rows, userId, readByMap);
  return enrichDoctorMessagesWithContextLinks(
    mapped,
    userId,
    options?.viewerRole ?? 'fogpótlástanász',
  );
}

/**
 * Üzenet olvasottnak jelölése
 * Group chat-eknél minden résztvevő jelölheti olvasottnak
 */
export async function markDoctorMessageAsRead(messageId: string, userId: string): Promise<void> {
  const pool = getDbPool();

  // Először ellenőrizzük, hogy group chat-e vagy egyéni beszélgetés
  const messageResult = await pool.query(
    `SELECT group_id, recipient_id FROM doctor_messages WHERE id = $1`,
    [messageId]
  );

  if (messageResult.rows.length === 0) {
    throw new Error('Üzenet nem található');
  }

  const message = messageResult.rows[0];

  if (message.group_id) {
    // Group chat: ellenőrizzük, hogy a felhasználó résztvevő-e
    const participantResult = await pool.query(
      `SELECT 1 FROM doctor_message_group_participants 
       WHERE group_id = $1 AND user_id = $2`,
      [message.group_id, userId]
    );

    if (participantResult.rows.length === 0) {
      throw new Error('Nincs jogosultsága az üzenet olvasottnak jelöléséhez');
    }

    // Group chat: rögzítjük az olvasást a doctor_message_reads táblában
    const insertResult = await pool.query(
      `INSERT INTO doctor_message_reads (message_id, user_id, read_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (message_id, user_id) DO NOTHING
       RETURNING id`,
      [messageId, userId]
    );
    
  } else {
    // Egyéni beszélgetés: csak akkor jelölhetjük olvasottnak, ha a felhasználó a címzett
    if (message.recipient_id !== userId) {
      throw new Error('Csak a saját fogadott üzeneteit jelölheti olvasottnak');
    }

    const updateResult = await pool.query(
      `UPDATE doctor_messages 
       SET read_at = CURRENT_TIMESTAMP,
           delivery_status = 'read'
       WHERE id = $1 AND recipient_id = $2 AND read_at IS NULL
       RETURNING id`,
      [messageId, userId]
    );
    
  }
}

/**
 * Olvasatlan üzenetek száma
 */
export async function getUnreadDoctorMessageCount(userId: string): Promise<number> {
  const pool = getDbPool();

  // Egyéni beszélgetések: olvasatlan üzenetek száma
  const individualResult = await pool.query(
    `SELECT COUNT(*) as count
     FROM doctor_messages
     WHERE recipient_id = $1 AND read_at IS NULL AND group_id IS NULL`,
    [userId]
  );
  const individualCount = parseInt(individualResult.rows[0].count, 10);

  // Group chat üzenetek: olvasatlan üzenetek száma (amiket nem én küldtem és nincs benne a doctor_message_reads táblában)
  const groupResult = await pool.query(
    `SELECT COUNT(*) as count
     FROM doctor_messages dm
     WHERE dm.group_id IS NOT NULL 
       AND dm.sender_id != $1
       AND EXISTS (
         SELECT 1 FROM doctor_message_group_participants dmgp
         WHERE dmgp.group_id = dm.group_id AND dmgp.user_id = $1
       )
       AND NOT EXISTS (
         SELECT 1 FROM doctor_message_reads dmr
         WHERE dmr.message_id = dm.id AND dmr.user_id = $1
       )`,
    [userId]
  );
  const groupCount = parseInt(groupResult.rows[0].count, 10);

  return individualCount + groupCount;
}

/**
 * Orvos adatainak lekérése email értesítéshez
 */
export async function getDoctorForNotification(userId: string): Promise<{
  email: string;
  name: string;
} | null> {
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT email, doktor_neve FROM users WHERE id = $1 AND active = true`,
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return {
    email: result.rows[0].email,
    name: result.rows[0].doktor_neve || result.rows[0].email,
  };
}

/**
 * Konverzációk listája (minden orvos, akivel van üzenet) - egyesített lista egyéni és csoportos beszélgetésekről
 */
export async function getDoctorConversations(userId: string): Promise<Array<{
  doctorId?: string;
  doctorName?: string;
  doctorEmail?: string;
  lastMessage: DoctorMessage | null;
  unreadCount: number;
  type: 'individual' | 'group';
  groupId?: string;
  groupName?: string | null;
  participantCount?: number;
}>> {
  const pool = getDbPool();
  const conversations: Array<{
    doctorId?: string;
    doctorName?: string;
    doctorEmail?: string;
    lastMessage: DoctorMessage | null;
    unreadCount: number;
    type: 'individual' | 'group';
    groupId?: string;
    groupName?: string | null;
    participantCount?: number;
  }> = [];

  // 1. Egyéni beszélgetések (ahol group_id IS NULL)
  // Minden partner orvos ID-ja egy lekérdezésben.
  const individualResult = await pool.query(
    `SELECT DISTINCT
       CASE
         WHEN sender_id = $1 THEN recipient_id
         ELSE sender_id
       END as other_doctor_id
     FROM doctor_messages
     WHERE (sender_id = $1 OR recipient_id = $1) AND group_id IS NULL`,
    [userId]
  );

  const peerIds: string[] = individualResult.rows
    .map((row) => row.other_doctor_id)
    .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);

  if (peerIds.length > 0) {
    // Partner orvos rekordok EGY lekérdezésben.
    const doctorsResult = await pool.query(
      `SELECT id, email, doktor_neve FROM users WHERE id = ANY($1::uuid[]) AND active = true`,
      [peerIds]
    );
    const doctorMap = new Map<string, { id: string; email: string; doktor_neve: string | null }>();
    for (const d of doctorsResult.rows) {
      doctorMap.set(d.id, d);
    }

    // Utolsó üzenet partnerenként EGY lekérdezésben (DISTINCT ON a partner ID-n).
    const lastMessagesResult = await pool.query(
      `SELECT DISTINCT ON (peer_id)
         peer_id, id, sender_id, recipient_id, group_id, sender_email, sender_name,
         subject, message, read_at, created_at, reply_to_message_id
       FROM (
         SELECT
           CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS peer_id,
           id, sender_id, recipient_id, group_id, sender_email, sender_name,
           subject, message, read_at, created_at, reply_to_message_id
         FROM doctor_messages
         WHERE (sender_id = $1 OR recipient_id = $1) AND group_id IS NULL
       ) sub
       ORDER BY peer_id, created_at DESC`,
      [userId]
    );

    // Idézet-előnézetek az összes utolsó üzenethez EGY lekérdezésben.
    const lastQuoteIds = Array.from(
      new Set(
        lastMessagesResult.rows
          .map((r) => r.reply_to_message_id)
          .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0),
      ),
    );
    const lastQuoteMap = await loadDoctorQuotePreviewMap(lastQuoteIds);

    const lastMessageByPeer = new Map<string, DoctorMessage>();
    for (const msgRow of lastMessagesResult.rows) {
      lastMessageByPeer.set(msgRow.peer_id, {
        id: msgRow.id,
        senderId: msgRow.sender_id,
        recipientId: msgRow.recipient_id || null,
        groupId: msgRow.group_id || null,
        senderEmail: msgRow.sender_email,
        senderName: msgRow.sender_name,
        subject: msgRow.subject,
        message: msgRow.message,
        readAt: msgRow.read_at ? new Date(msgRow.read_at) : null,
        createdAt: new Date(msgRow.created_at),
        replyToMessageId: msgRow.reply_to_message_id ?? null,
        quotedMessage: msgRow.reply_to_message_id
          ? lastQuoteMap.get(msgRow.reply_to_message_id) ?? null
          : null,
      });
    }

    // Olvasatlan üzenetek partnerenként EGY csoportosított lekérdezésben.
    const unreadResult = await pool.query(
      `SELECT sender_id AS peer_id, COUNT(*) as count
       FROM doctor_messages
       WHERE recipient_id = $1 AND read_at IS NULL AND group_id IS NULL
       GROUP BY sender_id`,
      [userId]
    );
    const unreadByPeer = new Map<string, number>();
    for (const r of unreadResult.rows) {
      unreadByPeer.set(r.peer_id, parseInt(r.count, 10));
    }

    for (const otherDoctorId of peerIds) {
      const doctor = doctorMap.get(otherDoctorId);
      if (!doctor) continue;

      conversations.push({
        doctorId: doctor.id,
        doctorName: doctor.doktor_neve || doctor.email,
        doctorEmail: doctor.email,
        lastMessage: lastMessageByPeer.get(otherDoctorId) ?? null,
        unreadCount: unreadByPeer.get(otherDoctorId) ?? 0,
        type: 'individual',
      });
    }
  }

  // 2. Csoportos beszélgetések
  const groups = await getDoctorMessageGroups(userId);
  
  for (const group of groups) {
    conversations.push({
      groupId: group.groupId,
      groupName: group.groupName,
      participantCount: group.participantCount,
      lastMessage: group.lastMessage,
      unreadCount: group.unreadCount,
      type: 'group',
    });
  }

  // Rendezés: olvasatlan üzenetek száma szerint, majd utolsó üzenet dátuma szerint
  conversations.sort((a, b) => {
    if (a.unreadCount !== b.unreadCount) {
      return b.unreadCount - a.unreadCount; // Több olvasatlan = előrébb
    }
    if (a.lastMessage && b.lastMessage) {
      return b.lastMessage.createdAt.getTime() - a.lastMessage.createdAt.getTime();
    }
    if (a.lastMessage) return -1;
    if (b.lastMessage) return 1;
    return 0;
  });

  return conversations;
}

/**
 * Csoportos beszélgetés létrehozása
 */
export async function createDoctorMessageGroup(
  createdBy: string,
  participantIds: string[],
  name?: string | null
): Promise<string> {
  const pool = getDbPool();

  // Validate: at least 2 participants (creator + at least one more)
  if (participantIds.length < 2) {
    throw new Error('Legalább 2 résztvevő szükséges a csoportos beszélgetéshez');
  }

  // No limit on participants - allow unlimited participants

  // Ensure creator is included
  const allParticipants = Array.from(new Set([createdBy, ...participantIds]));

  // Create group
  const groupResult = await pool.query(
    `INSERT INTO doctor_message_groups (name, created_by)
     VALUES ($1, $2)
     RETURNING id`,
    [name || null, createdBy]
  );

  const groupId = groupResult.rows[0].id;

  // Add participants
  for (const participantId of allParticipants) {
    await pool.query(
      `INSERT INTO doctor_message_group_participants (group_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [groupId, participantId]
    );
  }

  return groupId;
}

/**
 * Résztvevők hozzáadása csoportos beszélgetéshez
 */
export async function addParticipantsToGroup(
  groupId: string,
  participantIds: string[]
): Promise<void> {
  const pool = getDbPool();

  // Check if group exists
  const groupResult = await pool.query(
    `SELECT id FROM doctor_message_groups WHERE id = $1`,
    [groupId]
  );

  if (groupResult.rows.length === 0) {
    throw new Error('Csoportos beszélgetés nem található');
  }

  // No limit on participants - allow unlimited participants

  // Add participants
  for (const participantId of participantIds) {
    await pool.query(
      `INSERT INTO doctor_message_group_participants (group_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [groupId, participantId]
    );
  }
}

/**
 * Csoportos beszélgetés résztvevőinek lekérése
 */
export async function getGroupParticipants(groupId: string): Promise<Array<{
  userId: string;
  userName: string;
  userEmail: string;
  joinedAt: Date;
}>> {
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT 
      p.user_id,
      u.doktor_neve as user_name,
      u.email as user_email,
      p.joined_at
     FROM doctor_message_group_participants p
     INNER JOIN users u ON u.id = p.user_id
     WHERE p.group_id = $1 AND u.active = true
     ORDER BY p.joined_at ASC`,
    [groupId]
  );

  return result.rows.map((row: any) => ({
    userId: row.user_id,
    userName: row.user_name || row.user_email,
    userEmail: row.user_email,
    joinedAt: new Date(row.joined_at),
  }));
}

/**
 * Felhasználó csoportos beszélgetéseinek lekérése
 */
export async function getDoctorMessageGroups(userId: string): Promise<Array<{
  groupId: string;
  groupName: string | null;
  participantCount: number;
  lastMessage: DoctorMessage | null;
  unreadCount: number;
}>> {
  const pool = getDbPool();

  // Get all groups where user is a participant
  const groupsResult = await pool.query(
    `SELECT DISTINCT g.id, g.name, g.created_at
     FROM doctor_message_groups g
     INNER JOIN doctor_message_group_participants p ON p.group_id = g.id
     WHERE p.user_id = $1
     ORDER BY g.created_at DESC`,
    [userId]
  );

  const groups = [];
  const groupIds: string[] = groupsResult.rows.map((row) => row.id as string);

  if (groupIds.length > 0) {
    // Résztvevők száma csoportonként EGY csoportosított lekérdezésben.
    const participantCountResult = await pool.query(
      `SELECT group_id, COUNT(*) as count
       FROM doctor_message_group_participants
       WHERE group_id = ANY($1::uuid[])
       GROUP BY group_id`,
      [groupIds]
    );
    const participantCountByGroup = new Map<string, number>();
    for (const r of participantCountResult.rows) {
      participantCountByGroup.set(r.group_id, parseInt(r.count, 10));
    }

    // Utolsó üzenet csoportonként EGY lekérdezésben (DISTINCT ON a group_id-n).
    const lastMessagesResult = await pool.query(
      `SELECT DISTINCT ON (group_id)
         id, sender_id, recipient_id, group_id, sender_email, sender_name,
         subject, message, read_at, created_at, reply_to_message_id
       FROM doctor_messages
       WHERE group_id = ANY($1::uuid[])
       ORDER BY group_id, created_at DESC`,
      [groupIds]
    );

    // Olvasók az utolsó üzenetekhez EGY lekérdezésben.
    const lastMessageIds = lastMessagesResult.rows.map((r) => r.id as string);
    const readsByMessage = new Map<
      string,
      Array<{ userId: string; userName: string | null; readAt: Date }>
    >();
    if (lastMessageIds.length > 0) {
      const readsResult = await pool.query(
        `SELECT dmr.message_id, dmr.user_id, dmr.read_at, u.doktor_neve
         FROM doctor_message_reads dmr
         LEFT JOIN users u ON u.id = dmr.user_id
         WHERE dmr.message_id = ANY($1::uuid[])
         ORDER BY dmr.read_at ASC`,
        [lastMessageIds]
      );
      for (const readRow of readsResult.rows) {
        const list = readsByMessage.get(readRow.message_id) ?? [];
        list.push({
          userId: readRow.user_id,
          userName: readRow.doktor_neve || null,
          readAt: new Date(readRow.read_at),
        });
        readsByMessage.set(readRow.message_id, list);
      }
    }

    // Idézet-előnézetek az összes utolsó üzenethez EGY lekérdezésben.
    const lastQuoteIds = Array.from(
      new Set(
        lastMessagesResult.rows
          .map((r) => r.reply_to_message_id)
          .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0),
      ),
    );
    const lastQuoteMap = await loadDoctorQuotePreviewMap(lastQuoteIds);

    const lastMessageByGroup = new Map<string, DoctorMessage>();
    for (const msgRow of lastMessagesResult.rows) {
      lastMessageByGroup.set(msgRow.group_id, {
        id: msgRow.id,
        senderId: msgRow.sender_id,
        recipientId: msgRow.recipient_id || null,
        groupId: msgRow.group_id || null,
        senderEmail: msgRow.sender_email,
        senderName: msgRow.sender_name,
        subject: msgRow.subject,
        message: msgRow.message,
        readAt: msgRow.read_at ? new Date(msgRow.read_at) : null,
        createdAt: new Date(msgRow.created_at),
        replyToMessageId: msgRow.reply_to_message_id ?? null,
        quotedMessage: msgRow.reply_to_message_id
          ? lastQuoteMap.get(msgRow.reply_to_message_id) ?? null
          : null,
        readBy: readsByMessage.get(msgRow.id) ?? [],
      });
    }

    // Olvasatlan üzenetek csoportonként EGY csoportosított lekérdezésben.
    // Egy üzenet olvasatlan, ha nem a felhasználó küldte és nem olvasta még.
    const unreadResult = await pool.query(
      `SELECT dm.group_id, COUNT(*) as count
       FROM doctor_messages dm
       WHERE dm.group_id = ANY($1::uuid[])
         AND dm.sender_id != $2
         AND NOT EXISTS (
           SELECT 1
           FROM doctor_message_reads dmr
           WHERE dmr.message_id = dm.id
             AND dmr.user_id = $2
         )
       GROUP BY dm.group_id`,
      [groupIds, userId]
    );
    const unreadByGroup = new Map<string, number>();
    for (const r of unreadResult.rows) {
      unreadByGroup.set(r.group_id, parseInt(r.count, 10));
    }

    for (const groupRow of groupsResult.rows) {
      const groupId = groupRow.id;
      groups.push({
        groupId,
        groupName: groupRow.name,
        participantCount: participantCountByGroup.get(groupId) ?? 0,
        lastMessage: lastMessageByGroup.get(groupId) ?? null,
        unreadCount: unreadByGroup.get(groupId) ?? 0,
      });
    }
  }

  // Sort: unread count, then last message date
  groups.sort((a, b) => {
    if (a.unreadCount !== b.unreadCount) {
      return b.unreadCount - a.unreadCount;
    }
    if (a.lastMessage && b.lastMessage) {
      return b.lastMessage.createdAt.getTime() - a.lastMessage.createdAt.getTime();
    }
    if (a.lastMessage) return -1;
    if (b.lastMessage) return 1;
    return 0;
  });

  return groups;
}

/**
 * Üzenetek lekérése csoportos beszélgetésből
 * Group chat-eknél tartalmazza az olvasók listáját
 */
export async function getGroupMessages(
  groupId: string,
  userId: string,
  options?: {
    limit?: number;
    offset?: number;
    viewerRole?: string;
  }
): Promise<DoctorMessage[]> {
  const pool = getDbPool();

  // Verify user is a participant
  const participantResult = await pool.query(
    `SELECT user_id FROM doctor_message_group_participants WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId]
  );

  if (participantResult.rows.length === 0) {
    throw new Error('Nincs jogosultsága a csoportos beszélgetés megtekintéséhez');
  }

  let query = `
    SELECT id, sender_id, recipient_id, group_id, sender_email, sender_name, subject, message, read_at, created_at, reply_to_message_id, delivery_status, mentioned_patient_ids
    FROM doctor_messages
    WHERE group_id = $1
    ORDER BY created_at ASC
  `;
  const params: any[] = [groupId];

  if (options?.limit) {
    query += ` LIMIT $${params.length + 1}`;
    params.push(options.limit);
  }

  if (options?.offset) {
    query += ` OFFSET $${params.length + 1}`;
    params.push(options.offset);
  }

  const result = await pool.query(query, params);

  // Lekérjük az olvasókat minden üzenethez (group chat-ekhez)
  const messageIds = result.rows.map((row: any) => row.id);
  const readByMap = new Map<string, Array<{ userId: string; userName: string | null; readAt: Date }>>();
  
  if (messageIds.length > 0) {
    const readsResult = await pool.query(
      `SELECT dmr.message_id, dmr.user_id, dmr.read_at, u.doktor_neve
       FROM doctor_message_reads dmr
       LEFT JOIN users u ON u.id = dmr.user_id
       WHERE dmr.message_id = ANY($1::uuid[])
       ORDER BY dmr.read_at ASC`,
      [messageIds]
    );
    
    for (const readRow of readsResult.rows) {
      if (!readByMap.has(readRow.message_id)) {
        readByMap.set(readRow.message_id, []);
      }
      readByMap.get(readRow.message_id)!.push({
        userId: readRow.user_id,
        userName: readRow.doktor_neve || null,
        readAt: new Date(readRow.read_at),
      });
    }
  }
  
  const mapped = await mapDoctorMessageRows(result.rows, userId, readByMap);
  return enrichDoctorMessagesWithContextLinks(
    mapped,
    userId,
    options?.viewerRole ?? 'fogpótlástanász',
  );
}

/**
 * Csoportos beszélgetés átnevezése
 */
export async function renameDoctorMessageGroup(
  groupId: string,
  newName: string | null,
  userId: string
): Promise<void> {
  const pool = getDbPool();

  // Verify user is a participant
  const participantResult = await pool.query(
    `SELECT user_id FROM doctor_message_group_participants WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId]
  );

  if (participantResult.rows.length === 0) {
    throw new Error('Nincs jogosultsága a csoportos beszélgetés módosításához');
  }

  await pool.query(
    `UPDATE doctor_message_groups SET name = $1 WHERE id = $2`,
    [newName, groupId]
  );
}

/**
 * Csoportos beszélgetés törlése
 * Csak a létrehozó törölheti a csoportot
 */
export async function deleteDoctorMessageGroup(
  groupId: string,
  userId: string
): Promise<void> {
  const pool = getDbPool();

  // Verify user is the creator
  const groupResult = await pool.query(
    `SELECT created_by FROM doctor_message_groups WHERE id = $1`,
    [groupId]
  );

  if (groupResult.rows.length === 0) {
    throw new Error('Csoportos beszélgetés nem található');
  }

  if (groupResult.rows[0].created_by !== userId) {
    throw new Error('Csak a csoport létrehozója törölheti a csoportot');
  }

  // Delete group (CASCADE will delete participants and messages)
  await pool.query(
    `DELETE FROM doctor_message_groups WHERE id = $1`,
    [groupId]
  );
}


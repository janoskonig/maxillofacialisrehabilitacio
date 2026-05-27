import { getDbPool } from './db';
import { extractPatientMentions } from './mention-parser';
import {
  parseReplyToMessageId,
  isDoctorReplyTargetInScope,
  buildQuotedMessagePreview,
  ReplyTargetNotFoundError,
  type DoctorReplyScope,
} from './message-reply';
import type { QuotedMessagePreview } from './types/messaging';

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
  /** 041_message_replies óta: ha válasz, az eredeti doctor_messages.id. */
  replyToMessageId?: string | null;
  /** Szerver által összerakott előnézet az eredeti üzenetről (csak reply-nál). */
  quotedMessage?: QuotedMessagePreview | null;
  readBy?: Array<{ // Új mező: ki olvasta az üzenetet (group chat-ekhez)
    userId: string;
    userName: string | null;
    readAt: Date;
  }>;
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
export async function sendDoctorMessage(input: CreateDoctorMessageInput): Promise<DoctorMessage> {
  const pool = getDbPool();

  // Extract patient mentions from message text
  const mentionedPatientIds = await extractPatientMentions(input.message);

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

  // Üzenet mentése (groupId + reply_to_message_id támogatással)
  const result = await pool.query(
    `INSERT INTO doctor_messages
       (sender_id, recipient_id, sender_email, sender_name, subject, message,
        mentioned_patient_ids, group_id, reply_to_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
  }
): Promise<DoctorMessage[]> {
  const pool = getDbPool();

  let query = `
    SELECT id, sender_id, recipient_id, group_id, sender_email, sender_name, subject, message, read_at, created_at, reply_to_message_id
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

  // Reply preview-k (Szelet 0.2): batch SELECT a parent üzenetekre.
  const parentIds = Array.from(
    new Set(
      result.rows
        .map((row: any) => row.reply_to_message_id)
        .filter((id: any): id is string => typeof id === 'string' && id.length > 0),
    ),
  );
  const quoteMap = await loadDoctorQuotePreviewMap(parentIds);

  return result.rows.map((row: any) => ({
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
    readBy: row.group_id ? (readByMap.get(row.id) || []) : undefined,
  }));
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
       SET read_at = CURRENT_TIMESTAMP 
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

  for (const row of individualResult.rows) {
    const otherDoctorId = row.other_doctor_id;

    // Orvos adatok
    const doctorResult = await pool.query(
      `SELECT id, email, doktor_neve FROM users WHERE id = $1 AND active = true`,
      [otherDoctorId]
    );

    if (doctorResult.rows.length === 0) continue;

    const doctor = doctorResult.rows[0];

    // Utolsó üzenet
    const lastMessageResult = await pool.query(
      `SELECT id, sender_id, recipient_id, group_id, sender_email, sender_name, subject, message, read_at, created_at, reply_to_message_id
       FROM doctor_messages
       WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
       AND group_id IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, otherDoctorId]
    );

    let lastMessage: DoctorMessage | null = null;
    if (lastMessageResult.rows.length > 0) {
      const msgRow = lastMessageResult.rows[0];
      const lastQuoteMap = await loadDoctorQuotePreviewMap(
        msgRow.reply_to_message_id ? [msgRow.reply_to_message_id] : [],
      );
      lastMessage = {
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
      };
    }

    // Olvasatlan üzenetek száma
    const unreadResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM doctor_messages
       WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL AND group_id IS NULL`,
      [userId, otherDoctorId]
    );

    conversations.push({
      doctorId: doctor.id,
      doctorName: doctor.doktor_neve || doctor.email,
      doctorEmail: doctor.email,
      lastMessage,
      unreadCount: parseInt(unreadResult.rows[0].count, 10),
      type: 'individual',
    });
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

  for (const groupRow of groupsResult.rows) {
    const groupId = groupRow.id;

    // Get participant count
    const participantCountResult = await pool.query(
      `SELECT COUNT(*) as count FROM doctor_message_group_participants WHERE group_id = $1`,
      [groupId]
    );
    const participantCount = parseInt(participantCountResult.rows[0].count, 10);

    // Get last message
    const lastMessageResult = await pool.query(
      `SELECT id, sender_id, recipient_id, group_id, sender_email, sender_name, subject, message, read_at, created_at, reply_to_message_id
       FROM doctor_messages
       WHERE group_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [groupId]
    );

    let lastMessage: DoctorMessage | null = null;
    if (lastMessageResult.rows.length > 0) {
      const msgRow = lastMessageResult.rows[0];
      
      // Lekérjük az olvasókat az utolsó üzenethez
      const readsResult = await pool.query(
        `SELECT dmr.user_id, dmr.read_at, u.doktor_neve
         FROM doctor_message_reads dmr
         LEFT JOIN users u ON u.id = dmr.user_id
         WHERE dmr.message_id = $1
         ORDER BY dmr.read_at ASC`,
        [msgRow.id]
      );

      const readBy = readsResult.rows.map((readRow: any) => ({
        userId: readRow.user_id,
        userName: readRow.doktor_neve || null,
        readAt: new Date(readRow.read_at),
      }));

      const lastQuoteMap = await loadDoctorQuotePreviewMap(
        msgRow.reply_to_message_id ? [msgRow.reply_to_message_id] : [],
      );

      lastMessage = {
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
        readBy: readBy,
      };
    }

    // Get unread count (messages in group where user is recipient)
    // For group messages, we consider a message unread if it's not read by the current user
    // We check the doctor_message_reads table to see if the user has read the message
    const unreadResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM doctor_messages dm
       WHERE dm.group_id = $1 
         AND dm.sender_id != $2
         AND NOT EXISTS (
           SELECT 1 
           FROM doctor_message_reads dmr 
           WHERE dmr.message_id = dm.id 
             AND dmr.user_id = $2
         )`,
      [groupId, userId]
    );
    const unreadCount = parseInt(unreadResult.rows[0].count, 10);

    groups.push({
      groupId,
      groupName: groupRow.name,
      participantCount,
      lastMessage,
      unreadCount,
    });
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
    SELECT id, sender_id, recipient_id, group_id, sender_email, sender_name, subject, message, read_at, created_at, reply_to_message_id
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
  
  // Reply preview-k (Szelet 0.2): batch SELECT a parent üzenetekre.
  const parentIds = Array.from(
    new Set(
      result.rows
        .map((row: any) => row.reply_to_message_id)
        .filter((id: any): id is string => typeof id === 'string' && id.length > 0),
    ),
  );
  const quoteMap = await loadDoctorQuotePreviewMap(parentIds);

  const mappedMessages = result.rows.map((row: any) => {
    const readBy = readByMap.get(row.id) || [];
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
      readBy: readBy,
    };
  });
  
  return mappedMessages;
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


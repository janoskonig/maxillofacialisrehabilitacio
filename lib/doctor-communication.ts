import { getDbPool } from './db';
import { extractPatientMentions } from './mention-parser';

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
}

export interface CreateDoctorMessageInput {
  recipientId?: string; // Opcionális egy-egy beszélgetéshez
  senderId: string;
  senderEmail: string;
  senderName?: string | null;
  subject?: string | null;
  message: string;
  groupId?: string; // Opcionális csoportos beszélgetéshez
}

/**
 * Üzenet küldése orvosnak
 */
export async function sendDoctorMessage(input: CreateDoctorMessageInput): Promise<DoctorMessage> {
  const pool = getDbPool();

  // Extract patient mentions from message text
  const mentionedPatientIds = await extractPatientMentions(input.message);

  // Üzenet mentése (groupId támogatással)
  const result = await pool.query(
    `INSERT INTO doctor_messages (sender_id, recipient_id, sender_email, sender_name, subject, message, mentioned_patient_ids, group_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, sender_id, recipient_id, sender_email, sender_name, subject, message, read_at, created_at`,
    [
      input.senderId,
      input.recipientId || null,
      input.senderEmail,
      input.senderName || null,
      input.subject || null,
      input.message,
      JSON.stringify(mentionedPatientIds),
      input.groupId || null,
    ]
  );

  const row = result.rows[0];
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
    mentionedPatientIds: row.mentioned_patient_ids ? JSON.parse(row.mentioned_patient_ids) : [],
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
    SELECT id, sender_id, recipient_id, sender_email, sender_name, subject, message, read_at, created_at
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
  }));
}

/**
 * Üzenet olvasottnak jelölése
 */
export async function markDoctorMessageAsRead(messageId: string, userId: string): Promise<void> {
  const pool = getDbPool();

  // Csak akkor jelölhetjük olvasottnak, ha a felhasználó a címzett
  await pool.query(
    `UPDATE doctor_messages 
     SET read_at = CURRENT_TIMESTAMP 
     WHERE id = $1 AND recipient_id = $2 AND read_at IS NULL`,
    [messageId, userId]
  );
}

/**
 * Olvasatlan üzenetek száma
 */
export async function getUnreadDoctorMessageCount(userId: string): Promise<number> {
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT COUNT(*) as count
     FROM doctor_messages
     WHERE recipient_id = $1 AND read_at IS NULL`,
    [userId]
  );

  return parseInt(result.rows[0].count, 10);
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
      `SELECT id, sender_id, recipient_id, group_id, sender_email, sender_name, subject, message, read_at, created_at
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
      `SELECT id, sender_id, recipient_id, sender_email, sender_name, subject, message, read_at, created_at
       FROM doctor_messages
       WHERE group_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [groupId]
    );

    let lastMessage: DoctorMessage | null = null;
    if (lastMessageResult.rows.length > 0) {
      const msgRow = lastMessageResult.rows[0];
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
      };
    }

    // Get unread count (messages in group where user is recipient)
    // Note: For group messages, we consider a message unread if it's not read by the user
    // This is simplified - in a full implementation, we'd track read status per user per message
    const unreadResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM doctor_messages
       WHERE group_id = $1 AND sender_id != $2 AND read_at IS NULL`,
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
    SELECT id, sender_id, recipient_id, group_id, sender_email, sender_name, subject, message, read_at, created_at
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
  }));
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


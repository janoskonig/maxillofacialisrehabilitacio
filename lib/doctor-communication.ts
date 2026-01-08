import { getDbPool } from './db';

export interface DoctorMessage {
  id: string;
  senderId: string;
  recipientId: string;
  senderEmail: string;
  senderName: string | null;
  subject: string | null;
  message: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface CreateDoctorMessageInput {
  recipientId: string;
  senderId: string;
  senderEmail: string;
  senderName?: string | null;
  subject?: string | null;
  message: string;
}

/**
 * Üzenet küldése orvosnak
 */
export async function sendDoctorMessage(input: CreateDoctorMessageInput): Promise<DoctorMessage> {
  const pool = getDbPool();

  // Üzenet mentése
  const result = await pool.query(
    `INSERT INTO doctor_messages (sender_id, recipient_id, sender_email, sender_name, subject, message)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, sender_id, recipient_id, sender_email, sender_name, subject, message, read_at, created_at`,
    [
      input.senderId,
      input.recipientId,
      input.senderEmail,
      input.senderName || null,
      input.subject || null,
      input.message,
    ]
  );

  const row = result.rows[0];
  const message: DoctorMessage = {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    senderEmail: row.sender_email,
    senderName: row.sender_name,
    subject: row.subject,
    message: row.message,
    readAt: row.read_at ? new Date(row.read_at) : null,
    createdAt: new Date(row.created_at),
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
    recipientId: row.recipient_id,
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
 * Konverzációk listája (minden orvos, akivel van üzenet)
 */
export async function getDoctorConversations(userId: string): Promise<Array<{
  doctorId: string;
  doctorName: string;
  doctorEmail: string;
  lastMessage: DoctorMessage | null;
  unreadCount: number;
}>> {
  const pool = getDbPool();

  // Összes egyedi orvos, akivel van üzenet (küldött vagy fogadott)
  const result = await pool.query(
    `SELECT DISTINCT
       CASE 
         WHEN sender_id = $1 THEN recipient_id
         ELSE sender_id
       END as other_doctor_id
     FROM doctor_messages
     WHERE sender_id = $1 OR recipient_id = $1`,
    [userId]
  );

  const conversations = [];

  for (const row of result.rows) {
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
      `SELECT id, sender_id, recipient_id, sender_email, sender_name, subject, message, read_at, created_at
       FROM doctor_messages
       WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
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
        recipientId: msgRow.recipient_id,
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
       WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL`,
      [userId, otherDoctorId]
    );

    conversations.push({
      doctorId: doctor.id,
      doctorName: doctor.doktor_neve || doctor.email,
      doctorEmail: doctor.email,
      lastMessage,
      unreadCount: parseInt(unreadResult.rows[0].count, 10),
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


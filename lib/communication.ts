import { getDbPool } from './db';
import { logCommunication } from './communication-logs';

export type MessageSenderType = 'doctor' | 'patient';

export interface Message {
  id: string;
  patientId: string;
  senderType: MessageSenderType;
  senderId: string;
  senderEmail: string;
  subject: string | null;
  message: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface CreateMessageInput {
  patientId: string;
  senderType: MessageSenderType;
  senderId: string;
  senderEmail: string;
  subject?: string | null;
  message: string;
}

/**
 * Üzenet küldése betegnek vagy orvosnak
 * Automatikusan naplózza az érintkezést és küld email értesítést
 */
export async function sendMessage(input: CreateMessageInput): Promise<Message> {
  const pool = getDbPool();

  // Üzenet mentése
  const result = await pool.query(
    `INSERT INTO messages (patient_id, sender_type, sender_id, sender_email, subject, message)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, patient_id, sender_type, sender_id, sender_email, subject, message, read_at, created_at`,
    [
      input.patientId,
      input.senderType,
      input.senderId,
      input.senderEmail,
      input.subject || null,
      input.message,
    ]
  );

  const row = result.rows[0];
  const message: Message = {
    id: row.id,
    patientId: row.patient_id,
    senderType: row.sender_type,
    senderId: row.sender_id,
    senderEmail: row.sender_email,
    subject: row.subject,
    message: row.message,
    readAt: row.read_at ? new Date(row.read_at) : null,
    createdAt: new Date(row.created_at),
  };

  // Érintkezési napló létrehozása
  const direction = input.senderType === 'doctor' ? 'doctor_to_patient' : 'patient_to_doctor';
  
  // Ha orvos küldi, meg kell találni a doctor_id-t
  let doctorId: string | null = null;
  if (input.senderType === 'doctor') {
    const userResult = await pool.query('SELECT id FROM users WHERE id = $1', [input.senderId]);
    if (userResult.rows.length > 0) {
      doctorId = userResult.rows[0].id;
    }
  } else {
    // Ha beteg küldi, meg kell találni a kezelőorvosát
    const patientResult = await pool.query(
      `SELECT kezeleoorvos FROM patients WHERE id = $1`,
      [input.patientId]
    );
    if (patientResult.rows.length > 0 && patientResult.rows[0].kezeleoorvos) {
      // Megkeressük az orvos user ID-ját email alapján
      const doctorEmailResult = await pool.query(
        `SELECT id FROM users WHERE email = $1 OR doktor_neve = $2 LIMIT 1`,
        [patientResult.rows[0].kezeleoorvos, patientResult.rows[0].kezeleoorvos]
      );
      if (doctorEmailResult.rows.length > 0) {
        doctorId = doctorEmailResult.rows[0].id;
      }
    }
  }

  await logCommunication({
    patientId: input.patientId,
    doctorId: doctorId,
    communicationType: 'message',
    direction,
    subject: input.subject || null,
    content: input.message,
    createdBy: input.senderEmail,
  });

  return message;
}

/**
 * Beteg üzeneteinek lekérése
 */
export async function getPatientMessages(
  patientId: string,
  options?: {
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
  }
): Promise<Message[]> {
  const pool = getDbPool();

  let query = `
    SELECT id, patient_id, sender_type, sender_id, sender_email, subject, message, read_at, created_at
    FROM messages
    WHERE patient_id = $1
  `;
  const params: any[] = [patientId];

  if (options?.unreadOnly) {
    query += ' AND read_at IS NULL';
  }

  query += ' ORDER BY created_at DESC';

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
    patientId: row.patient_id,
    senderType: row.sender_type,
    senderId: row.sender_id,
    senderEmail: row.sender_email,
    subject: row.subject,
    message: row.message,
    readAt: row.read_at ? new Date(row.read_at) : null,
    createdAt: new Date(row.created_at),
  }));
}

/**
 * Üzenet olvasottnak jelölése
 */
export async function markMessageAsRead(messageId: string): Promise<void> {
  const pool = getDbPool();

  await pool.query(
    `UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE id = $1 AND read_at IS NULL`,
    [messageId]
  );
}

/**
 * Olvasatlan üzenetek száma beteghez
 */
export async function getUnreadMessageCount(patientId: string, recipientType: MessageSenderType): Promise<number> {
  const pool = getDbPool();

  // Ha orvos kérdezi, akkor csak a betegtől érkező olvasatlan üzeneteket számoljuk
  // Ha beteg kérdezi, akkor csak az orvostól érkező olvasatlan üzeneteket számoljuk
  const senderType = recipientType === 'doctor' ? 'patient' : 'doctor';

  const result = await pool.query(
    `SELECT COUNT(*) as count
     FROM messages
     WHERE patient_id = $1 AND sender_type = $2 AND read_at IS NULL`,
    [patientId, senderType]
  );

  return parseInt(result.rows[0].count, 10);
}

/**
 * Beteg adatainak lekérése email értesítéshez
 */
export async function getPatientForNotification(patientId: string): Promise<{
  id: string;
  email: string | null;
  nev: string | null;
  nem: string | null;
} | null> {
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT id, email, nev, nem FROM patients WHERE id = $1`,
    [patientId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return {
    id: result.rows[0].id,
    email: result.rows[0].email,
    nev: result.rows[0].nev,
    nem: result.rows[0].nem,
  };
}

/**
 * Orvos adatainak lekérése email értesítéshez (beteg üzenet esetén)
 */
export async function getDoctorForNotification(patientId: string): Promise<{
  email: string;
  name: string;
} | null> {
  const pool = getDbPool();

  // Először megkeressük a beteg kezelőorvosát
  const patientResult = await pool.query(
    `SELECT kezeleoorvos FROM patients WHERE id = $1`,
    [patientId]
  );

  if (patientResult.rows.length === 0) {
    console.warn(`[getDoctorForNotification] Beteg nem található: ${patientId}`);
    return null;
  }

  const kezeleoorvos = patientResult.rows[0].kezeleoorvos;

  if (!kezeleoorvos) {
    console.warn(`[getDoctorForNotification] Betegnek nincs kezelőorvosa: ${patientId}`);
    return null;
  }

  // Megkeressük az orvos email címét
  const doctorResult = await pool.query(
    `SELECT email, doktor_neve FROM users WHERE email = $1 OR doktor_neve = $2 LIMIT 1`,
    [kezeleoorvos, kezeleoorvos]
  );

  if (doctorResult.rows.length === 0) {
    console.warn(`[getDoctorForNotification] Orvos nem található a users táblában: ${kezeleoorvos}`);
    return null;
  }

  return {
    email: doctorResult.rows[0].email,
    name: doctorResult.rows[0].doktor_neve || kezeleoorvos,
  };
}


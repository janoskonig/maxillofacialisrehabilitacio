import { getDbPool } from './db';
import { logCommunication } from './communication-logs';
import { validateUUID, validateMessageText, validateSubject } from './validation';

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
  recipientDoctorId?: string | null; // Opcionális: ha beteg küldi, megadhatja, melyik orvosnak küldi (kezelőorvos vagy admin)
}

/**
 * Üzenet küldése betegnek vagy orvosnak
 * Automatikusan naplózza az érintkezést és küld email értesítést
 */
export async function sendMessage(input: CreateMessageInput): Promise<Message> {
  const pool = getDbPool();

  // Validáció
  const validatedPatientId = validateUUID(input.patientId, 'Beteg ID');
  const validatedSenderId = validateUUID(input.senderId, 'Küldő ID');
  const validatedMessage = validateMessageText(input.message);
  const validatedSubject = validateSubject(input.subject);
  
  if (input.recipientDoctorId) {
    validateUUID(input.recipientDoctorId, 'Címzett orvos ID');
  }

  // Üzenet mentése
  const result = await pool.query(
    `INSERT INTO messages (patient_id, sender_type, sender_id, sender_email, subject, message, recipient_doctor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, patient_id, sender_type, sender_id, sender_email, subject, message, read_at, created_at, recipient_doctor_id`,
    [
      validatedPatientId,
      input.senderType,
      validatedSenderId,
      input.senderEmail,
      validatedSubject,
      validatedMessage,
      input.recipientDoctorId || null,
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
    // Ha beteg küldi, meg kell találni a címzett orvos ID-ját
    // Ha van recipientDoctorId, azt használjuk, különben a kezelőorvosát
    if (input.recipientDoctorId) {
      doctorId = input.recipientDoctorId;
    } else {
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
 * @param patientId - Beteg ID-ja
 * @param options - Opciók: unreadOnly, limit, offset, doctorId (ha orvos kéri, csak az ő üzeneteit mutatja), isAdmin (ha admin, minden üzenetet lát)
 */
export async function getPatientMessages(
  patientId: string,
  options?: {
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
    doctorId?: string | null; // Ha meg van adva, csak az adott orvosnak küldött üzeneteket mutatja (betegtől érkező üzeneteknél)
    isAdmin?: boolean; // Ha true, admin minden üzenetet lát (nem szűrünk recipient_doctor_id alapján)
  }
): Promise<Message[]> {
  const pool = getDbPool();
  
  // Validáció
  const validatedPatientId = validateUUID(patientId, 'Beteg ID');
  if (options?.doctorId) {
    validateUUID(options.doctorId, 'Orvos ID');
  }

  // Ha orvos kéri az üzeneteket, először ellenőrizzük, hogy a kezelőorvos-e
  let isTreatingDoctor = false;
  if (options?.doctorId && !options?.isAdmin) {
    const patientResult = await pool.query(
      `SELECT kezeleoorvos FROM patients WHERE id = $1`,
      [validatedPatientId]
    );
    
    if (patientResult.rows.length > 0) {
      const kezeleoorvos = patientResult.rows[0].kezeleoorvos;
      if (kezeleoorvos) {
        // Ellenőrizzük, hogy az orvos a kezelőorvos-e
        const doctorResult = await pool.query(
          `SELECT id FROM users WHERE id = $1 AND (email = $2 OR doktor_neve = $2)`,
          [options.doctorId, kezeleoorvos]
        );
        isTreatingDoctor = doctorResult.rows.length > 0;
      }
    }
  }

  let query = `
    SELECT m.id, m.patient_id, m.sender_type, m.sender_id, m.sender_email, m.subject, m.message, m.read_at, m.created_at, m.recipient_doctor_id
    FROM messages m
    WHERE m.patient_id = $1
  `;
  const params: any[] = [validatedPatientId];

  // Ha orvos kéri az üzeneteket (doctorId meg van adva), akkor csak az ő üzeneteit mutatjuk
  // Ez azt jelenti:
  // - Ha beteg küldi (sender_type = 'patient'), akkor csak akkor mutatjuk, ha:
  //   * recipient_doctor_id = doctorId VAGY
  //   * (recipient_doctor_id IS NULL ÉS az orvos a kezelőorvos)
  // - Ha orvos küldi (sender_type = 'doctor'), akkor csak akkor mutatjuk, ha sender_id = doctorId
  if (options?.doctorId && !options?.isAdmin) {
    if (isTreatingDoctor) {
      // Ha a kezelőorvos, akkor látja a recipient_doctor_id IS NULL üzeneteket is
      query += ` AND (
        (m.sender_type = 'patient' AND (m.recipient_doctor_id = $${params.length + 1} OR m.recipient_doctor_id IS NULL))
        OR (m.sender_type = 'doctor' AND m.sender_id = $${params.length + 1})
      )`;
    } else {
      // Ha nem a kezelőorvos, akkor csak az explicit neki küldött üzeneteket látja
      query += ` AND (
        (m.sender_type = 'patient' AND m.recipient_doctor_id = $${params.length + 1})
        OR (m.sender_type = 'doctor' AND m.sender_id = $${params.length + 1})
      )`;
    }
    params.push(options.doctorId);
  }

  if (options?.unreadOnly) {
    query += ' AND m.read_at IS NULL';
  }

  query += ' ORDER BY m.created_at DESC';

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
  
  // Validáció
  const validatedMessageId = validateUUID(messageId, 'Üzenet ID');

  const result = await pool.query(
    `UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE id = $1 AND read_at IS NULL RETURNING id`,
    [validatedMessageId]
  );
  
  if (result.rows.length === 0) {
    console.warn(`[markMessageAsRead] Üzenet ${validatedMessageId} nem található vagy már olvasottnak jelölve`);
  } else {
    console.log(`[markMessageAsRead] Üzenet ${validatedMessageId} sikeresen olvasottnak jelölve`);
  }
}

/**
 * Olvasatlan üzenetek száma beteghez
 */
export async function getUnreadMessageCount(patientId: string, recipientType: MessageSenderType): Promise<number> {
  const pool = getDbPool();
  
  // Validáció
  const validatedPatientId = validateUUID(patientId, 'Beteg ID');

  // Ha orvos kérdezi, akkor csak a betegtől érkező olvasatlan üzeneteket számoljuk
  // Ha beteg kérdezi, akkor csak az orvostól érkező olvasatlan üzeneteket számoljuk
  const senderType = recipientType === 'doctor' ? 'patient' : 'doctor';

  const result = await pool.query(
    `SELECT COUNT(*) as count
     FROM messages
     WHERE patient_id = $1 AND sender_type = $2 AND read_at IS NULL`,
    [validatedPatientId, senderType]
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
  
  // Validáció
  const validatedPatientId = validateUUID(patientId, 'Beteg ID');

  const result = await pool.query(
    `SELECT id, email, nev, nem FROM patients WHERE id = $1`,
    [validatedPatientId]
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
  
  // Validáció
  const validatedPatientId = validateUUID(patientId, 'Beteg ID');

  // Először megkeressük a beteg kezelőorvosát
  const patientResult = await pool.query(
    `SELECT kezeleoorvos FROM patients WHERE id = $1`,
    [validatedPatientId]
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


import { getDbPool } from './db';
import { logCommunication } from './communication-logs';
import { validateUUID, validateMessageText, validateSubject } from './validation';
import { hasEverTreatedPatient } from './patient-doctor-access';
import {
  parseReplyToMessageId,
  canPatientReplySenderSeeTarget,
  buildQuotedMessagePreview,
  ReplyTargetNotFoundError,
  type PatientReplySender,
} from './message-reply';
import type { QuotedMessagePreview } from './types/messaging';

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
  /** 041_message_replies óta: ha válasz, a hivatkozott parent messages.id. */
  replyToMessageId?: string | null;
  /** Szerver-oldalon összeállított preview a parent-ről (csak reply-nál). */
  quotedMessage?: QuotedMessagePreview | null;
}

export interface CreateMessageInput {
  patientId: string;
  senderType: MessageSenderType;
  senderId: string;
  senderEmail: string;
  subject?: string | null;
  message: string;
  recipientDoctorId?: string | null; // Opcionális: ha beteg küldi, megadhatja, melyik orvosnak küldi (kezelőorvos vagy admin)
  /**
   * Reply target üzenet ID-ja ugyanennek a betegnek a szálában. Ha megadva,
   * a backend ellenőrzi (lane-tudatos visibility), hogy a sender egyáltalán
   * látná-e ezt az üzenetet GET-en. Ha nem → `ReplyTargetNotFoundError` (404).
   */
  replyToMessageId?: string | null;
  /**
   * Sender kontextus a reply visibility ellenőrzéshez. A route adja, nem a
   * kliens — a `lib` réteg nem dönt admin/treating jogosultságról saját erőből.
   * Csak akkor szükséges, ha `replyToMessageId` van.
   */
  replySender?: PatientReplySender;
  /**
   * Slice 0.8: kliens-oldali idempotencia kulcs. `(sender_id, client_message_id)`
   * UNIQUE; ha már létezik, a meglévő sort adjuk vissza (idempotens).
   */
  clientMessageId?: string | null;
}

/**
 * Belső helper: validálja és betölti a reply target üzenetet a beteg
 * csatornán, GET-szabályoknak megfelelő láthatóság-ellenőrzéssel.
 */
async function loadPatientReplyTargetForSender(
  replyToMessageId: string,
  sender: PatientReplySender,
  patientId: string,
): Promise<QuotedMessagePreview> {
  const pool = getDbPool();

  // Sender név preferencia: orvosnál `doktor_neve`, betegnél `patients.nev`.
  // LEFT JOIN-ok mindkét irányban, hogy egy query-vel elinduljunk.
  const targetResult = await pool.query(
    `SELECT m.id, m.patient_id, m.sender_type, m.sender_id, m.recipient_doctor_id,
            m.message, m.created_at,
            u.doktor_neve AS doctor_name,
            p.nev          AS patient_name
       FROM messages m
       LEFT JOIN users    u ON m.sender_type = 'doctor'  AND u.id = m.sender_id
       LEFT JOIN patients p ON m.sender_type = 'patient' AND p.id = m.sender_id
      WHERE m.id = $1`,
    [replyToMessageId],
  );

  if (targetResult.rows.length === 0) {
    throw new ReplyTargetNotFoundError();
  }

  const row = targetResult.rows[0];
  const allowed = canPatientReplySenderSeeTarget(
    {
      patientId: row.patient_id,
      senderType: row.sender_type,
      senderId: row.sender_id,
      recipientDoctorId: row.recipient_doctor_id ?? null,
    },
    sender,
    patientId,
  );
  if (!allowed) {
    // Ugyanaz a hibatípus, mint a "nem létezik" eset — más lane-ek
    // létezésének leakelése kerülendő.
    throw new ReplyTargetNotFoundError();
  }

  const senderName: string | null =
    row.sender_type === 'doctor' ? row.doctor_name ?? null : row.patient_name ?? null;

  return buildQuotedMessagePreview({
    id: row.id,
    channel: 'patient',
    senderId: row.sender_id,
    senderName,
    message: row.message,
    createdAt: row.created_at,
  });
}

/**
 * Belső helper: tömegesen betölti a quoted preview-kat egy ID-listához,
 * ugyanarra a `patient_id`-ra szűrve (belt-and-braces a POST-gate mellett).
 */
async function loadPatientQuotePreviewMap(
  ids: string[],
  patientId: string,
): Promise<Map<string, QuotedMessagePreview>> {
  const map = new Map<string, QuotedMessagePreview>();
  if (ids.length === 0) return map;

  const pool = getDbPool();
  const result = await pool.query(
    `SELECT m.id, m.sender_type, m.sender_id, m.message, m.created_at,
            u.doktor_neve AS doctor_name,
            p.nev          AS patient_name
       FROM messages m
       LEFT JOIN users    u ON m.sender_type = 'doctor'  AND u.id = m.sender_id
       LEFT JOIN patients p ON m.sender_type = 'patient' AND p.id = m.sender_id
      WHERE m.id = ANY($1::uuid[])
        AND m.patient_id = $2`,
    [ids, patientId],
  );

  for (const row of result.rows) {
    const senderName: string | null =
      row.sender_type === 'doctor' ? row.doctor_name ?? null : row.patient_name ?? null;
    map.set(
      row.id,
      buildQuotedMessagePreview({
        id: row.id,
        channel: 'patient',
        senderId: row.sender_id,
        senderName,
        message: row.message,
        createdAt: row.created_at,
      }),
    );
  }
  return map;
}

/**
 * Üzenet küldése betegnek vagy orvosnak
 * Automatikusan naplózza az érintkezést és küld email értesítést.
 *
 * Reply támogatás (Szelet 0.3):
 *  - `replyToMessageId` opcionális UUID; ha érvénytelen → 400 (parser dob).
 *  - Ha a sender (route által adott `replySender`) nem látná GET-en a parent
 *    üzenetet → `ReplyTargetNotFoundError` (HTTP 404, lane info nem leakelve).
 *  - Sikeres válasznál a visszakapott `Message`-be belekerül a
 *    `quotedMessage` preview is, hogy a kliens egy roundtripben rendezhesse.
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

  // Reply target normalizálás + visibility-tudatos scope check (Szelet 0.3).
  const normalizedReplyToId = parseReplyToMessageId(input.replyToMessageId);
  let quotedMessage: QuotedMessagePreview | null = null;
  if (normalizedReplyToId) {
    if (!input.replySender) {
      // Belső konzisztencia: a route mindig adjon küldő kontextust.
      throw new ReplyTargetNotFoundError();
    }
    quotedMessage = await loadPatientReplyTargetForSender(
      normalizedReplyToId,
      input.replySender,
      validatedPatientId,
    );
  }

  // Slice 0.8: idempotencia — ha (sender_id, client_message_id) él, vissza.
  const normalizedClientMessageId =
    typeof input.clientMessageId === 'string' && input.clientMessageId.trim().length > 0
      ? input.clientMessageId.trim()
      : null;

  if (normalizedClientMessageId) {
    const existing = await pool.query(
      `SELECT id, patient_id, sender_type, sender_id, sender_email, subject, message,
              read_at, created_at, recipient_doctor_id, reply_to_message_id
         FROM messages
        WHERE sender_id = $1 AND client_message_id = $2
        LIMIT 1`,
      [validatedSenderId, normalizedClientMessageId],
    );
    if (existing.rows.length > 0) {
      const r = existing.rows[0];
      return {
        id: r.id,
        patientId: r.patient_id,
        senderType: r.sender_type,
        senderId: r.sender_id,
        senderEmail: r.sender_email,
        subject: r.subject,
        message: r.message,
        readAt: r.read_at ? new Date(r.read_at) : null,
        createdAt: new Date(r.created_at),
        replyToMessageId: r.reply_to_message_id ?? null,
        quotedMessage,
      };
    }
  }

  // Üzenet mentése
  const result = await pool.query(
    `INSERT INTO messages
       (patient_id, sender_type, sender_id, sender_email, subject, message,
        recipient_doctor_id, reply_to_message_id, client_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, patient_id, sender_type, sender_id, sender_email, subject, message,
               read_at, created_at, recipient_doctor_id, reply_to_message_id`,
    [
      validatedPatientId,
      input.senderType,
      validatedSenderId,
      input.senderEmail,
      validatedSubject,
      validatedMessage,
      input.recipientDoctorId || null,
      normalizedReplyToId,
      normalizedClientMessageId,
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
    replyToMessageId: row.reply_to_message_id ?? null,
    quotedMessage,
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
    doctorId?: string | null;
    isAdmin?: boolean;
    isPatientPortal?: boolean;
  }
): Promise<Message[]> {
  const pool = getDbPool();
  
  // Validáció
  const validatedPatientId = validateUUID(patientId, 'Beteg ID');
  if (options?.doctorId) {
    validateUUID(options.doctorId, 'Orvos ID');
  }

  // A `recipient_doctor_id IS NULL` (legacy, recipient nélküli) üzenetek
  // azok az orvosok láthatóságát határozza meg, akik valaha kezelték a
  // beteget. A 027-es migráció döntése szerint a régi kezelőorvosok is
  // láthatják a saját korszakuk üzeneteit (lásd lib/patient-doctor-access.ts).
  let isTreatingDoctor = false;
  if (options?.doctorId && !options?.isAdmin) {
    isTreatingDoctor = await hasEverTreatedPatient(options.doctorId, validatedPatientId);
  }

  let query = `
    SELECT m.id, m.patient_id, m.sender_type, m.sender_id, m.sender_email, m.subject, m.message, m.read_at, m.created_at, m.recipient_doctor_id, m.reply_to_message_id
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
    if (options?.isPatientPortal) {
      query += ` AND (
        (m.sender_type = 'patient' AND m.recipient_doctor_id = $${params.length + 1})
        OR (m.sender_type = 'doctor' AND m.sender_id = $${params.length + 1})
      )`;
    } else if (isTreatingDoctor) {
      query += ` AND (
        (m.sender_type = 'patient' AND (m.recipient_doctor_id = $${params.length + 1} OR m.recipient_doctor_id IS NULL))
        OR (m.sender_type = 'doctor' AND m.sender_id = $${params.length + 1})
      )`;
    } else {
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

  // Reply preview-k (Szelet 0.3): batch SELECT a parent üzenetekre,
  // ugyanarra a patient_id-ra szűrve.
  const parentIds = Array.from(
    new Set(
      result.rows
        .map((row: any) => row.reply_to_message_id)
        .filter((id: any): id is string => typeof id === 'string' && id.length > 0),
    ),
  );
  const quoteMap = await loadPatientQuotePreviewMap(parentIds, validatedPatientId);

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
    replyToMessageId: row.reply_to_message_id ?? null,
    quotedMessage: row.reply_to_message_id
      ? quoteMap.get(row.reply_to_message_id) ?? null
      : null,
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

  // 027 óta a `kezeleoorvos_user_id` az SSoT — közvetlenül feloldjuk JOIN-nal.
  // Backward-compat: ha a backfill előtti betegnél még csak a régi VARCHAR
  // mező van kitöltve, akkor email/név alapján próbálkozunk (mint régen).
  const directResult = await pool.query(
    `SELECT u.email, u.doktor_neve, p.kezeleoorvos
       FROM patients p
       LEFT JOIN users u ON u.id = p.kezeleoorvos_user_id
      WHERE p.id = $1`,
    [validatedPatientId]
  );

  if (directResult.rows.length === 0) {
    console.warn(`[getDoctorForNotification] Beteg nem található: ${patientId}`);
    return null;
  }

  const row = directResult.rows[0];
  if (row.email) {
    return { email: row.email, name: row.doktor_neve || row.email };
  }

  // Fallback: VARCHAR alapú illesztés (legacy)
  if (!row.kezeleoorvos) {
    console.warn(`[getDoctorForNotification] Betegnek nincs kezelőorvosa: ${patientId}`);
    return null;
  }
  const fallbackResult = await pool.query(
    `SELECT email, doktor_neve FROM users WHERE email = $1 OR doktor_neve = $2 LIMIT 1`,
    [row.kezeleoorvos, row.kezeleoorvos]
  );
  if (fallbackResult.rows.length === 0) {
    console.warn(`[getDoctorForNotification] Orvos nem található a users táblában: ${row.kezeleoorvos}`);
    return null;
  }
  return {
    email: fallbackResult.rows[0].email,
    name: fallbackResult.rows[0].doktor_neve || row.kezeleoorvos,
  };
}


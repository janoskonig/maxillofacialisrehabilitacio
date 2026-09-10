/**
 * Orvos–orvos chat képmellékletek (beteghez NEM rendelt képek) — DB réteg.
 *
 * Tábla: doctor_message_attachments (099 migráció). A fájl az FTP
 * `_chat-attachments` mappájában van (lásd lib/ftp-client uploadChatAttachment).
 * Az üzenet a `[CHAT_IMAGE:<id>]` markert hordozza (lib/messaging/chat-image-marker).
 */

import { getDbPool } from '@/lib/db';
import { extractChatImageAttachmentIds } from './chat-image-marker';

export interface DoctorMessageAttachment {
  id: string;
  uploadedBy: string;
  messageId: string | null;
  filename: string;
  filePath: string;
  fileSize: number;
  mimeType: string | null;
  createdAt: Date;
}

interface AttachmentRow {
  id: string;
  uploaded_by: string;
  message_id: string | null;
  filename: string;
  file_path: string;
  file_size: string | number;
  mime_type: string | null;
  created_at: string | Date;
}

interface AttachmentWithMessageRow extends AttachmentRow {
  sender_id: string | null;
  recipient_id: string | null;
  group_id: string | null;
}

function rowToAttachment(row: AttachmentRow): DoctorMessageAttachment {
  return {
    id: row.id,
    uploadedBy: row.uploaded_by,
    messageId: row.message_id ?? null,
    filename: row.filename,
    filePath: row.file_path,
    fileSize: typeof row.file_size === 'string' ? parseInt(row.file_size, 10) : row.file_size,
    mimeType: row.mime_type ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  };
}

/** Publikus (kliensnek adható) alak — file_path nélkül. */
export function toPublicAttachment(att: DoctorMessageAttachment) {
  return {
    id: att.id,
    uploadedBy: att.uploadedBy,
    messageId: att.messageId,
    filename: att.filename,
    fileSize: att.fileSize,
    mimeType: att.mimeType,
    createdAt: att.createdAt,
  };
}

export async function insertDoctorMessageAttachment(input: {
  uploadedBy: string;
  filename: string;
  filePath: string;
  fileSize: number;
  mimeType: string | null;
}): Promise<DoctorMessageAttachment> {
  const pool = getDbPool();
  const r = await pool.query(
    `INSERT INTO doctor_message_attachments
       (uploaded_by, filename, file_path, file_size, mime_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, uploaded_by, message_id, filename, file_path, file_size, mime_type, created_at`,
    [input.uploadedBy, input.filename, input.filePath, input.fileSize, input.mimeType],
  );
  return rowToAttachment(r.rows[0] as AttachmentRow);
}

/**
 * Az üzenet szövegében szereplő `[CHAT_IMAGE:<id>]` markereket a most
 * beszúrt doctor_messages sorhoz köti. Csak a küldő saját, még kötetlen
 * mellékleteit — így más nem „lophatja el” a feltöltést egy idegen id-vel.
 * Hiba esetén nem dob (az üzenet már elment), csak naplóz.
 */
export async function bindChatImageAttachmentsToMessage(params: {
  messageId: string;
  senderId: string;
  messageText: string;
}): Promise<void> {
  const ids = extractChatImageAttachmentIds(params.messageText);
  if (ids.length === 0) return;
  try {
    const pool = getDbPool();
    await pool.query(
      `UPDATE doctor_message_attachments
          SET message_id = $1
        WHERE id = ANY($2::uuid[])
          AND uploaded_by = $3
          AND message_id IS NULL`,
      [params.messageId, ids, params.senderId],
    );
  } catch (err) {
    console.error('[bindChatImageAttachmentsToMessage]', err);
  }
}

export interface AttachmentViewer {
  userId: string;
  role: string;
}

/**
 * Melléklet betöltése jogosultság-ellenőrzéssel. Láthatja:
 *  - a feltöltő,
 *  - admin,
 *  - az üzenet küldője / címzettje (1:1), vagy a csoport tagja (csoport).
 * Egyébként `null` (a hívó 404-et ad, hogy az id létezése se szivárogjon).
 */
export async function getDoctorMessageAttachmentForViewer(
  attachmentId: string,
  viewer: AttachmentViewer,
): Promise<DoctorMessageAttachment | null> {
  const pool = getDbPool();
  const r = await pool.query(
    `SELECT a.id, a.uploaded_by, a.message_id, a.filename, a.file_path, a.file_size,
            a.mime_type, a.created_at,
            dm.sender_id, dm.recipient_id, dm.group_id
       FROM doctor_message_attachments a
       LEFT JOIN doctor_messages dm ON dm.id = a.message_id
      WHERE a.id = $1`,
    [attachmentId],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0] as AttachmentWithMessageRow;
  const attachment = rowToAttachment(row);

  if (row.uploaded_by === viewer.userId) return attachment;
  if (viewer.role === 'admin') return attachment;
  if (!row.message_id) return null;

  if (row.group_id) {
    const p = await pool.query(
      `SELECT 1 FROM doctor_message_group_participants WHERE group_id = $1 AND user_id = $2`,
      [row.group_id, viewer.userId],
    );
    return p.rows.length > 0 ? attachment : null;
  }

  if (row.sender_id === viewer.userId || row.recipient_id === viewer.userId) {
    return attachment;
  }
  return null;
}

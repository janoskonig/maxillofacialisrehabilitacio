/**
 * Chatben küldött képek markerei.
 *
 * Két eset van:
 *
 *  1. A kép beteg-dokumentumként kerül mentésre (`patient_documents`, címke:
 *     `chat`). Ilyenkor a meglévő dokumentum-link markert használjuk
 *     (`[DOCUMENT_UPLOADED:chat:patientId:documentId]`, lásd
 *     `document-link-marker.ts`), így a kép a beteg dokumentumai közt is
 *     megjelenik, és a strukturált context-link is létrejön.
 *
 *  2. Orvos–orvos chatben a küldő NEM rendeli beteghez a képet. Ilyenkor a
 *     fájl a `doctor_message_attachments` táblába (+ FTP `_chat-attachments`
 *     mappa) kerül, és az üzenet ezt a markert hordozza:
 *
 *        [CHAT_IMAGE:<attachmentId>]
 */

import { isUuid } from './document-link-marker';

/** A chatből mentett beteg-dokumentumok címkéje. */
export const CHAT_IMAGE_DOCUMENT_TAG = 'chat';

const MARKER_PREFIX = '[CHAT_IMAGE:';
const MARKER_SUFFIX = ']';

const CHAT_IMAGE_MARKER_GLOBAL_RE = /\[CHAT_IMAGE:([^\]]*)\]/gi;

export interface ParsedChatImageMarker {
  attachmentId: string;
  /** A marker kezdő indexe a szövegben. */
  start: number;
  /** A marker utáni első index (exkluzív vég). */
  end: number;
}

export function buildChatImageMarker(attachmentId: string): string {
  return `${MARKER_PREFIX}${attachmentId}${MARKER_SUFFIX}`;
}

/** Az első érvényes `[CHAT_IMAGE:<uuid>]` marker a szövegben (ha van). */
export function parseChatImageMarker(text: string): ParsedChatImageMarker | null {
  if (!text) return null;
  const re = new RegExp(CHAT_IMAGE_MARKER_GLOBAL_RE.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const attachmentId = (match[1] ?? '').trim();
    if (isUuid(attachmentId)) {
      return { attachmentId, start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

/** Minden érvényes marker attachment-azonosítója (duplikátum nélkül, sorrendben). */
export function extractChatImageAttachmentIds(text: string): string[] {
  if (!text) return [];
  const ids: string[] = [];
  const re = new RegExp(CHAT_IMAGE_MARKER_GLOBAL_RE.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const id = (match[1] ?? '').trim().toLowerCase();
    if (isUuid(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

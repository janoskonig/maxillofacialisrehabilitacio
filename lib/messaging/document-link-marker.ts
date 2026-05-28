/**
 * Chat üzenetekben használt dokumentum-link marker.
 * Formátum: [DOCUMENT_UPLOADED:tag:patientId:documentId]
 * Beteg–orvos csatornán a patientId üres: [DOCUMENT_UPLOADED:tag::documentId]
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MARKER_PREFIX = '[DOCUMENT_UPLOADED:';
const MARKER_SUFFIX = ']';

export type DocumentLinkChatType =
  | 'patient-doctor'
  | 'doctor-doctor'
  | 'doctor-view-patient';

export interface ParsedDocumentLink {
  tag: string;
  patientId: string | null;
  documentId: string;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Egy üzenetszövegből kinyeri a dokumentum-link markert (ha van). */
export function parseDocumentLinkMarker(text: string): ParsedDocumentLink | null {
  const trimmed = (text || '').trim();
  const start = trimmed.indexOf(MARKER_PREFIX);
  if (start === -1) return null;

  const end = trimmed.indexOf(MARKER_SUFFIX, start);
  if (end === -1) return null;

  const inner = trimmed.slice(start + MARKER_PREFIX.length, end);
  const parts = inner.split(':');
  if (parts.length < 2) return null;

  const documentId = parts[parts.length - 1]?.trim() ?? '';
  if (!isUuid(documentId)) return null;

  if (parts.length >= 3) {
    const tag = parts[0] ?? '';
    const patientIdRaw = parts[parts.length - 2]?.trim() ?? '';
    const patientId = patientIdRaw && isUuid(patientIdRaw) ? patientIdRaw : null;
    return { tag, patientId, documentId };
  }

  const tag = parts[0] ?? '';
  return { tag, patientId: null, documentId };
}

export function buildDocumentLinkMarker(params: {
  tag?: string;
  patientId: string;
  documentId: string;
  chatType: DocumentLinkChatType;
}): string {
  const tag = params.tag ?? '';
  if (params.chatType === 'doctor-doctor') {
    return `${MARKER_PREFIX}${tag}:${params.patientId}:${params.documentId}${MARKER_SUFFIX}`;
  }
  return `${MARKER_PREFIX}${tag}::${params.documentId}${MARKER_SUFFIX}`;
}

/** Beszúrja a markert a szövegbe (új sor, ha már van tartalom). */
export function insertDocumentLinkIntoMessage(
  currentText: string,
  marker: string,
): string {
  const trimmed = currentText.trimEnd();
  if (!trimmed) return marker;
  return `${trimmed}\n${marker}`;
}

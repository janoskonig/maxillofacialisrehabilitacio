import { parseDocumentLinkMarker } from './document-link-marker';
import type { MessageContextLink } from '@/lib/types/messaging';

/** Ha van strukturált dokumentum-link, a szöveges marker ne jelenjen meg duplán. */
export function stripDocumentMarkerIfContextLinked(
  text: string,
  contextLinks?: MessageContextLink[] | null,
): string {
  if (!contextLinks?.some((l) => l.entityType === 'document')) return text;
  const parsed = parseDocumentLinkMarker(text);
  if (!parsed) return text;
  const linked = contextLinks.some(
    (l) => l.entityType === 'document' && l.entityId === parsed.documentId,
  );
  if (!linked) return text;
  const markerStart = text.indexOf('[DOCUMENT_UPLOADED:');
  if (markerStart === -1) return text;
  const markerEnd = text.indexOf(']', markerStart);
  if (markerEnd === -1) return text;
  const before = text.slice(0, markerStart).trimEnd();
  const after = text.slice(markerEnd + 1).trimStart();
  if (!before && !after) return '';
  if (!before) return after;
  if (!after) return before;
  return `${before}\n${after}`;
}

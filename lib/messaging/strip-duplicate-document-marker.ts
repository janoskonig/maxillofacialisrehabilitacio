import { parseDocumentLinkMarker } from './document-link-marker';
import type { MessageContextLink } from '@/lib/types/messaging';

export function isImageMimeType(mimeType: string | null | undefined): boolean {
  return typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('image/');
}

function findLinkedDocument(
  text: string,
  contextLinks?: MessageContextLink[] | null,
): { link: MessageContextLink; documentId: string } | null {
  if (!contextLinks?.some((l) => l.entityType === 'document')) return null;
  const parsed = parseDocumentLinkMarker(text);
  if (!parsed) return null;
  const link = contextLinks.find(
    (l) => l.entityType === 'document' && l.entityId === parsed.documentId,
  );
  return link ? { link, documentId: parsed.documentId } : null;
}

/**
 * Ha van strukturált dokumentum-link, a szöveges marker ne jelenjen meg duplán.
 *
 * Kivétel a KÉP-dokumentum (`preview.mimeType` image/*): ott a marker marad,
 * mert a buborék azt inline képként rendereli, a strukturált chipet pedig a
 * `hideDocumentLinksRenderedInline` rejti el — így a kép egyszer, de nagyban
 * látszik.
 */
export function stripDocumentMarkerIfContextLinked(
  text: string,
  contextLinks?: MessageContextLink[] | null,
): string {
  const linked = findLinkedDocument(text, contextLinks);
  if (!linked) return text;
  if (isImageMimeType(linked.link.preview?.mimeType)) return text;
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

/**
 * A buborék kontextus-link csíkjából kiszűri azt a képdokumentum-linket,
 * amelyet a szöveg markere már inline képként megjelenít (a párja a
 * `stripDocumentMarkerIfContextLinked` kép-kivételének).
 */
export function hideDocumentLinksRenderedInline(
  text: string,
  contextLinks?: MessageContextLink[] | null,
): MessageContextLink[] {
  if (!contextLinks?.length) return contextLinks ?? [];
  const linked = findLinkedDocument(text, contextLinks);
  if (!linked || !isImageMimeType(linked.link.preview?.mimeType)) return contextLinks;
  return contextLinks.filter((l) => l.id !== linked.link.id);
}

/**
 * Üzenet-előnézet (beszélgetéslista, idézet, push / e-mail értesítés) — a
 * gépi markereket ember-olvasható címkére cseréli, hogy a felhasználó ne a
 * nyers `[DOCUMENT_UPLOADED:…]` / `[CHAT_IMAGE:…]` szöveget lássa.
 *
 * Tiszta függvény, kliens- és szerveroldalon is használható.
 */

import { CHAT_IMAGE_DOCUMENT_TAG } from './chat-image-marker';

export const IMAGE_PREVIEW_LABEL = '📷 Kép';
export const DOCUMENT_PREVIEW_LABEL = '📎 Dokumentum';
export const CONSILIUM_PREP_PREVIEW_LABEL = 'Konzílium előkészítő';

const CHAT_IMAGE_RE = /\[CHAT_IMAGE:[^\]]*\]/gi;
const DOCUMENT_UPLOADED_RE = /\[DOCUMENT_UPLOADED:([^:\]]*)(?::[^\]]*)?\]/gi;
const CONSILIUM_PREP_RE = /\[CONSILIUM_PREP:[^\]]*\]/g;

/**
 * Markerek cseréje címkékre + whitespace-normalizálás (egysoros előnézet).
 * Üres / `null` input → üres string.
 */
export function humanizeMessagePreview(text: string | null | undefined): string {
  if (!text) return '';
  const replaced = text
    .replace(CHAT_IMAGE_RE, IMAGE_PREVIEW_LABEL)
    .replace(DOCUMENT_UPLOADED_RE, (_m, tag: string) =>
      (tag ?? '').trim().toLowerCase() === CHAT_IMAGE_DOCUMENT_TAG
        ? IMAGE_PREVIEW_LABEL
        : DOCUMENT_PREVIEW_LABEL,
    )
    .replace(CONSILIUM_PREP_RE, CONSILIUM_PREP_PREVIEW_LABEL);
  return replaced.replace(/\s+/g, ' ').trim();
}

/** Igaz, ha az üzenet (a markereken túl) tartalmaz szöveges részt is. */
export function messageHasTextBesidesMarkers(text: string | null | undefined): boolean {
  if (!text) return false;
  const stripped = text
    .replace(CHAT_IMAGE_RE, '')
    .replace(DOCUMENT_UPLOADED_RE, '')
    .replace(CONSILIUM_PREP_RE, '');
  return stripped.trim().length > 0;
}

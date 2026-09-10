/**
 * Kliensoldali segédek a chatben küldött képekhez.
 *
 * A kép küldés előtt feltöltődik (célhely szerint), majd az üzenetbe csak a
 * marker kerül:
 *  - beteg-dokumentum (staff: /api/patients/:id/documents, portál:
 *    /api/patient-portal/documents) → `[DOCUMENT_UPLOADED:chat:…]`
 *  - beteghez nem rendelt orvos–orvos kép → `[CHAT_IMAGE:<attachmentId>]`
 */

import {
  buildDocumentLinkMarker,
  insertDocumentLinkIntoMessage,
  type DocumentLinkChatType,
} from './document-link-marker';
import { buildChatImageMarker, CHAT_IMAGE_DOCUMENT_TAG } from './chat-image-marker';

export type ChatImageTarget =
  /** Staff: a kép a megadott beteg dokumentumai közé kerül. */
  | { kind: 'patient-document'; patientId: string; patientName?: string | null }
  /** Beteg portál: a kép a bejelentkezett beteg saját dokumentumai közé kerül. */
  | { kind: 'portal-document' }
  /** Orvos–orvos chat, beteghez rendelés nélkül. */
  | { kind: 'doctor-attachment' };

export const MAX_CHAT_IMAGES_PER_SEND = 10;

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i;

export function isImageFile(file: File): boolean {
  if (file.type && file.type.toLowerCase().startsWith('image/')) return true;
  return IMAGE_EXT_RE.test(file.name || '');
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return (data && typeof data.error === 'string' && data.error) || fallback;
}

export interface UploadChatImageOptions {
  chatType: DocumentLinkChatType;
  /** Dokumentum leírása (staff / portál mentésnél) — jellemzően a képaláírás. */
  description?: string | null;
}

/** Feltölti a képet a célhelyre, és visszaadja az üzenetbe szúrandó markert. */
export async function uploadChatImage(
  file: File,
  target: ChatImageTarget,
  opts: UploadChatImageOptions,
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);

  if (target.kind === 'doctor-attachment') {
    const res = await fetch('/api/doctor-messages/attachments', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    if (!res.ok) throw new Error(await readError(res, 'A kép feltöltése sikertelen'));
    const data = await res.json();
    const id = data?.attachment?.id;
    if (typeof id !== 'string') throw new Error('A kép feltöltése sikertelen');
    return buildChatImageMarker(id);
  }

  formData.append('tags', JSON.stringify([CHAT_IMAGE_DOCUMENT_TAG]));
  const description = (opts.description ?? '').trim();
  formData.append('description', description || 'Üzenetben küldött kép');

  const url =
    target.kind === 'portal-document'
      ? '/api/patient-portal/documents'
      : `/api/patients/${target.patientId}/documents`;
  const res = await fetch(url, { method: 'POST', body: formData, credentials: 'include' });
  if (!res.ok) throw new Error(await readError(res, 'A kép feltöltése sikertelen'));
  const data = await res.json();
  const document = data?.document ?? data;
  const documentId = document?.id;
  if (typeof documentId !== 'string') throw new Error('A kép feltöltése sikertelen');
  const patientId: string =
    target.kind === 'patient-document' ? target.patientId : (document?.patientId ?? '');

  return buildDocumentLinkMarker({
    tag: CHAT_IMAGE_DOCUMENT_TAG,
    patientId,
    documentId,
    chatType: opts.chatType,
  });
}

export interface PendingChatImage {
  id: string;
  file: File;
  /** `URL.createObjectURL` előnézet — a hook felszabadítja. */
  previewUrl: string;
  status: 'idle' | 'uploading' | 'error';
  error: string | null;
  target: ChatImageTarget | null;
  /** Sikeres feltöltés után a marker (újraküldésnél nem töltünk fel újra). */
  uploadedMarker: string | null;
}

export interface SendPendingChatImagesParams {
  images: PendingChatImage[];
  /** A szerkesztő szövege — az ELSŐ képhez kerül aláírásként. */
  caption: string;
  chatType: DocumentLinkChatType;
  /** Ha egy képnek nincs saját célhelye. */
  defaultTarget: ChatImageTarget;
  update: (id: string, patch: Partial<PendingChatImage>) => void;
  remove: (id: string) => void;
  /** Egy üzenet tényleges elküldése (optimista buborék + POST). `false` = sikertelen. */
  sendText: (text: string, index: number) => Promise<boolean>;
  /** Hibaüzenet (toast) — a kép `error` státuszba kerül, a sor megáll. */
  onError?: (message: string) => void;
}

/**
 * Képenként: feltöltés (ha még nem történt) → üzenet küldése a markerrel →
 * eltávolítás a függő listából. Az első hiba megállítja a sort; a hibás kép
 * `error` státuszban marad, a feltöltött marker megőrződik az újrapróbáláshoz.
 * Visszatérés: minden kép elment-e.
 */
export async function sendPendingChatImages(params: SendPendingChatImagesParams): Promise<boolean> {
  const caption = params.caption.trim();
  const snapshot = params.images.filter((img) => img.status !== 'uploading');

  for (let index = 0; index < snapshot.length; index++) {
    const img = snapshot[index];
    let marker = img.uploadedMarker;

    if (!marker) {
      params.update(img.id, { status: 'uploading', error: null });
      try {
        marker = await uploadChatImage(img.file, img.target ?? params.defaultTarget, {
          chatType: params.chatType,
          description: index === 0 ? caption : null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'A kép feltöltése sikertelen';
        params.update(img.id, { status: 'error', error: message });
        params.onError?.(message);
        return false;
      }
      params.update(img.id, { uploadedMarker: marker });
    }

    const text = index === 0 && caption ? insertDocumentLinkIntoMessage(caption, marker) : marker;
    const ok = await params.sendText(text, index);
    if (!ok) {
      const message = 'Az üzenet küldése sikertelen — próbálja újra';
      params.update(img.id, { status: 'error', error: message, uploadedMarker: marker });
      params.onError?.(message);
      return false;
    }
    params.remove(img.id);
  }
  return true;
}

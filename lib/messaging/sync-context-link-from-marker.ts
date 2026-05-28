/**
 * Üzenetszöveg marker → message_context_links (Fázis 2.1).
 * Csak staff küldőnél (users.id); a beteg portál marker-ei változatlanul maradnak.
 */

import { parseDocumentLinkMarker } from '@/lib/messaging/document-link-marker';
import { linkMessageToEntity, type StaffViewer } from '@/lib/messaging/context-links';
import type { MessageChannel } from '@/lib/types/messaging';

export async function syncDocumentContextLinkFromMarker(params: {
  channel: MessageChannel;
  messageId: string;
  messageText: string;
  patientId: string;
  actor: StaffViewer;
}): Promise<void> {
  const parsed = parseDocumentLinkMarker(params.messageText);
  if (!parsed) return;

  const pid = parsed.patientId ?? params.patientId;
  try {
    await linkMessageToEntity(
      params.channel,
      params.messageId,
      'document',
      parsed.documentId,
      params.actor,
    );
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'CONTEXT_LINK_EXISTS') return;
    console.error('[syncDocumentContextLinkFromMarker]', err);
  }
}

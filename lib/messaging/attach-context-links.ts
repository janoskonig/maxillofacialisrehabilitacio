import type { MessageContextLink } from '@/lib/types/messaging';
import { batchMessageContextLinks, type ContextLinkViewer } from './context-links';
import type { MessageChannel } from '@/lib/types/messaging';

export function mergeContextLinksIntoMessages<T extends { id: string }>(
  messages: T[],
  linkMap: Map<string, MessageContextLink[]>,
): Array<T & { contextLinks: MessageContextLink[] }> {
  return messages.map((m) => ({
    ...m,
    contextLinks: linkMap.get(m.id) ?? [],
  }));
}

export async function enrichMessagesWithContextLinks<T extends { id: string }>(
  channel: MessageChannel,
  messages: T[],
  viewer: ContextLinkViewer | undefined,
): Promise<Array<T & { contextLinks: MessageContextLink[] }>> {
  if (!viewer || messages.length === 0) {
    return messages.map((m) => ({ ...m, contextLinks: [] }));
  }
  const ids = messages.map((m) => m.id);
  const linkMap = await batchMessageContextLinks(channel, ids, viewer);
  return mergeContextLinksIntoMessages(messages, linkMap);
}

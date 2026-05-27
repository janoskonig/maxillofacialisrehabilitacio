/**
 * Fázis 4.2 — Közvetlen válaszok elrejtése, ha a parent szál össze van csukva.
 */
export function isDirectReplyVisible<T extends { replyToMessageId?: string | null }>(
  message: T,
  collapsedRoots: ReadonlySet<string>,
): boolean {
  const parentId = message.replyToMessageId;
  if (!parentId) return true;
  return !collapsedRoots.has(parentId);
}

export function filterMessagesByThreadCollapse<T extends { replyToMessageId?: string | null }>(
  messages: T[],
  collapsedRoots: ReadonlySet<string>,
): T[] {
  if (collapsedRoots.size === 0) return messages;
  return messages.filter((m) => isDirectReplyVisible(m, collapsedRoots));
}

/** Összecsukott szálban hány válasz van rejtve (közvetlen reply-k). */
export function countHiddenDirectReplies<T extends { id: string; replyToMessageId?: string | null }>(
  messages: T[],
  parentId: string,
  collapsedRoots: ReadonlySet<string>,
): number {
  if (!collapsedRoots.has(parentId)) return 0;
  return messages.filter((m) => m.replyToMessageId === parentId).length;
}

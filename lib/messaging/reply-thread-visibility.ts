/**
 * Fázis 4.2 / 5.3 — Válaszszál láthatóság összecsukáskor.
 * Fázis 5: bármely összecsukott ős elrejti az egész leszármazott ágat.
 */

export type ThreadMessage = {
  id: string;
  replyToMessageId?: string | null;
};

function buildMessageIndex<T extends ThreadMessage>(messages: readonly T[]): Map<string, T> {
  return new Map(messages.map((m) => [m.id, m]));
}

/** Van-e összecsukott ős a reply-láncban. */
function hasCollapsedAncestor<T extends ThreadMessage>(
  replyToMessageId: string | null | undefined,
  index: ReadonlyMap<string, T>,
  collapsedRoots: ReadonlySet<string>,
): boolean {
  let currentId = replyToMessageId;
  while (currentId) {
    if (collapsedRoots.has(currentId)) return true;
    currentId = index.get(currentId)?.replyToMessageId ?? null;
  }
  return false;
}

/** Leszármazott-e (közvetlen vagy közvetett) a megadott őstől. */
function isDescendantOf<T extends ThreadMessage>(
  messageId: string,
  ancestorId: string,
  index: ReadonlyMap<string, T>,
): boolean {
  const message = index.get(messageId);
  if (!message?.replyToMessageId) return false;
  let currentId: string | null | undefined = message.replyToMessageId;
  while (currentId) {
    if (currentId === ancestorId) return true;
    currentId = index.get(currentId)?.replyToMessageId ?? null;
  }
  return false;
}

export function isDirectReplyVisible<T extends ThreadMessage>(
  message: T,
  collapsedRoots: ReadonlySet<string>,
  messageIndex?: ReadonlyMap<string, T>,
): boolean {
  if (!message.replyToMessageId) return true;
  const index = messageIndex ?? new Map([[message.id, message]]);
  return !hasCollapsedAncestor(message.replyToMessageId, index, collapsedRoots);
}

export function filterMessagesByThreadCollapse<T extends ThreadMessage>(
  messages: T[],
  collapsedRoots: ReadonlySet<string>,
): T[] {
  if (collapsedRoots.size === 0) return messages;
  const index = buildMessageIndex(messages);
  return messages.filter((m) => isDirectReplyVisible(m, collapsedRoots, index));
}

/** Összecsukott szálban hány válasz van rejtve (közvetlen + beágyazott). */
export function countHiddenDirectReplies<T extends ThreadMessage>(
  messages: T[],
  parentId: string,
  collapsedRoots: ReadonlySet<string>,
): number {
  if (!collapsedRoots.has(parentId)) return 0;
  const index = buildMessageIndex(messages);
  return messages.filter((m) => isDescendantOf(m.id, parentId, index)).length;
}

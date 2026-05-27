/**
 * Fázis 3.3 — Realtime replyCount növelés, amikor új válasz érkezik socketen
 * vagy optimista INSERT után (a parent üzenet `replyCount` mezője +1).
 */
export function incrementParentReplyCount<T extends { id: string; replyCount?: number }>(
  messages: T[],
  replyToMessageId: string | null | undefined,
): T[] {
  if (!replyToMessageId) return messages;
  let changed = false;
  const next = messages.map((m) => {
    if (m.id !== replyToMessageId) return m;
    changed = true;
    return { ...m, replyCount: (m.replyCount ?? 0) + 1 };
  });
  return changed ? next : messages;
}

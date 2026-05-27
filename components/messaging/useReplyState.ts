'use client';

/**
 * useReplyState — közös reply-state hook a chat composerek számára (Szelet 0.4).
 *
 * Egyetlen állapotot kezel: melyik üzenetre válaszolunk éppen. A két chat
 * felület (orvos–orvos, beteg–orvos) ugyanazt a hookot használja a 0.5/0.6
 * integrációban, hogy a billentyű-, scroll- és lemondás-viselkedés azonos
 * legyen.
 *
 * NEM tárolja a tárgyat/üzenetszöveget — azt a composer komponens helyileg
 * birtokolja. A hook csak a quote-ot és a `replyToMessageId`-t szolgáltatja.
 */

import { useCallback, useState } from 'react';
import type { QuotedMessagePreview } from '@/lib/types/messaging';

export interface ReplyState {
  /** Az éppen kiválasztott idézett üzenet preview-ja, vagy null ha nincs reply. */
  replyTarget: QuotedMessagePreview | null;
  /** A POST body-jába kerülő ID; akkor null, ha nincs reply. */
  replyToMessageId: string | null;
  /** Reply mód indítása egy konkrét üzenetre. */
  setReplyTarget: (target: QuotedMessagePreview | null) => void;
  /** Reply lemondása (Esc / X / sikeres küldés után). */
  clearReply: () => void;
  /** Igaz, ha jelenleg reply módban vagyunk. */
  isReplying: boolean;
}

export function useReplyState(initial: QuotedMessagePreview | null = null): ReplyState {
  const [replyTarget, setReplyTargetState] = useState<QuotedMessagePreview | null>(initial);

  const setReplyTarget = useCallback((target: QuotedMessagePreview | null) => {
    setReplyTargetState(target);
  }, []);

  const clearReply = useCallback(() => {
    setReplyTargetState(null);
  }, []);

  return {
    replyTarget,
    replyToMessageId: replyTarget?.id ?? null,
    setReplyTarget,
    clearReply,
    isReplying: replyTarget !== null,
  };
}

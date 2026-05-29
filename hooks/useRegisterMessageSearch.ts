'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  useMessageSearchContextOptional,
  type MessageSearchHandler,
} from '@/contexts/MessageSearchContext';

/**
 * Regisztrálja az aktív chat felületet a globális üzenetkereséshez.
 *
 * A `handler` objektum tipikusan minden rendernél új referencia (mert
 * függvény-propokra/scope-ra épül), ezért egy stabil identitású proxy-t
 * regisztrálunk, ami ref-en keresztül mindig a legfrissebb handlert hívja.
 * Így az effekt csak akkor fut le újra, ha a context vagy a handler `id`
 * ténylegesen változik — nem keletkezik végtelen register/újrarender ciklus.
 */
export function useRegisterMessageSearch(handler: MessageSearchHandler | null) {
  const ctx = useMessageSearchContextOptional();

  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const id = handler?.id;
  const channel = handler?.channel;

  const stableHandler = useMemo<MessageSearchHandler | null>(() => {
    if (!id || !channel) return null;
    return {
      id,
      channel,
      get scope() {
        return handlerRef.current?.scope ?? {};
      },
      get messagesContainerRef() {
        return handlerRef.current?.messagesContainerRef;
      },
      scrollToMessage: (messageId) =>
        handlerRef.current?.scrollToMessage(messageId) ?? false,
      focusComposer: () => handlerRef.current?.focusComposer(),
      prepareHit: (hit) =>
        handlerRef.current?.prepareHit(hit) ?? Promise.resolve(),
    };
  }, [id, channel]);

  useEffect(() => {
    if (!ctx || !stableHandler) return;
    ctx.registerHandler(stableHandler);
    return () => ctx.unregisterHandler(stableHandler.id);
  }, [ctx, stableHandler]);
}

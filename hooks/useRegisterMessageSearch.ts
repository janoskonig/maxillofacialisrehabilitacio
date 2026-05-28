'use client';

import { useEffect } from 'react';
import {
  useMessageSearchContextOptional,
  type MessageSearchHandler,
} from '@/contexts/MessageSearchContext';

/** Regisztrálja az aktív chat felületet a globális üzenetkereséshez. */
export function useRegisterMessageSearch(handler: MessageSearchHandler | null) {
  const ctx = useMessageSearchContextOptional();

  useEffect(() => {
    if (!ctx || !handler) return;
    ctx.registerHandler(handler);
    return () => ctx.unregisterHandler(handler.id);
  }, [ctx, handler]);
}

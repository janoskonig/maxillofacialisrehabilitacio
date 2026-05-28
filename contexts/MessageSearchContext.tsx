'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { MessageChannel, MessageSearchHit } from '@/lib/types/messaging';
import { MessageSearchModal } from '@/components/messaging/MessageSearchModal';
import { scrollToMessageWithRetry } from '@/lib/messaging/search-navigation';

export interface MessageSearchScope {
  patientId?: string;
  recipientId?: string;
  groupId?: string;
  doctorId?: string;
}

export interface MessageSearchHandler {
  id: string;
  channel: MessageChannel;
  scope: MessageSearchScope;
  /** Aktív beszélgetés konténer (scroll kereséshez). */
  messagesContainerRef?: React.RefObject<HTMLElement | null>;
  scrollToMessage: (messageId: string) => boolean;
  focusComposer: () => void;
  prepareHit: (hit: MessageSearchHit) => Promise<void>;
}

interface MessageSearchContextValue {
  isOpen: boolean;
  preferredChannel: MessageChannel;
  activeHandler: MessageSearchHandler | null;
  openSearch: (channel?: MessageChannel) => void;
  closeSearch: () => void;
  registerHandler: (handler: MessageSearchHandler) => void;
  unregisterHandler: (id: string) => void;
  navigateToHit: (hit: MessageSearchHit) => Promise<void>;
}

const MessageSearchContext = createContext<MessageSearchContextValue | null>(null);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function MessageSearchProvider({
  children,
  preferredChannel = 'patient',
}: {
  children: ReactNode;
  preferredChannel?: MessageChannel;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [channelOverride, setChannelOverride] = useState<MessageChannel | null>(null);
  const handlersRef = useRef<Map<string, MessageSearchHandler>>(new Map());
  const [handlerVersion, setHandlerVersion] = useState(0);

  const registerHandler = useCallback((handler: MessageSearchHandler) => {
    handlersRef.current.set(handler.id, handler);
    setHandlerVersion((v) => v + 1);
  }, []);

  const unregisterHandler = useCallback((id: string) => {
    handlersRef.current.delete(id);
    setHandlerVersion((v) => v + 1);
  }, []);

  const activeHandler = useMemo(() => {
    void handlerVersion;
    const list = Array.from(handlersRef.current.values());
    const ch = channelOverride ?? preferredChannel;
    return list.find((h) => h.channel === ch) ?? list[list.length - 1] ?? null;
  }, [handlerVersion, channelOverride, preferredChannel]);

  const openSearch = useCallback((channel?: MessageChannel) => {
    setChannelOverride(channel ?? null);
    setIsOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setIsOpen(false);
    setChannelOverride(null);
    activeHandler?.focusComposer();
  }, [activeHandler]);

  const navigateToHit = useCallback(
    async (hit: MessageSearchHit) => {
      const handler =
        Array.from(handlersRef.current.values()).find((h) => h.channel === hit.channel) ??
        activeHandler;
      if (!handler) return;

      setIsOpen(false);
      await handler.prepareHit(hit);
      const container = handler.messagesContainerRef?.current ?? null;
      const scrollFn = (messageId: string) => {
        if (container) {
          const el = container.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
          if (!el) return false;
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-amber-400', 'rounded-lg');
          window.setTimeout(() => {
            el.classList.remove('ring-2', 'ring-amber-400', 'rounded-lg');
          }, 1600);
          return true;
        }
        return handler.scrollToMessage(messageId);
      };
      await scrollToMessageWithRetry(scrollFn, hit.id);
      handler.focusComposer();
    },
    [activeHandler],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      openSearch();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openSearch]);

  // Modal nyitva: ne nyíljon újra a `/` a keresőmezőben.
  useEffect(() => {
    if (!isOpen) return;
    const block = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', block, true);
    return () => window.removeEventListener('keydown', block, true);
  }, [isOpen]);

  const value: MessageSearchContextValue = {
    isOpen,
    preferredChannel: channelOverride ?? preferredChannel,
    activeHandler,
    openSearch,
    closeSearch,
    registerHandler,
    unregisterHandler,
    navigateToHit,
  };

  return (
    <MessageSearchContext.Provider value={value}>
      {children}
      <MessageSearchModal />
    </MessageSearchContext.Provider>
  );
}

export function useMessageSearchContext(): MessageSearchContextValue {
  const ctx = useContext(MessageSearchContext);
  if (!ctx) {
    throw new Error('useMessageSearchContext requires MessageSearchProvider');
  }
  return ctx;
}

/** Opcionális — komponensek kívül a provider nélkül is működjenek. */
export function useMessageSearchContextOptional(): MessageSearchContextValue | null {
  return useContext(MessageSearchContext);
}

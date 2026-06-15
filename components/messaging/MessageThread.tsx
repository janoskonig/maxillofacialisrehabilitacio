'use client';

/**
 * MessageThread — közös, görgethető üzenetlista a chat felületekhez.
 *
 * Felelőssége (korábban inline duplikálva minden konténerben):
 *  - nap-elválasztók + egymást követő üzenet-csoportosítás (`decorateMessages`),
 *  - automatikus aljára-görgetés új üzenetnél (ha a felhasználó alul van),
 *  - felül-görgetéses régebbi-üzenet betöltés (`onLoadOlder`),
 *  - üres / betöltési állapot,
 *  - „gépel…” indikátor,
 *  - `role="log"` + `aria-live` az akadálymentességhez.
 *
 * A buborékot a meglévő `ChatMessageBubble` rendereli; a csatorna-specifikus
 * dolgokat (szövegrender, avatar, csoport-footer) a hívó adja callbackként.
 */

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { ChatMessageBubble, type ChatBubbleMessage } from './ChatMessageBubble';
import { decorateMessages } from '@/lib/messaging/group-messages';

interface MessageThreadProps {
  messages: ChatBubbleMessage[];
  loading?: boolean;
  /** Tartalom üres listánál (a hívó adja a kontextus-specifikus szöveget). */
  emptyState?: ReactNode;
  currentUserId?: string | null;

  renderText?: (text: string, message: ChatBubbleMessage) => ReactNode;
  onReply?: (message: ChatBubbleMessage) => void;
  onQuoteClick?: (messageId: string) => void;
  onRetry?: (message: ChatBubbleMessage) => void;
  onReplyThreadToggle?: (parentMessageId: string) => void;
  isThreadCollapsed?: (parentMessageId: string) => boolean;

  canRemoveContextLinks?: boolean;
  onRemoveContextLink?: (messageId: string, linkId: string) => void;

  /** Avatar a nem-saját üzenetekhez (a blokk utolsó buborékján jelenik meg). */
  renderAvatar?: (message: ChatBubbleMessage) => ReactNode;
  /** Buborék-belső footer (pl. csoport „olvasták” lista). */
  renderBubbleFooter?: (message: ChatBubbleMessage) => ReactNode;

  /** „gépel…” indikátor szövege, vagy `null`/`undefined` ha senki nem gépel. */
  typingLabel?: string | null;

  /** Felül-görgetéskor hívódik régebbi üzenetek betöltéséhez. */
  onLoadOlder?: () => void;
  hasMore?: boolean;
  loadingOlder?: boolean;

  className?: string;
}

const NEAR_BOTTOM_PX = 120;

export function MessageThread({
  messages,
  loading = false,
  emptyState,
  currentUserId,
  renderText,
  onReply,
  onQuoteClick,
  onRetry,
  onReplyThreadToggle,
  isThreadCollapsed,
  canRemoveContextLinks = false,
  onRemoveContextLink,
  renderAvatar,
  renderBubbleFooter,
  typingLabel,
  onLoadOlder,
  hasMore = false,
  loadingOlder = false,
  className = '',
}: MessageThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const wasNearBottomRef = useRef(true);

  // Görgetési pozíció figyelése: új üzenetnél csak akkor ugrunk aljára, ha a
  // felhasználó már amúgy is közel volt az aljához.
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasNearBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_PX;
    if (el.scrollTop <= 0 && hasMore && !loadingOlder) {
      onLoadOlder?.();
    }
  };

  // Aljára görgetés új üzenetnél (vagy első betöltéskor).
  useLayoutEffect(() => {
    const grew = messages.length > prevCountRef.current;
    const firstLoad = prevCountRef.current === 0 && messages.length > 0;
    prevCountRef.current = messages.length;
    if ((grew && wasNearBottomRef.current) || firstLoad) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages.length]);

  // „gépel…” megjelenésekor is görgessünk, ha alul vagyunk.
  useEffect(() => {
    if (typingLabel && wasNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
  }, [typingLabel]);

  const decorated = decorateMessages(messages);

  if (loading && messages.length === 0) {
    return (
      <div className={`flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500 ${className}`}>
        <Loader2 className="w-5 h-5 animate-spin" aria-label="Betöltés" />
      </div>
    );
  }

  if (!loading && messages.length === 0) {
    return (
      <div className={`flex-1 flex items-center justify-center p-6 ${className}`}>
        {emptyState ?? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center">Még nincs üzenet.</p>
        )}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      role="log"
      aria-live="polite"
      aria-label="Üzenetek"
      className={`flex-1 overflow-y-auto px-3 sm:px-4 py-3 ${className}`}
    >
      {hasMore && (
        <div className="flex justify-center py-2">
          {loadingOlder ? (
            <Loader2 className="w-4 h-4 animate-spin text-gray-400" aria-label="Korábbi üzenetek betöltése" />
          ) : (
            <button
              type="button"
              onClick={onLoadOlder}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-medical-primary underline-offset-2 hover:underline"
            >
              Korábbi üzenetek
            </button>
          )}
        </div>
      )}

      {decorated.map(({ message, showDaySeparator, dayLabel, isFirstInGroup, isLastInGroup }) => (
        <div key={message.id} className={isFirstInGroup ? 'mt-3 first:mt-0' : 'mt-0.5'}>
          {showDaySeparator && dayLabel && (
            <div className="flex justify-center my-3" role="separator" aria-label={dayLabel}>
              <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full">
                {dayLabel}
              </span>
            </div>
          )}
          <ChatMessageBubble
            message={message}
            currentUserId={currentUserId}
            renderText={renderText}
            onReply={onReply}
            onQuoteClick={onQuoteClick}
            onRetry={onRetry}
            onReplyThreadToggle={onReplyThreadToggle}
            replyThreadCollapsed={isThreadCollapsed ? isThreadCollapsed(message.id) : false}
            canRemoveContextLinks={canRemoveContextLinks}
            onRemoveContextLink={onRemoveContextLink}
            isFirstInGroup={isFirstInGroup}
            isLastInGroup={isLastInGroup}
            avatarSlot={!message.isFromMe && renderAvatar ? renderAvatar(message) : undefined}
            bubbleFooter={renderBubbleFooter ? renderBubbleFooter(message) : undefined}
          />
        </div>
      ))}

      {typingLabel && (
        <div className="flex items-center gap-2 mt-3 pl-9" aria-live="polite">
          <span className="inline-flex gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl px-3 py-2">
            <Dot /> <Dot delay="150ms" /> <Dot delay="300ms" />
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">{typingLabel}</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

function Dot({ delay = '0ms' }: { delay?: string }) {
  return (
    <span
      className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce"
      style={{ animationDelay: delay }}
    />
  );
}

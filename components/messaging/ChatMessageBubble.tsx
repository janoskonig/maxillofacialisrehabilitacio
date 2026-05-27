'use client';

/**
 * ChatMessageBubble — csatorna-független üzenetbuborék (Szelet 0.4).
 *
 * Ezt a komponenst használjuk a 0.5 és 0.6 integrációban a doctor / patient
 * chat felületeken. Pure presentational — nem hív API-t, nem tartja állapotot.
 *
 * Két szándékos egyszerűsítés:
 *  - A `readBy` (group chat olvasás-vizualizáció) NEM ide tartozik — a
 *    `DoctorMessages.tsx` továbbra is külön rendereli, mert csoport-specifikus.
 *  - A szövegrender (mention, link, action chip) `renderText` propon kívül van
 *    delegálva, hogy a meglévő `MessageTextRenderer`-t a hívó cserélhesse.
 */

import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { Check, CheckCheck, Loader2, AlertTriangle, RotateCcw, CornerUpLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import type { QuotedMessagePreview } from '@/lib/types/messaging';
import { MessageQuoteBlock } from './MessageQuoteBlock';

export type DeliveryStatus = 'pending' | 'sent' | 'failed';

export interface ChatBubbleMessage {
  id: string;
  message: string;
  createdAt: Date | string;
  senderId: string;
  senderName?: string | null;
  isFromMe: boolean;
  replyToMessageId?: string | null;
  quotedMessage?: QuotedMessagePreview | null;
  /**
   * Kézbesítési állapot a 0.8-as szelethez előkészítve. 0.4-ben a kliens
   * csak optimistic-pending / sent jelzéseket használ; a `failed` ágon
   * jelenik meg az újraküldés gomb.
   */
  deliveryStatus?: DeliveryStatus;
  readAt?: Date | string | null;
}

interface Props {
  message: ChatBubbleMessage;
  /**
   * Az üzenet szövegének rendere. Ha hiányzik, `MessageTextRenderer` helyett
   * sima `whitespace-pre-wrap` text-fallbackot adunk — a demo / nem-MaxRehab
   * felületek így is működnek.
   */
  renderText?: (text: string, message: ChatBubbleMessage) => ReactNode;
  /**
   * Megnyomható "Válasz" akció a buborék hover/focus állapotán.
   * Ha hiányzik, a Válasz gomb el sem készül.
   */
  onReply?: (message: ChatBubbleMessage) => void;
  /**
   * Quote click: a hívó scrolljon a `data-message-id=<id>` jelölésű
   * elemhez a saját üzenetlista konténerében.
   */
  onQuoteClick?: (messageId: string) => void;
  /**
   * Optimistic retry (0.8 előkészítés). Csak akkor jelenik meg, ha
   * `deliveryStatus === 'failed'` ÉS van handler.
   */
  onRetry?: (message: ChatBubbleMessage) => void;
  /** Aktuális user ID — quote saját-magamnak jelzéséhez. */
  currentUserId?: string | null;
  /** Show or hide the sender label above the bubble (non-own). Default: true. */
  showSenderLabel?: boolean;
  /**
   * Extra content rendered INSIDE the bubble, under the time/check row.
   * Csatorna-specifikus elemekhez (pl. group chat `readBy` / "nem olvasták")
   * — a chrome egységes marad, a tartalom a hívó hatáskörében.
   */
  bubbleFooter?: ReactNode;
  className?: string;
}

export function ChatMessageBubble({
  message,
  renderText,
  onReply,
  onQuoteClick,
  onRetry,
  currentUserId,
  showSenderLabel = true,
  bubbleFooter,
  className,
}: Props) {
  const isFromMe = message.isFromMe;
  const status: DeliveryStatus = message.deliveryStatus ?? (message.readAt ? 'sent' : 'sent');
  const isPending = status === 'pending';
  const isFailed = status === 'failed';
  const isRead = !!message.readAt;
  const createdAt =
    message.createdAt instanceof Date ? message.createdAt : new Date(message.createdAt);

  const bubbleStyle = isFromMe
    ? 'bg-blue-600 text-white'
    : 'bg-white text-gray-900 border border-gray-200';

  const timeStyle = isFromMe ? 'text-blue-100' : 'text-gray-500';

  const quoteVariant: 'bubble-own' | 'bubble-other' = isFromMe ? 'bubble-own' : 'bubble-other';

  // Idézett küldő = "Te", ha a quote a current usertől származik.
  const quoteSenderOverride =
    message.quotedMessage && currentUserId && message.quotedMessage.senderId === currentUserId
      ? 'Te'
      : undefined;

  return (
    <div
      data-message-id={message.id}
      className={`group flex flex-col ${isFromMe ? 'items-end' : 'items-start'} ${className ?? ''}`}
    >
      {!isFromMe && showSenderLabel && message.senderName && (
        <div className="text-xs font-medium text-gray-700 mb-1 px-1">{message.senderName}</div>
      )}

      <div className="flex items-end gap-1 max-w-[85%] sm:max-w-[75%]">
        {/* Reply akció gomb a buborék mellett — csak hover/focus alatt látszódik */}
        {onReply && isFromMe && (
          <ReplyActionButton onClick={() => onReply(message)} side="left" />
        )}

        <div className={`flex-1 min-w-0 rounded-lg px-3 py-2 ${bubbleStyle}`}>
          {message.quotedMessage && (
            <div className="mb-2">
              <MessageQuoteBlock
                quote={message.quotedMessage}
                variant={quoteVariant}
                onClick={onQuoteClick}
                senderLabelOverride={quoteSenderOverride}
              />
            </div>
          )}

          <div className="text-sm whitespace-pre-wrap break-words">
            {renderText ? renderText(message.message, message) : message.message}
          </div>

          <div className={`text-xs mt-1 flex items-center gap-1.5 ${timeStyle}`}>
            <span>{format(createdAt, 'HH:mm', { locale: hu })}</span>
            {isFromMe && (
              <span className="ml-1 flex items-center gap-1">
                {isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" aria-label="küldés folyamatban" />
                ) : isFailed ? (
                  <AlertTriangle className="w-3 h-3" aria-label="küldés sikertelen" />
                ) : isRead ? (
                  <CheckCheck className="w-3 h-3" aria-label="olvasott" />
                ) : (
                  <Check className="w-3 h-3 opacity-70" aria-label="elküldve" />
                )}
              </span>
            )}
            {isFailed && onRetry && (
              <button
                type="button"
                onClick={() => onRetry(message)}
                className="inline-flex items-center gap-1 ml-1 underline-offset-2 hover:underline"
              >
                <RotateCcw className="w-3 h-3" /> Újraküldés
              </button>
            )}
          </div>

          {bubbleFooter}
        </div>

        {onReply && !isFromMe && (
          <ReplyActionButton onClick={() => onReply(message)} side="right" />
        )}
      </div>
    </div>
  );
}

function ReplyActionButton({ onClick, side }: { onClick: () => void; side: 'left' | 'right' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity p-1 rounded-full bg-white border border-gray-200 text-gray-500 hover:text-blue-600 hover:border-blue-300 shadow-sm ${
        side === 'left' ? 'order-first' : 'order-last'
      }`}
      aria-label="Válasz erre az üzenetre"
      title="Válasz"
    >
      <CornerUpLeft className="w-3.5 h-3.5" />
    </button>
  );
}

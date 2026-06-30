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
import { Check, CheckCheck, Loader2, AlertTriangle, RotateCcw, CornerUpLeft, HelpCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MessageContextLink, QuotedMessagePreview } from '@/lib/types/messaging';
import { MessageQuoteBlock } from './MessageQuoteBlock';
import { MessageContextLinksStrip } from './MessageContextLinksStrip';
import { replyThreadToggleLabel } from './reply-thread-label';

export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

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
   * Kézbesítési állapot. Kliens-only: `pending` / `failed`.
   * Szerver (Fázis 1.2): `sent` | `delivered` | `read`.
   */
  deliveryStatus?: DeliveryStatus;
  readAt?: Date | string | null;
  /** Fázis 1.1: közvetlen válaszok száma. */
  replyCount?: number;
  /** Fázis 2.1: strukturált entitás-linkek. */
  contextLinks?: MessageContextLink[];
  /** Az üzenethez kötött betegek (id + nev) — a renderer lekérés nélkül linkel. */
  mentionedPatients?: Array<{ id: string; nev: string; taj?: string | null }>;
  /**
   * 064: feloldatlan, kétértelmű beteg-említések. Ha van, a buborékon megjelenik
   * egy „Melyik beteg?” választó (lásd `onResolveMention`).
   */
  unresolvedMentions?: Array<{
    matchedText: string;
    candidates: Array<{ id: string; nev: string; taj?: string | null }>;
  }>;
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
   * Fázis 1.1: „N válasz” kattintás — szál toggle (Fázis 4.2) vagy scroll.
   */
  onReplyThreadToggle?: (parentMessageId: string) => void;
  /** Fázis 4.2: true ha a közvetlen válaszok jelenleg rejtve vannak. */
  replyThreadCollapsed?: boolean;
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
   * Saját buborék színárnyalata. `primary` (alap) = márka-kék; `green` = a
   * beteg-portál barátságos zöld buborékja.
   */
  ownTone?: 'primary' | 'green';
  /**
   * Üzenet-csoportosítás (lásd `lib/messaging/group-messages`). Ha `false`, az
   * üzenet egy egymást követő blokk közepén/végén van: a feladó-címke és az
   * avatar elrejtődik, a buborék sarkai teljesen kerekek (nincs „farok”).
   */
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  /**
   * Avatar a buborék melletti bal oldali sávban (csak nem-saját üzenetnél, és
   * csak a blokk utolsó üzeneténél jelenik meg). Ha hiányzik, a sáv üres marad,
   * így a csoport buborékjai egy vonalban állnak.
   */
  avatarSlot?: ReactNode;
  /**
   * Extra content rendered INSIDE the bubble, under the time/check row.
   * Csatorna-specifikus elemekhez (pl. group chat `readBy` / "nem olvasták")
   * — a chrome egységes marad, a tartalom a hívó hatáskörében.
   */
  bubbleFooter?: ReactNode;
  /** Fázis 2.1: staff eltávolíthatja a strukturált linkeket. */
  onRemoveContextLink?: (messageId: string, linkId: string) => void;
  canRemoveContextLinks?: boolean;
  /**
   * 064: egy kétértelmű beteg-említés feloldása az elküldött üzeneten. Ha
   * hiányzik, a „Melyik beteg?” választó nem jelenik meg.
   */
  onResolveMention?: (messageId: string, matchedText: string, patientId: string) => void;
  className?: string;
}

export function ChatMessageBubble({
  message,
  renderText,
  onReply,
  onQuoteClick,
  onReplyThreadToggle,
  replyThreadCollapsed = false,
  onRetry,
  currentUserId,
  showSenderLabel = true,
  ownTone = 'primary',
  isFirstInGroup = true,
  isLastInGroup = true,
  avatarSlot,
  bubbleFooter,
  onRemoveContextLink,
  canRemoveContextLinks = false,
  onResolveMention,
  className,
}: Props) {
  const isFromMe = message.isFromMe;
  const visualStatus = resolveDeliveryVisual(message);
  const isPending = visualStatus === 'pending';
  const isFailed = visualStatus === 'failed';
  const isRead = visualStatus === 'read';
  const isDelivered = visualStatus === 'delivered';
  const createdAt =
    message.createdAt instanceof Date ? message.createdAt : new Date(message.createdAt);

  const ownGreen = ownTone === 'green';
  const bubbleStyle = isFromMe
    ? ownGreen
      ? 'bg-green-500 text-white'
      : 'bg-medical-primary text-white'
    : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-800';

  const timeStyle = isFromMe
    ? ownGreen
      ? 'text-green-100'
      : 'text-blue-100'
    : 'text-gray-500 dark:text-gray-400';

  // „Farok” (éles sarok) csak a blokk utolsó buborékján, a feladó oldala felé.
  const cornerStyle = `rounded-2xl ${
    isLastInGroup ? (isFromMe ? 'rounded-br-md' : 'rounded-bl-md') : ''
  }`;

  const quoteVariant: 'bubble-own' | 'bubble-own-green' | 'bubble-other' = isFromMe
    ? ownGreen
      ? 'bubble-own-green'
      : 'bubble-own'
    : 'bubble-other';
  // A kontextus-link csík nem ismeri a zöld variánst — saját buboréknál mindig 'bubble-own'.
  const stripVariant: 'bubble-own' | 'bubble-other' = isFromMe ? 'bubble-own' : 'bubble-other';

  // Idézett küldő = "Te", ha a quote a current usertől származik.
  const quoteSenderOverride =
    message.quotedMessage && currentUserId && message.quotedMessage.senderId === currentUserId
      ? 'Te'
      : undefined;

  return (
    <div
      data-message-id={message.id}
      role="article"
      className={`group flex w-full gap-2 ${isFromMe ? 'justify-end' : 'justify-start'} ${className ?? ''}`}
    >
      {/* Bal oldali avatar-sáv (csak nem-saját) — avatar csak a blokk alján. */}
      {!isFromMe && (
        <div className="w-7 flex-shrink-0 flex items-end" aria-hidden={!isLastInGroup}>
          {isLastInGroup ? avatarSlot : null}
        </div>
      )}

      <div className={`flex flex-col min-w-0 max-w-[85%] sm:max-w-[80%] ${isFromMe ? 'items-end' : 'items-start'}`}>
        {!isFromMe && showSenderLabel && isFirstInGroup && message.senderName && (
          <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 px-1">{message.senderName}</div>
        )}

        <div className="relative inline-flex w-fit max-w-full items-end">
          {/* Reply akció gomb a buborék mellett — abszolút, hogy ne szűkítse a buborékot */}
          {onReply && isFromMe && (
            <ReplyActionButton onClick={() => onReply(message)} side="left" />
          )}

          <div className={`min-w-0 max-w-full px-3 py-2 ${bubbleStyle} ${cornerStyle}`}>
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

          {message.contextLinks && message.contextLinks.length > 0 && (
            <MessageContextLinksStrip
              links={message.contextLinks}
              variant={stripVariant}
              canRemove={canRemoveContextLinks}
              onRemoveLink={
                onRemoveContextLink
                  ? (linkId) => onRemoveContextLink(message.id, linkId)
                  : undefined
              }
            />
          )}

          <div className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {renderText ? renderText(message.message, message) : message.message}
          </div>

          {onResolveMention &&
            message.unresolvedMentions &&
            message.unresolvedMentions.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {message.unresolvedMentions.map((m, idx) => (
                  <div
                    key={`${m.matchedText}-${idx}`}
                    className={`rounded-lg px-2 py-1.5 ${
                      isFromMe
                        ? 'bg-white/15'
                        : 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900'
                    }`}
                  >
                    <div
                      className={`flex items-center gap-1 mb-1 text-xs ${
                        isFromMe ? 'text-white/90' : 'text-amber-800 dark:text-amber-300'
                      }`}
                    >
                      <HelpCircle className="w-3 h-3 flex-shrink-0" />
                      <span>
                        „{m.matchedText}” — melyik beteg?
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {m.candidates.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => onResolveMention(message.id, m.matchedText, c.id)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            isFromMe
                              ? 'bg-white/20 hover:bg-white/30 text-white'
                              : 'bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40'
                          }`}
                        >
                          {c.nev}
                          {c.taj ? <span className="opacity-60">· {c.taj}</span> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

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
                ) : isDelivered ? (
                  <CheckCheck className="w-3 h-3 opacity-70" aria-label="kézbesítve" />
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

      {message.replyCount != null && message.replyCount > 0 && onReplyThreadToggle && (
        <button
          type="button"
          onClick={() => onReplyThreadToggle(message.id)}
          className={`mt-1 text-xs font-medium underline-offset-2 hover:underline ${
            isFromMe ? 'text-blue-600 dark:text-blue-300 self-end' : 'text-gray-600 dark:text-gray-400 self-start'
          }`}
        >
          {replyThreadToggleLabel(message.replyCount, replyThreadCollapsed)}
        </button>
      )}
      </div>
    </div>
  );
}

function resolveDeliveryVisual(message: ChatBubbleMessage): DeliveryStatus {
  const status = message.deliveryStatus ?? 'sent';
  if (status === 'pending' || status === 'failed') return status;
  if (status === 'read' || message.readAt) return 'read';
  if (status === 'delivered') return 'delivered';
  return 'sent';
}

function ReplyActionButton({ onClick, side }: { onClick: () => void; side: 'left' | 'right' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute top-1/2 -translate-y-1/2 z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity p-1 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 hover:text-blue-600 hover:border-blue-300 dark:hover:border-blue-700 shadow-sm ${
        side === 'left' ? 'right-full mr-1' : 'left-full ml-1'
      }`}
      aria-label="Válasz erre az üzenetre"
      title="Válasz"
    >
      <CornerUpLeft className="w-3.5 h-3.5" />
    </button>
  );
}

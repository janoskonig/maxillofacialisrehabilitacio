'use client';

/**
 * Dev-only demo route: `/dev/messaging-bubble`
 *
 * A Szelet 0.4 közös messaging komponensek vizuális referenciája. Sem
 * autentikációt, sem DB-t nem érint. Csak akkor renderelődik, ha NEM
 * production build — produkcióban `notFound()`-ban végződik (404).
 *
 * (A korábbi terv `app/_dev/...` útvonalát Next.js privát mappa-konvenció
 * miatt felválasztottuk `app/dev/...`-re; URL: `/dev/messaging-bubble`.)
 *
 * A 0.5 / 0.6 integráló szeletek innen tudnak vizuálisan ellenőrizni:
 *   - hover/focus "Válasz" gomb mindkét oldalon,
 *   - idézet preview saját + másik buborékban,
 *   - composer csík X + Esc bezárás,
 *   - delivery state (pending / sent / failed + retry),
 *   - törölt parent idézet ("Az eredeti üzenet törölve lett.").
 */

import { notFound } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { QuotedMessagePreview } from '@/lib/types/messaging';
import {
  ChatMessageBubble,
  type ChatBubbleMessage,
} from '@/components/messaging/ChatMessageBubble';
import { ReplyComposerBar } from '@/components/messaging/ReplyComposerBar';
import { useReplyState } from '@/components/messaging/useReplyState';
import { MessageQuoteBlock } from '@/components/messaging/MessageQuoteBlock';

export default function DevMessagingBubblePage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  const ME = 'me-user-id';
  const OTHER = 'other-user-id';

  const baseQuote: QuotedMessagePreview = useMemo(
    () => ({
      id: 'parent-001',
      channel: 'doctor',
      senderId: OTHER,
      senderName: 'Kádár László dr.',
      message: 'Mit gondolsz erről a leletről? Még holnap vissza tudunk térni rá.',
      createdAt: new Date('2026-05-27T08:30:00Z'),
      deleted: false,
    }),
    [],
  );

  const deletedQuote: QuotedMessagePreview = useMemo(
    () => ({
      id: 'parent-001-deleted',
      channel: 'doctor',
      senderId: OTHER,
      senderName: 'Kádár László dr.',
      message: '',
      createdAt: new Date('2026-05-27T08:30:00Z'),
      deleted: true,
    }),
    [],
  );

  const messages: ChatBubbleMessage[] = useMemo(
    () => [
      {
        id: 'parent-001',
        message: 'Mit gondolsz erről a leletről? Még holnap vissza tudunk térni rá.',
        createdAt: new Date('2026-05-27T08:30:00Z'),
        senderId: OTHER,
        senderName: 'Kádár László dr.',
        isFromMe: false,
        readAt: new Date('2026-05-27T08:31:00Z'),
      },
      {
        id: 'reply-002',
        message: 'Igen, lényegében egyetértek — délután írok hosszabb összefoglalót.',
        createdAt: new Date('2026-05-27T08:45:00Z'),
        senderId: ME,
        isFromMe: true,
        replyToMessageId: baseQuote.id,
        quotedMessage: baseQuote,
        readAt: new Date('2026-05-27T09:00:00Z'),
      },
      {
        id: 'reply-003',
        message: 'Itt egy kép a kontroll-felvételről, ami csatolva van a dokumentumokhoz.',
        createdAt: new Date('2026-05-27T09:10:00Z'),
        senderId: OTHER,
        senderName: 'Kádár László dr.',
        isFromMe: false,
        replyToMessageId: baseQuote.id,
        quotedMessage: baseQuote,
      },
      {
        id: 'reply-004-deleted',
        message: 'Erre a (törölt) eredetire válaszolok.',
        createdAt: new Date('2026-05-27T09:20:00Z'),
        senderId: ME,
        isFromMe: true,
        replyToMessageId: deletedQuote.id,
        quotedMessage: deletedQuote,
      },
      {
        id: 'pending-005',
        message: 'Optimistic state: épp küldés alatt áll, óra ikon.',
        createdAt: new Date(),
        senderId: ME,
        isFromMe: true,
        deliveryStatus: 'pending',
      },
      {
        id: 'failed-006',
        message: 'Hálózati hiba — itt kell az "Újraküldés" gomb.',
        createdAt: new Date(),
        senderId: ME,
        isFromMe: true,
        deliveryStatus: 'failed',
      },
    ],
    [baseQuote, deletedQuote],
  );

  const reply = useReplyState();
  const listRef = useRef<HTMLDivElement>(null);

  const scrollToMessage = useCallback((messageId: string) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-blue-400');
    window.setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400'), 1600);
  }, []);

  // Esc → reply lemondás (csak a textarea-ra figyelünk, hogy globálisan ne lőjjön)
  const onComposerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape' && reply.isReplying) {
        e.preventDefault();
        reply.clearReply();
      }
    },
    [reply],
  );

  useEffect(() => {
    document.title = '[dev] Messaging bubble demo';
  }, []);

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Messaging UI demo (Szelet 0.4)</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Közös <code>ChatMessageBubble</code>, <code>MessageQuoteBlock</code>,
          <code> ReplyComposerBar</code> és <code>useReplyState</code> hook
          vizuális referenciája. Production buildben 404.
        </p>
      </header>

      <section className="border rounded-lg overflow-hidden">
        <div ref={listRef} className="p-4 space-y-3 bg-gray-50 dark:bg-gray-800/60 max-h-[480px] overflow-y-auto">
          {messages.map((m) => (
            <ChatMessageBubble
              key={m.id}
              message={m}
              currentUserId={ME}
              onReply={(msg) =>
                reply.setReplyTarget({
                  id: msg.id,
                  channel: 'doctor',
                  senderId: msg.senderId,
                  senderName: msg.senderName ?? null,
                  message: msg.message,
                  createdAt:
                    msg.createdAt instanceof Date ? msg.createdAt : new Date(msg.createdAt),
                  deleted: false,
                })
              }
              onQuoteClick={scrollToMessage}
              onRetry={(msg) => {
                // Demo: csak alert
                window.alert(`(demo) Újraküldés: ${msg.id}`);
              }}
            />
          ))}
        </div>

        {reply.isReplying && reply.replyTarget && (
          <ReplyComposerBar
            quote={reply.replyTarget}
            onClose={reply.clearReply}
            senderLabelOverride={
              reply.replyTarget.senderId === ME ? 'Te' : reply.replyTarget.senderName ?? undefined
            }
          />
        )}

        <form
          className="border-t p-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            window.alert(
              `(demo) Küldés${
                reply.replyToMessageId ? ` (replyToMessageId=${reply.replyToMessageId})` : ''
              }`,
            );
            reply.clearReply();
          }}
        >
          <textarea
            rows={2}
            onKeyDown={onComposerKeyDown}
            placeholder="Írj üzenetet… (Esc = reply lemondása)"
            className="flex-1 border border-gray-200 dark:border-gray-800 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
          >
            Küldés
          </button>
        </form>
      </section>

      <section className="border rounded-lg p-4 bg-white dark:bg-gray-900 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Quote variánsok izoláltan</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="rounded-md p-3 bg-blue-600">
            <MessageQuoteBlock quote={baseQuote} variant="bubble-own" />
          </div>
          <div className="rounded-md p-3 bg-white dark:bg-gray-900 border">
            <MessageQuoteBlock quote={baseQuote} variant="bubble-other" />
          </div>
          <div>
            <MessageQuoteBlock quote={deletedQuote} variant="composer" />
          </div>
        </div>
      </section>
    </main>
  );
}

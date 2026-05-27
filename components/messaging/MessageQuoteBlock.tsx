'use client';

/**
 * MessageQuoteBlock — egy idézett (reply target) üzenet előnézete.
 *
 * Három vizuális variáns:
 *  - `bubble-own`     buborékon belül, "tőlem" stílus (kék háttér felett vékony fehéres idézet),
 *  - `bubble-other`   buborékon belül, másik féltől (fehér háttér felett szürke idézet),
 *  - `composer`       a composer fölött, küldés előtt — semleges, sötétebb szöveg.
 *
 * Komponensként szándékosan minimal — nincs ikon, nincs aria-live. A
 * `lib/message-reply.buildQuotedMessagePreviewText` már levágta a hosszt és
 * normalizálta a whitespace-t, így itt csak megjelenítünk.
 */

import type { QuotedMessagePreview } from '@/lib/types/messaging';

export type MessageQuoteVariant = 'bubble-own' | 'bubble-other' | 'composer';

interface Props {
  quote: QuotedMessagePreview;
  variant?: MessageQuoteVariant;
  /**
   * Ha megadott, az idézet kattinthatóvá válik — a hívó tipikusan
   * scrollolja az eredeti üzenetet a viewportba (`data-message-id=...`).
   */
  onClick?: (messageId: string) => void;
  /**
   * Saját szöveg az idézett küldő helyett (pl. "Te" ha a current user
   * idézett magának). Hiányában a quote.senderName / "Ismeretlen" jön.
   */
  senderLabelOverride?: string;
}

export function MessageQuoteBlock({ quote, variant = 'bubble-other', onClick, senderLabelOverride }: Props) {
  const styles = STYLES[variant];
  const senderLabel = senderLabelOverride ?? quote.senderName ?? 'Ismeretlen';

  const body = quote.deleted ? (
    <span className={styles.deletedText}>Az eredeti üzenet törölve lett.</span>
  ) : (
    <span className={styles.bodyText}>{quote.message || '\u00A0'}</span>
  );

  const content = (
    <div className={`${styles.container} flex gap-2`}>
      <div className={styles.accent} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className={`${styles.senderText} text-xs font-semibold truncate`}>
          {senderLabel}
        </div>
        <div className={`text-xs leading-snug line-clamp-2 break-words`}>{body}</div>
      </div>
    </div>
  );

  if (!onClick) return content;

  return (
    <button
      type="button"
      onClick={() => onClick(quote.id)}
      className={`${styles.button} block w-full text-left rounded-md transition-colors`}
      aria-label={`Ugrás az idézett üzenethez (${senderLabel})`}
    >
      {content}
    </button>
  );
}

const STYLES: Record<MessageQuoteVariant, {
  container: string;
  accent: string;
  senderText: string;
  bodyText: string;
  deletedText: string;
  button: string;
}> = {
  'bubble-own': {
    container: 'px-2 py-1.5 rounded-md bg-blue-500/30',
    accent: 'w-0.5 self-stretch rounded bg-white/70',
    senderText: 'text-white/90',
    bodyText: 'text-white/90',
    deletedText: 'italic text-white/60',
    button: 'hover:bg-blue-500/40',
  },
  'bubble-other': {
    container: 'px-2 py-1.5 rounded-md bg-gray-100',
    accent: 'w-0.5 self-stretch rounded bg-blue-500',
    senderText: 'text-gray-800',
    bodyText: 'text-gray-700',
    deletedText: 'italic text-gray-400',
    button: 'hover:bg-gray-200',
  },
  composer: {
    container: 'px-3 py-2 rounded-md bg-blue-50 border border-blue-100',
    accent: 'w-0.5 self-stretch rounded bg-blue-500',
    senderText: 'text-blue-900',
    bodyText: 'text-gray-700',
    deletedText: 'italic text-gray-400',
    button: 'hover:bg-blue-100',
  },
};

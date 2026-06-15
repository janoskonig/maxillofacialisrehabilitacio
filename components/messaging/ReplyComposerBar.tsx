'use client';

/**
 * ReplyComposerBar — a composer fölötti "Válasz: …" csík (Szelet 0.4).
 *
 * Az aktuálisan idézett üzenetet jeleníti meg, és a következő mód-elhagyási
 * útvonalakat fedi le:
 *  - X gomb a csíkon: kattintható lemondás.
 *  - Esc billentyű a composerben: a textarea `onKeyDown`-jából a hívó
 *    közvetlenül `onClose()`-t hív; ezt a komponens szándékosan NEM
 *    rakja a `document.addEventListener`-re, mert a chat felületeken
 *    sok más Esc-érzékeny modal van.
 */

import { X, CornerUpLeft } from 'lucide-react';
import type { QuotedMessagePreview } from '@/lib/types/messaging';
import { MessageQuoteBlock } from './MessageQuoteBlock';

interface Props {
  quote: QuotedMessagePreview;
  onClose: () => void;
  /** Saját-magam-idézés címkéje (pl. "Te"); ha hiányzik, a senderName látszik. */
  senderLabelOverride?: string;
  /** Default: "Válasz". Pl. csoport chat-ben "Válasz @Kádár Lászlónak". */
  actionLabel?: string;
  className?: string;
}

export function ReplyComposerBar({
  quote,
  onClose,
  senderLabelOverride,
  actionLabel,
  className,
}: Props) {
  const senderLabel = senderLabelOverride ?? quote.senderName ?? 'Ismeretlen';
  const headline = actionLabel ?? `Válasz ${senderLabel} üzenetére`;

  return (
    <div
      role="region"
      aria-label="Válasz mód aktív"
      className={`flex items-start gap-2 px-3 py-2 border-t border-blue-100 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 ${className ?? ''}`}
    >
      <CornerUpLeft className="w-4 h-4 text-blue-600 dark:text-blue-300 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-blue-900 dark:text-blue-200 truncate">{headline}</div>
        <MessageQuoteBlock
          quote={quote}
          variant="composer"
          senderLabelOverride={senderLabelOverride}
        />
      </div>
      <button
        type="button"
        onClick={onClose}
        className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex-shrink-0"
        aria-label="Reply mód lemondása (Esc)"
        title="Esc"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

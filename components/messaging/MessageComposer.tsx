'use client';

/**
 * MessageComposer — közös, „pill” stílusú üzenetszerkesztő a chat felületekhez.
 *
 * Vezérelt (controlled): a szöveget a hívó tartja, hogy a csatorna-specifikus
 * csatolás-gombok (dokumentum / kontextus-link) ugyanazt a szöveget olvashassák
 * és módosíthassák. A komponens kezeli: az auto-növekvő textarea-t, az
 * Enter-küldést (Shift+Enter = új sor), a fókuszt (megnyitáskor), és a
 * küldés/letiltás állapotot. A reply-csík, a függő-linkek csík és a
 * csatolás-gombok slotként érkeznek, hogy egy komponens szolgálja ki a staff és
 * a portál felületet is.
 */

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Send } from 'lucide-react';

interface MessageComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** A hívó küldi az üzenetet (kiolvassa az értéket, POST-ol, törli a mezőt). */
  onSend: () => void;
  sending?: boolean;
  disabled?: boolean;
  placeholder?: string;

  /** Reply-mód csík a beviteli sor fölött (pl. `<ReplyComposerBar/>`). */
  replyBar?: ReactNode;
  /** Függő kontextus-linkek csíkja (pl. `<PendingContextLinksBar/>`). */
  pendingBar?: ReactNode;
  /** Vezető csatolás-gombok (dokumentum / kontextus-link). */
  attachSlot?: ReactNode;

  /** Enter küldjön (Shift+Enter mindig új sor). Mobilon érdemes `false`. Alap: true. */
  sendOnEnter?: boolean;
  /** Esc lenyomása a mezőben (pl. reply-mód lemondása). */
  onEscape?: () => void;
  /**
   * Ha változik, a textarea automatikusan fókuszt kap (pl. beszélgetésváltáskor
   * a kiválasztott azonosító). `null` → nincs auto-fókusz.
   */
  autoFocusKey?: string | null;

  /** Külső textarea-ref (pl. @mention dropdown-pozícionáláshoz). */
  textareaRef?: RefObject<HTMLTextAreaElement>;
  /** Kurzorpozíció-változás jelentése (pl. @mention kiváltásához). */
  onCursorChange?: (position: number) => void;
  /** Overlay a beviteli mező fölött (pl. `<PatientMention/>` dropdown). */
  overlay?: ReactNode;
}

const MAX_TEXTAREA_PX = 140;

export function MessageComposer({
  value,
  onChange,
  onSend,
  sending = false,
  disabled = false,
  placeholder = 'Írj üzenetet…',
  replyBar,
  pendingBar,
  attachSlot,
  sendOnEnter = true,
  onEscape,
  autoFocusKey,
  textareaRef: externalRef,
  onCursorChange,
  overlay,
}: MessageComposerProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalRef ?? internalRef;

  // Auto-növekvő magasság (max korláttal).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Fókusz beszélgetés megnyitásakor / váltásakor.
  useEffect(() => {
    if (autoFocusKey) textareaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocusKey]);

  const canSend = value.trim().length > 0 && !sending && !disabled;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      onEscape?.();
      return;
    }
    if (sendOnEnter && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <div
      className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {replyBar}
      {pendingBar}
      <div className="p-2 sm:p-3">
        <div className="flex items-end gap-1.5 bg-gray-100 dark:bg-gray-800 rounded-3xl pl-2 pr-1.5 py-1">
          {attachSlot && <div className="flex items-center gap-0.5 self-end">{attachSlot}</div>}
          <div className="flex-1 relative min-w-0">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                onChange(e.target.value);
                onCursorChange?.(e.target.selectionStart);
              }}
              onKeyDown={handleKeyDown}
              onSelect={(e) => onCursorChange?.((e.target as HTMLTextAreaElement).selectionStart)}
              rows={1}
              disabled={disabled}
              placeholder={placeholder}
              aria-label="Üzenet szövege"
              className="w-full resize-none bg-transparent border-0 focus:ring-0 focus:outline-none text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 py-2 max-h-[140px]"
            />
            {overlay}
          </div>
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            aria-label="Küldés"
            className="flex-shrink-0 w-9 h-9 rounded-full bg-medical-primary text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-medical-primary-dark transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-medical-primary focus-visible:ring-offset-2"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

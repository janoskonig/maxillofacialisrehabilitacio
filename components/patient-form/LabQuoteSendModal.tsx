'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Clock, Loader2, Mail, Paperclip, Plus, Send, X } from 'lucide-react';

const EMAIL_REGEX = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

export type LabQuoteRecipientSuggestion = {
  email: string;
  label: string | null;
  source: 'labor' | 'korabbi' | 'kollega';
};

export interface LabQuoteForSend {
  id: string;
  szoveg: string;
  datuma: string;
  lastEmailStatus?: 'sent' | 'failed' | null;
  lastEmailSentAt?: string | null;
  lastEmailSentBy?: string | null;
  lastEmailRecipient?: string | null;
  lastEmailCc?: string | null;
}

export interface LabQuoteSendResult {
  recipients: string[];
  sentAt: string;
  sentBy: string | null;
}

interface LabQuoteSendModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientId: string | null;
  patientName: string | null | undefined;
  quote: LabQuoteForSend | null;
  onSent: (quoteId: string, result: LabQuoteSendResult) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => string;
}

const SOURCE_LABEL: Record<LabQuoteRecipientSuggestion['source'], string> = {
  labor: 'labor',
  korabbi: 'korábbi címzett',
  kollega: 'munkatárs',
};

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function splitCc(cc: string | null | undefined): string[] {
  return (cc ?? '')
    .split(/[,;\s]+/)
    .map(normalizeEmail)
    .filter((email) => EMAIL_REGEX.test(email));
}

/**
 * Árajánlatkérő e-mail küldése választható címzett(ek)nek.
 * Alapból a beállított labor cím van kiválasztva; javaslatként a korábbi címzettek
 * és a munkatársak jelennek meg, de bármilyen e-mail cím szabadon beírható.
 * Az első cím a levél címzettje, a többi másolatot kap.
 */
export function LabQuoteSendModal({
  isOpen,
  onClose,
  patientId,
  patientName,
  quote,
  onSent,
  showToast,
}: LabQuoteSendModalProps) {
  const [suggestions, setSuggestions] = useState<LabQuoteRecipientSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [sending, setSending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Megnyitáskor: javaslatok betöltése, a labor alapértelmezett címe előre kiválasztva.
  useEffect(() => {
    if (!isOpen) {
      setSelected([]);
      setQ('');
      setOpen(false);
      setSuggestions([]);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch('/api/lab-quote-recipients', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`status_${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const list: LabQuoteRecipientSuggestion[] = Array.isArray(data?.suggestions) ? data.suggestions : [];
        setSuggestions(list);
        const defaultTo = typeof data?.defaultTo === 'string' ? normalizeEmail(data.defaultTo) : '';
        setSelected(defaultTo && EMAIL_REGEX.test(defaultTo) ? [defaultTo] : []);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('Nem sikerült betölteni a címzett-javaslatokat. Címet kézzel is megadhatsz.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const available = suggestions.filter((s) => !selectedSet.has(s.email));
    const needle = q.trim().toLowerCase();
    if (!needle) return available.slice(0, 50);
    return available
      .filter((s) => s.email.includes(needle) || (s.label ?? '').toLowerCase().includes(needle))
      .slice(0, 50);
  }, [suggestions, selectedSet, q]);

  /** A beírt szöveg érvényes, még nem kiválasztott e-mail cím? */
  const queryAsEmailCandidate = useMemo(() => {
    const t = normalizeEmail(q);
    if (!t || !EMAIL_REGEX.test(t) || selectedSet.has(t)) return null;
    return t;
  }, [q, selectedSet]);

  const quickPicks = useMemo(
    () => suggestions.filter((s) => s.source !== 'kollega' && !selectedSet.has(s.email)).slice(0, 6),
    [suggestions, selectedSet]
  );

  const lastRecipients = useMemo(() => {
    if (!quote?.lastEmailRecipient) return [] as string[];
    return Array.from(new Set([normalizeEmail(quote.lastEmailRecipient), ...splitCc(quote.lastEmailCc)]));
  }, [quote]);

  const optionCount = filtered.length + (queryAsEmailCandidate ? 1 : 0);

  useEffect(() => {
    setHighlight(0);
  }, [q, filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (rawEmail: string) => {
    const email = normalizeEmail(rawEmail);
    if (!email || !EMAIL_REGEX.test(email)) return;
    setSelected((prev) => (prev.includes(email) ? prev : [...prev, email]));
    setQ('');
    setOpen(false);
  };

  const remove = (email: string) => {
    setSelected((prev) => prev.filter((e) => e !== email));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (e.key === 'Enter') {
      // Ne küldje el a beteg űrlapot; Enter = kiválasztás / hozzáadás.
      e.preventDefault();
      if (open && highlight < filtered.length && (q.trim() || filtered.length > 0)) {
        pick(filtered[highlight].email);
      } else if (queryAsEmailCandidate) {
        pick(queryAsEmailCandidate);
      }
      return;
    }
    if (e.key === 'Backspace' && !q && selected.length > 0) {
      setSelected((prev) => prev.slice(0, -1));
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(0, optionCount - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    }
  };

  const handleSend = async () => {
    if (!quote || !patientId || selected.length === 0 || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/patients/${patientId}/lab-quote-requests/${quote.id}/send-email`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast((data as { error?: string })?.error || 'Email küldési hiba', 'error');
        return;
      }
      const recipients: string[] =
        Array.isArray(data?.recipients) && data.recipients.length > 0 ? data.recipients : selected;
      showToast(`Email elküldve: ${recipients.join(', ')}`, 'success');
      onSent(quote.id, {
        recipients,
        sentAt: data?.emailLog?.sentAt ?? new Date().toISOString(),
        sentBy: data?.emailLog?.sentBy ?? null,
      });
      onClose();
    } catch {
      showToast('Hálózati hiba a küldéskor', 'error');
    } finally {
      setSending(false);
    }
  };

  if (!isOpen || !quote) return null;

  const deadline = quote.datuma ? new Date(quote.datuma).toLocaleDateString('hu-HU') : null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-soft-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lab-quote-send-title"
      >
        <div className="border-b dark:border-gray-800 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Send className="w-5 h-5 text-blue-600 dark:text-blue-300" />
            <h2 id="lab-quote-send-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Árajánlatkérő küldése e-mailben
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Bezárás"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="rounded-md border border-blue-100 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/40 px-3 py-2 space-y-1">
            <p className="text-xs text-blue-900/70 dark:text-blue-300">Beteg</p>
            <p className="text-sm font-medium text-blue-950 dark:text-blue-200 truncate">
              {patientName || 'Ismeretlen beteg'}
            </p>
            <p className="text-xs text-blue-900/70 dark:text-blue-300 flex items-center gap-1">
              <Paperclip className="w-3 h-3 shrink-0" />
              Melléklet: árajánlatkérő PDF{deadline ? ` · határidő: ${deadline}` : ''}
            </p>
          </div>

          {quote.lastEmailStatus === 'sent' && quote.lastEmailSentAt && (
            <div className="text-xs text-gray-600 dark:text-gray-400 flex flex-wrap items-center gap-x-2 gap-y-1">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>
                Utoljára elküldve: {new Date(quote.lastEmailSentAt).toLocaleString('hu-HU')}
                {quote.lastEmailRecipient ? ` → ${quote.lastEmailRecipient}` : ''}
                {quote.lastEmailCc ? ` (másolat: ${quote.lastEmailCc})` : ''}
              </span>
              {lastRecipients.length > 0 && (
                <button
                  type="button"
                  className="text-blue-700 dark:text-blue-300 hover:underline"
                  onClick={() => setSelected(lastRecipients)}
                >
                  Ugyanoda újra
                </button>
              )}
            </div>
          )}

          <div ref={rootRef} className="relative space-y-2">
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Címzett(ek)</label>
            <div className="flex flex-wrap gap-1.5 items-center min-h-[42px] p-2 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-200">
              {selected.map((email) => {
                const suggestion = suggestions.find((s) => s.email === email);
                return (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1 max-w-full rounded-full border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 pl-2 pr-0.5 py-0.5 text-xs text-blue-900 dark:text-blue-200"
                    title={email}
                  >
                    <Mail className="w-3 h-3 shrink-0" />
                    <span className="truncate max-w-[260px]">
                      {suggestion?.label ? `${suggestion.label} · ${email}` : email}
                    </span>
                    <button
                      type="button"
                      className="rounded-full px-1 leading-none text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                      onClick={() => remove(email)}
                      aria-label={`${email} eltávolítása`}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              <input
                type="text"
                className="flex-1 min-w-[8rem] border-0 bg-transparent p-1 text-sm outline-none focus:ring-0 placeholder:text-gray-400 dark:placeholder:text-gray-500 dark:text-gray-100"
                placeholder={loading ? 'Javaslatok betöltése…' : 'Név vagy e-mail cím… (Enter: hozzáadás)'}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={onKeyDown}
                autoComplete="off"
                aria-label="Címzett hozzáadása"
              />
            </div>
            {open && (
              <ul className="absolute z-30 left-0 right-0 mt-0.5 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-1 shadow-lg max-h-72 overflow-auto">
                {loading ? (
                  <li className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Javaslatok betöltése…
                  </li>
                ) : optionCount === 0 ? (
                  <li className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                    {q.trim()
                      ? 'Nincs egyező javaslat. Írj be egy teljes e-mail címet, és nyomj Entert.'
                      : 'Kezdj gépelni, vagy válassz a listából.'}
                  </li>
                ) : (
                  <>
                    {filtered.map((s, i) => (
                      <li key={s.email}>
                        <button
                          type="button"
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                            i === highlight ? 'bg-gray-50 dark:bg-gray-800/60' : ''
                          }`}
                          onMouseEnter={() => setHighlight(i)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pick(s.email)}
                        >
                          <span className="block truncate text-gray-900 dark:text-gray-100">{s.label ?? s.email}</span>
                          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                            {s.label ? `${s.email} · ` : ''}
                            {SOURCE_LABEL[s.source]}
                          </span>
                        </button>
                      </li>
                    ))}
                    {queryAsEmailCandidate && (
                      <li>
                        <button
                          type="button"
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                            highlight === filtered.length ? 'bg-gray-50 dark:bg-gray-800/60' : ''
                          }`}
                          onMouseEnter={() => setHighlight(filtered.length)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pick(queryAsEmailCandidate)}
                        >
                          <span className="inline-flex items-center gap-1 text-gray-900 dark:text-gray-100">
                            <Plus className="w-3.5 h-3.5" />
                            Új cím hozzáadása: {queryAsEmailCandidate}
                          </span>
                        </button>
                      </li>
                    )}
                  </>
                )}
              </ul>
            )}
            {loadError && <p className="text-xs text-amber-700 dark:text-amber-300">{loadError}</p>}
            {quickPicks.length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs text-gray-500 dark:text-gray-400">Gyors választás:</span>
                {quickPicks.map((s) => (
                  <button
                    key={s.email}
                    type="button"
                    onClick={() => pick(s.email)}
                    className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-2 py-0.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                    title={s.email}
                  >
                    <Plus className="w-3 h-3" />
                    {s.label ?? s.email}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Az első cím a levél címzettje, a többi másolatot kap. Bármilyen e-mail cím megadható, pl. a főnővéré.
            </p>
          </div>
        </div>

        <div className="border-t dark:border-gray-800 px-5 py-3 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary text-sm" disabled={sending}>
            Mégse
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || selected.length === 0}
            className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {selected.length > 1 ? `Küldés (${selected.length} címzett)` : 'Küldés'}
          </button>
        </div>
      </div>
    </div>
  );
}

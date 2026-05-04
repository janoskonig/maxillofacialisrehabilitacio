'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Loader2, Mail, Send, Users, X } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

type DirectoryUser = {
  id: string;
  email: string;
  name: string | null;
  intezmeny: string | null;
};

type SelectedRecipient =
  | { kind: 'user'; id: string; displayName: string; email: string; intezmeny: string | null }
  | { kind: 'email'; email: string };

interface SendConsiliumPrepLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  itemId: string;
  patientName: string;
  /** Saját felhasználói azonosító — ne lehessen önmagunknak küldeni. */
  currentUserId?: string;
  /** Saját email — szűréshez (ne küldjük magunknak). */
  currentEmail?: string;
}

const NOTE_MAX = 1000;
const EMAIL_REGEX = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

function userDisplayName(u: { name: string | null; email: string }): string {
  return (u.name && u.name.trim()) || u.email;
}

function pickerMatches(u: DirectoryUser, needleRaw: string): boolean {
  const needle = needleRaw.trim().toLowerCase();
  if (!needle) return false;
  const name = userDisplayName(u).toLowerCase();
  const email = u.email.toLowerCase();
  const org = (u.intezmeny || '').trim().toLowerCase();
  if (email.includes(needle) || org.includes(needle) || name.includes(needle)) return true;
  return name.split(/\s+/).some((w) => w.length > 0 && w.startsWith(needle));
}

export function SendConsiliumPrepLinkModal({
  isOpen,
  onClose,
  sessionId,
  itemId,
  patientName,
  currentUserId,
  currentEmail,
}: SendConsiliumPrepLinkModalProps) {
  const { showToast } = useToast();
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedRecipient[]>([]);
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [sending, setSending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setUsersLoading(true);
    setUsersError(null);
    fetch('/api/users/doctors', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`status_${res.status}`);
        }
        const data = await res.json();
        const list: DirectoryUser[] = Array.isArray(data?.doctors)
          ? data.doctors.map((d: { id: string; email: string; name: string | null; intezmeny: string | null }) => ({
              id: d.id,
              email: d.email,
              name: d.name ?? null,
              intezmeny: d.intezmeny ?? null,
            }))
          : [];
        if (!cancelled) setUsers(list);
      })
      .catch(() => {
        if (!cancelled) {
          setUsers([]);
          setUsersError('Nem sikerült betölteni a felhasználói listát.');
        }
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSelected([]);
      setNote('');
      setQ('');
      setOpen(false);
    }
  }, [isOpen]);

  const eligibleUsers = useMemo(
    () => users.filter((u) => !currentUserId || u.id !== currentUserId),
    [users, currentUserId],
  );

  const selfEmailLower = (currentEmail || '').trim().toLowerCase();

  const filtered = useMemo(() => {
    const takenIds = new Set(
      selected.filter((s) => s.kind === 'user').map((s) => (s as { id: string }).id),
    );
    const takenEmails = new Set(
      selected
        .filter((s) => s.kind === 'email')
        .map((s) => (s as { email: string }).email.toLowerCase()),
    );
    const available = eligibleUsers.filter(
      (u) => !takenIds.has(u.id) && !takenEmails.has(u.email.toLowerCase()),
    );
    const t = q.trim();
    if (!t) return available.slice(0, 50);
    return available.filter((u) => pickerMatches(u, t)).slice(0, 50);
  }, [q, eligibleUsers, selected]);

  /** Az aktuális keresőkifejezés érvényes e-mail-cím, ami még nincs hozzáadva? */
  const queryAsEmailCandidate = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t || !EMAIL_REGEX.test(t)) return null;
    if (t === selfEmailLower) return null;
    const alreadySelectedEmail = selected.some(
      (s) =>
        (s.kind === 'email' && s.email.toLowerCase() === t) ||
        (s.kind === 'user' && s.email.toLowerCase() === t),
    );
    if (alreadySelectedEmail) return null;
    return t;
  }, [q, selected, selfEmailLower]);

  useEffect(() => {
    setHighlight(0);
  }, [q, eligibleUsers, selected]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pickUser = (u: DirectoryUser) => {
    setSelected((prev) =>
      prev.some((s) => s.kind === 'user' && s.id === u.id)
        ? prev
        : [
            ...prev,
            {
              kind: 'user',
              id: u.id,
              displayName: userDisplayName(u),
              email: u.email,
              intezmeny: u.intezmeny ?? null,
            },
          ],
    );
    setQ('');
    setOpen(false);
  };

  const pickEmail = (rawEmail: string) => {
    const email = rawEmail.trim().toLowerCase();
    if (!email || !EMAIL_REGEX.test(email)) return;
    if (email === selfEmailLower) return;
    setSelected((prev) =>
      prev.some(
        (s) =>
          (s.kind === 'email' && s.email === email) ||
          (s.kind === 'user' && s.email.toLowerCase() === email),
      )
        ? prev
        : [...prev, { kind: 'email', email }],
    );
    setQ('');
    setOpen(false);
  };

  const removeSelected = (idx: number) => {
    setSelected((prev) => prev.filter((_, i) => i !== idx));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open) {
        setOpen(false);
        e.preventDefault();
      }
      return;
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      if (filtered.length > 0 || queryAsEmailCandidate) {
        e.preventDefault();
        setOpen(true);
        if (e.key === 'Enter') {
          if (filtered.length > 0) {
            pickUser(filtered[0]);
          } else if (queryAsEmailCandidate) {
            pickEmail(queryAsEmailCandidate);
          }
        }
        return;
      }
    }
    if (!open || (filtered.length === 0 && !queryAsEmailCandidate)) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) =>
        Math.min(h + 1, Math.max(0, filtered.length - 1 + (queryAsEmailCandidate ? 1 : 0))),
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlight < filtered.length) {
        pickUser(filtered[highlight]);
      } else if (queryAsEmailCandidate) {
        pickEmail(queryAsEmailCandidate);
      }
    }
  };

  const handleSend = async () => {
    if (selected.length === 0 || sending) return;
    setSending(true);
    try {
      const recipientIds = selected
        .filter((s) => s.kind === 'user')
        .map((s) => (s as { id: string }).id);
      const recipientEmails = selected
        .filter((s) => s.kind === 'email')
        .map((s) => (s as { email: string }).email);

      const res = await fetch(
        `/api/consilium/sessions/${sessionId}/items/${itemId}/prep-link/share`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipientIds: recipientIds.length > 0 ? recipientIds : undefined,
            recipientEmails: recipientEmails.length > 0 ? recipientEmails : undefined,
            note: note.trim() ? note.trim() : undefined,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(
          (data as { error?: string })?.error || 'Küldés sikertelen',
          'error',
        );
        return;
      }
      const sentInApp: number = (data as { sentInAppCount?: number })?.sentInAppCount ?? 0;
      const sentEmail: number = (data as { sentEmailCount?: number })?.sentEmailCount ?? 0;
      if (sentInApp + sentEmail === 0) {
        showToast('Egy címzettnek sem sikerült kiküldeni', 'error');
        return;
      }
      const parts: string[] = [];
      if (sentInApp > 0) parts.push(`${sentInApp} üzenet a rendszerben`);
      if (sentEmail > 0) parts.push(`${sentEmail} e-mail kiküldve`);
      showToast(`Előkészítő link kiküldve — ${parts.join(' · ')}`, 'success');
      onClose();
    } catch {
      showToast('Hálózati hiba a küldéskor', 'error');
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-soft-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-cyan-700" />
            <h2 className="text-base font-semibold text-gray-900">
              Konzílium előkészítő küldése
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100"
            aria-label="Bezárás"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="rounded-md border border-cyan-100 bg-cyan-50/70 px-3 py-2">
            <p className="text-xs text-cyan-900/70">Beteg</p>
            <p className="text-sm font-medium text-cyan-950 truncate">
              {patientName || 'Ismeretlen beteg'}
            </p>
          </div>

          <div ref={rootRef} className="relative space-y-2">
            <label className="text-xs font-medium text-gray-700">Címzett(ek)</label>
            <div className="flex flex-wrap gap-1.5 items-center min-h-[42px] p-2 rounded-md border border-gray-200 bg-white focus-within:border-cyan-400 focus-within:ring-1 focus-within:ring-cyan-200">
              {selected.map((s, idx) => {
                if (s.kind === 'user') {
                  return (
                    <span
                      key={`u-${s.id}`}
                      className="inline-flex items-center gap-1 max-w-full rounded-full border border-cyan-200 bg-cyan-50 pl-2 pr-0.5 py-0.5 text-xs text-cyan-900"
                      title={s.email}
                    >
                      <span className="truncate max-w-[200px]">{s.displayName}</span>
                      <button
                        type="button"
                        className="rounded-full px-1 leading-none text-cyan-700 hover:bg-cyan-100"
                        onClick={() => removeSelected(idx)}
                        aria-label="Eltávolítás"
                      >
                        ×
                      </button>
                    </span>
                  );
                }
                return (
                  <span
                    key={`e-${s.email}`}
                    className="inline-flex items-center gap-1 max-w-full rounded-full border border-amber-200 bg-amber-50 pl-2 pr-0.5 py-0.5 text-xs text-amber-900"
                    title="Külső e-mail cím — csak e-mail értesítést kap"
                  >
                    <Mail className="w-3 h-3" />
                    <span className="truncate max-w-[200px]">{s.email}</span>
                    <button
                      type="button"
                      className="rounded-full px-1 leading-none text-amber-700 hover:bg-amber-100"
                      onClick={() => removeSelected(idx)}
                      aria-label="Eltávolítás"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              <input
                type="text"
                className="flex-1 min-w-[8rem] border-0 bg-transparent p-1 text-sm outline-none focus:ring-0 placeholder:text-gray-400"
                placeholder={
                  usersLoading
                    ? 'Felhasználók betöltése…'
                    : 'Kezdj gépelni: kolléga neve vagy e-mail címe…'
                }
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={onKeyDown}
              />
            </div>
            {open && (
              <ul className="absolute z-30 left-0 right-0 mt-0.5 max-w-lg rounded-md border border-gray-200 bg-white py-1 shadow-lg max-h-72 overflow-auto">
                {usersLoading ? (
                  <li className="px-3 py-2 text-xs text-gray-500 inline-flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Felhasználók betöltése…
                  </li>
                ) : usersError ? (
                  <li className="px-3 py-2 text-xs text-red-700 bg-red-50">{usersError}</li>
                ) : filtered.length === 0 && !queryAsEmailCandidate ? (
                  <li className="px-3 py-2 text-xs text-gray-500">
                    {q.trim()
                      ? 'Nincs egyező rendszer-felhasználó. Ha külső címzettnek küldenéd, írj be egy érvényes e-mail címet.'
                      : eligibleUsers.length === 0
                        ? 'Nincs választható kolléga.'
                        : 'Kezdj gépelni a szűkítéshez (vagy görgess a listában).'}
                  </li>
                ) : (
                  <>
                    {filtered.map((u, i) => {
                      const org = u.intezmeny?.trim();
                      return (
                        <li key={u.id}>
                          <button
                            type="button"
                            className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                              i === highlight ? 'bg-gray-50' : ''
                            }`}
                            onMouseEnter={() => setHighlight(i)}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pickUser(u)}
                          >
                            <span className="font-medium text-gray-900">{userDisplayName(u)}</span>
                            {org ? <span className="text-gray-500"> · {org}</span> : null}
                            <span className="block text-[11px] text-gray-500">{u.email}</span>
                          </button>
                        </li>
                      );
                    })}
                    {queryAsEmailCandidate && (
                      <li>
                        <button
                          type="button"
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-amber-50 border-t border-gray-100 inline-flex items-center gap-2 ${
                            highlight === filtered.length ? 'bg-amber-50' : ''
                          }`}
                          onMouseEnter={() => setHighlight(filtered.length)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickEmail(queryAsEmailCandidate)}
                        >
                          <Mail className="w-3.5 h-3.5 text-amber-700" />
                          <span className="font-medium text-amber-900">
                            E-mail küldése külső címre: {queryAsEmailCandidate}
                          </span>
                        </button>
                      </li>
                    )}
                  </>
                )}
              </ul>
            )}
            {usersError && (
              <p className="text-[11px] text-red-700">{usersError}</p>
            )}
            <p className="text-[11px] text-gray-500">
              Rendszerbe regisztrált kollégák a listából választhatók (üzenetet és e-mailt
              is kapnak). Külső címzettnek érvényes e-mail címet beírva küldhetsz —
              ők csak e-mailt kapnak.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">Üzenet (opcionális)</label>
            <textarea
              className="form-input w-full min-h-[80px] resize-y text-sm"
              placeholder="Pár szó a címzettnek (opcionális)…"
              value={note}
              maxLength={NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="text-[11px] text-gray-400 text-right">
              {note.length}/{NOTE_MAX}
            </p>
          </div>
        </div>

        <div className="border-t bg-gray-50 px-5 py-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-100 text-gray-700"
            disabled={sending}
          >
            Mégse
          </button>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || selected.length === 0}
            className="px-3 py-1.5 text-sm rounded-md bg-cyan-700 hover:bg-cyan-800 text-white inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {sending ? 'Küldés…' : 'Küldés'}
          </button>
        </div>
      </div>
    </div>
  );
}

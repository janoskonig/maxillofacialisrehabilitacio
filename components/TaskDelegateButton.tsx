'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { SendHorizontal, UserRound, X } from 'lucide-react';

type InstitutionUserRow = {
  id: string;
  email: string;
  doktorNeve: string | null;
  role: string;
  intezmeny?: string | null;
};

function userMatches(u: InstitutionUserRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return false;
  return (u.doktorNeve ?? '').toLowerCase().includes(s) || (u.email ?? '').toLowerCase().includes(s);
}

function formatUserOption(u: InstitutionUserRow): string {
  const n = (u.doktorNeve ?? '').trim();
  const inst = (u.intezmeny ?? '').trim();
  const base = n ? `${n} (${u.email})` : u.email;
  return inst ? `${base} — ${inst}` : base;
}

export interface TaskDelegateButtonProps {
  taskId: string;
  /** Sikeres delegálás után hívódik (a feladat eltűnik a saját listáról). */
  onDelegated: () => void;
}

/**
 * Egy meglévő, saját feladat átadása kollégának a Feladataim listáról.
 * Beágyazott címzett-kereső + küldés.
 */
export function TaskDelegateButton({ taskId, onDelegated }: TaskDelegateButtonProps) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<InstitutionUserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const usersFetched = useRef(false);

  const [input, setInput] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadUsers = useCallback(async () => {
    if (usersFetched.current) return;
    setUsersLoading(true);
    try {
      const res = await fetch('/api/consilium/institution-users', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setUsers((data.users ?? []) as InstitutionUserRow[]);
      usersFetched.current = true;
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const openPicker = () => {
    setOpen(true);
    setFeedback(null);
    void loadUsers();
  };

  const closePicker = () => {
    setOpen(false);
    setInput('');
    setAssigneeId('');
    setFeedback(null);
  };

  const suggestions = useMemo(() => {
    if (usersLoading || users.length === 0) return [];
    const q = input.trim();
    if (!q) return users.slice(0, 8);
    return users.filter((u) => userMatches(u, q)).slice(0, 12);
  }, [input, users, usersLoading]);

  const submit = async () => {
    setFeedback(null);
    if (!assigneeId) {
      setFeedback({ ok: false, msg: 'Válassz címzettet a listából.' });
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/user-tasks/${taskId}/delegate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigneeUserId: assigneeId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setFeedback({ ok: false, msg: typeof data.error === 'string' ? data.error : 'Sikertelen delegálás' });
        return;
      }
      onDelegated();
    } catch {
      setFeedback({ ok: false, msg: 'Hálózati hiba' });
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="mt-3 ml-2 text-sm btn-secondary px-3 py-1 inline-flex items-center gap-1.5"
        onClick={openPicker}
      >
        <UserRound className="w-4 h-4" />
        Delegálás
      </button>
    );
  }

  return (
    <div className="mt-3 rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Delegálás kollégának</span>
        <button type="button" className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400" onClick={closePicker} aria-label="Mégse">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="relative">
        <input
          type="text"
          className="form-input w-full text-sm py-1"
          placeholder={usersLoading ? 'Felhasználók betöltése…' : 'Címzett neve vagy e-mailje…'}
          value={input}
          disabled={usersLoading}
          autoComplete="off"
          onChange={(e) => {
            setInput(e.target.value);
            setAssigneeId('');
            setListOpen(true);
            setFeedback(null);
          }}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
            setListOpen(true);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setListOpen(false), 180);
          }}
        />
        {listOpen && input.trim().length > 0 && !usersLoading && (
          <ul className="absolute z-20 left-0 right-0 mt-0.5 max-h-40 overflow-auto rounded border border-gray-200 bg-white shadow text-sm">
            {suggestions.length === 0 ? (
              <li className="px-2 py-1.5 text-gray-500">Nincs találat</li>
            ) : (
              suggestions.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className="w-full text-left px-2 py-1.5 hover:bg-gray-50"
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => {
                      setAssigneeId(u.id);
                      setInput(formatUserOption(u));
                      setListOpen(false);
                      setFeedback(null);
                    }}
                  >
                    {formatUserOption(u)}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {feedback && (
        <p className={`text-sm mt-2 ${feedback.ok ? 'text-green-700' : 'text-red-700'}`}>{feedback.msg}</p>
      )}

      <button
        type="button"
        disabled={sending}
        onClick={() => void submit()}
        className="btn-primary inline-flex items-center gap-1.5 mt-2 disabled:opacity-50"
      >
        <SendHorizontal className="w-4 h-4" />
        {sending ? 'Küldés…' : 'Feladat küldése'}
      </button>
    </div>
  );
}

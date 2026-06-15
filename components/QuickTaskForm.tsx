'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Plus, SendHorizontal, UserRound } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';

type InstitutionUserRow = {
  id: string;
  email: string;
  doktorNeve: string | null;
  role: string;
  intezmeny?: string | null;
};

function institutionUserMatchesQuery(u: InstitutionUserRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return false;
  const name = (u.doktorNeve ?? '').toLowerCase();
  const email = (u.email ?? '').toLowerCase();
  return name.includes(s) || email.includes(s);
}

function formatUserOption(u: InstitutionUserRow): string {
  const n = (u.doktorNeve ?? '').trim();
  const inst = (u.intezmeny ?? '').trim();
  const base = n ? `${n} (${u.email})` : u.email;
  return inst ? `${base} — ${inst}` : base;
}

const DELEGATABLE_ROLES = ['admin', 'beutalo_orvos', 'fogpótlástanász'];

export interface QuickTaskFormProps {
  /** Ha meg van adva, a teendő ehhez a beteghez kötve jön létre. */
  patientId?: string;
  /** Sikeres létrehozás után hívódik (pl. lista frissítése). */
  onCreated?: (task: { id: string }) => void;
}

export function QuickTaskForm({ patientId, onCreated }: QuickTaskFormProps) {
  const [title, setTitle] = useState('');
  const [dueLocal, setDueLocal] = useState('');
  const [remind, setRemind] = useState(false);
  const [remindEmail, setRemindEmail] = useState(false);

  const [delegate, setDelegate] = useState(false);
  const [canDelegate, setCanDelegate] = useState(false);
  const [institutionUsers, setInstitutionUsers] = useState<InstitutionUserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const usersFetched = useRef(false);

  const [assigneeInput, setAssigneeInput] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    void getCurrentUser().then((u) => {
      setCanDelegate(!!u && DELEGATABLE_ROLES.includes(u.role));
    });
  }, []);

  const loadUsers = useCallback(async () => {
    if (usersFetched.current) return;
    setUsersLoading(true);
    try {
      const res = await fetch('/api/consilium/institution-users', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setInstitutionUsers((data.users ?? []) as InstitutionUserRow[]);
      usersFetched.current = true;
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (delegate) void loadUsers();
  }, [delegate, loadUsers]);

  const suggestions = useMemo(() => {
    if (usersLoading || institutionUsers.length === 0) return [];
    const q = assigneeInput.trim();
    if (!q) return institutionUsers.slice(0, 8);
    return institutionUsers.filter((u) => institutionUserMatchesQuery(u, q)).slice(0, 12);
  }, [assigneeInput, institutionUsers, usersLoading]);

  const pickUser = (u: InstitutionUserRow) => {
    setAssigneeId(u.id);
    setAssigneeInput(formatUserOption(u));
    setListOpen(false);
    setFeedback(null);
  };

  const reset = () => {
    setTitle('');
    setDueLocal('');
    setRemind(false);
    setRemindEmail(false);
    setAssigneeInput('');
    setAssigneeId('');
    setDelegate(false);
  };

  const submit = async () => {
    setFeedback(null);
    if (title.trim().length === 0) {
      setFeedback({ ok: false, msg: 'Írd be a teendőt.' });
      return;
    }
    if (delegate && !assigneeId) {
      setFeedback({ ok: false, msg: 'Válassz címzettet a listából.' });
      return;
    }

    const dueIso =
      dueLocal.trim().length > 0
        ? (() => {
            const d = new Date(dueLocal);
            return !Number.isNaN(d.getTime()) ? d.toISOString() : null;
          })()
        : null;

    const body: Record<string, unknown> = {
      title: title.trim(),
      ...(dueIso ? { dueAt: dueIso } : {}),
      ...(remind ? { remind: true } : {}),
      ...(remindEmail ? { remindEmail: true } : {}),
      ...(delegate && assigneeId ? { assigneeUserId: assigneeId } : {}),
      ...(patientId ? { patientId } : {}),
    };

    setSending(true);
    try {
      const res = await fetch('/api/user-tasks', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; task?: { id: string } };
      if (!res.ok) {
        setFeedback({ ok: false, msg: typeof data.error === 'string' ? data.error : 'Sikertelen mentés' });
        return;
      }
      setFeedback({
        ok: true,
        msg: delegate
          ? 'Feladat elküldve — a címzett Feladataim listáján jelenik meg.'
          : 'Teendő hozzáadva.',
      });
      const created = data.task;
      reset();
      if (created) onCreated?.(created);
    } catch {
      setFeedback({ ok: false, msg: 'Hálózati hiba' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2">
      <input
        type="text"
        className="form-input w-full"
        placeholder="Új teendő…"
        value={title}
        maxLength={500}
        onChange={(e) => {
          setTitle(e.target.value);
          setFeedback(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !delegate) {
            e.preventDefault();
            void submit();
          }
        }}
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-0.5">Határidő (opcionális)</label>
          <input
            type="datetime-local"
            className="form-input w-full text-sm py-1"
            value={dueLocal}
            onChange={(e) => setDueLocal(e.target.value)}
          />
        </div>
        <div className="space-y-1 sm:pt-6">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={remind}
              onChange={(e) => setRemind(e.target.checked)}
            />
            Push emlékeztető a határidő előtt
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={remindEmail}
              onChange={(e) => setRemindEmail(e.target.checked)}
            />
            Email emlékeztető a határidő előtt
          </label>
        </div>
      </div>
      {(remind || remindEmail) && dueLocal.trim().length === 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Az emlékeztetőhöz adj meg határidőt is.
        </p>
      )}

      {canDelegate && (
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={delegate}
            onChange={(e) => {
              setDelegate(e.target.checked);
              setAssigneeInput('');
              setAssigneeId('');
              setFeedback(null);
            }}
          />
          <UserRound className="w-4 h-4" />
          Delegálás kollégának
        </label>
      )}

      {delegate && (
        <div className="relative">
          <input
            type="text"
            className="form-input w-full text-sm py-1"
            placeholder={usersLoading ? 'Felhasználók betöltése…' : 'Címzett neve vagy e-mailje…'}
            value={assigneeInput}
            disabled={usersLoading}
            autoComplete="off"
            onChange={(e) => {
              setAssigneeInput(e.target.value);
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
          {listOpen && assigneeInput.trim().length > 0 && !usersLoading && (
            <ul className="absolute z-20 left-0 right-0 mt-0.5 max-h-40 overflow-auto rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow text-sm">
              {suggestions.length === 0 ? (
                <li className="px-2 py-1.5 text-gray-500 dark:text-gray-400">Nincs találat</li>
              ) : (
                suggestions.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      className="w-full text-left px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => pickUser(u)}
                    >
                      {formatUserOption(u)}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}

      {feedback && (
        <p className={`text-sm ${feedback.ok ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>{feedback.msg}</p>
      )}

      <button
        type="button"
        disabled={sending}
        onClick={() => void submit()}
        className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-50"
      >
        {delegate ? <SendHorizontal className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
        {sending ? 'Mentés…' : delegate ? 'Feladat küldése' : 'Hozzáadás'}
      </button>
    </div>
  );
}

'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { SendHorizontal, UserRound, ListPlus, Plus, Trash2 } from 'lucide-react';
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

type SplitLine = { id: string; label: string; assigneeInput: string; assigneeId: string };

function newSplitLine(): SplitLine {
  return { id: crypto.randomUUID(), label: '', assigneeInput: '', assigneeId: '' };
}

export interface WorkPhaseTaskDelegateBlockProps {
  episodeId: string;
  workPhaseId: string;
  phaseLabel: string;
  onClose: () => void;
  onDelegated?: () => void;
}

export function WorkPhaseTaskDelegateBlock({
  episodeId,
  workPhaseId,
  phaseLabel,
  onClose,
  onDelegated,
}: WorkPhaseTaskDelegateBlockProps) {
  const [mode, setMode] = useState<'staff' | 'external'>('staff');
  const [splitMode, setSplitMode] = useState(false);
  const [selfUserId, setSelfUserId] = useState('');
  const [userRole, setUserRole] = useState<string | null>(null);
  const [institutionUsers, setInstitutionUsers] = useState<InstitutionUserRow[]>([]);
  const [institutionUsersLoading, setInstitutionUsersLoading] = useState(false);
  const usersFetched = useRef(false);

  const [assigneeInput, setAssigneeInput] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [externalLabel, setExternalLabel] = useState('');
  const [taskOwnerUserId, setTaskOwnerUserId] = useState('');
  const [note, setNote] = useState('');
  const [dueLocal, setDueLocal] = useState('');
  const [splitLines, setSplitLines] = useState<SplitLine[]>(() => [newSplitLine(), newSplitLine()]);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadUsers = useCallback(async () => {
    if (usersFetched.current) return;
    setInstitutionUsersLoading(true);
    try {
      const res = await fetch('/api/consilium/institution-users', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setInstitutionUsers((data.users ?? []) as InstitutionUserRow[]);
      usersFetched.current = true;
    } finally {
      setInstitutionUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
    void getCurrentUser().then((u) => {
      setSelfUserId((u?.id ?? '').trim());
      setUserRole(u?.role ?? null);
    });
  }, [loadUsers]);

  useEffect(() => {
    if (mode === 'external' && selfUserId && !taskOwnerUserId) {
      setTaskOwnerUserId(selfUserId);
    }
  }, [mode, selfUserId, taskOwnerUserId]);

  const suggestions = useMemo(() => {
    if (institutionUsersLoading || institutionUsers.length === 0) return [];
    const q = assigneeInput.trim();
    if (!q) return institutionUsers.slice(0, 8);
    return institutionUsers.filter((u) => institutionUserMatchesQuery(u, q)).slice(0, 12);
  }, [assigneeInput, institutionUsers, institutionUsersLoading]);

  const pickUser = (u: InstitutionUserRow) => {
    setAssigneeId(u.id);
    setAssigneeInput(formatUserOption(u));
    setListOpen(false);
    setFeedback(null);
  };

  const clearBlurTimer = () => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
  };

  const updateSplitLine = (id: string, patch: Partial<SplitLine>) => {
    setSplitLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const send = async () => {
    setFeedback(null);
    const dueIso =
      dueLocal.trim().length > 0
        ? (() => {
            const d = new Date(dueLocal);
            return !Number.isNaN(d.getTime()) ? d.toISOString() : null;
          })()
        : null;

    const body: Record<string, unknown> = {
      mode,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(dueIso ? { dueAt: dueIso } : {}),
    };

    if (splitMode) {
      const items = splitLines
        .map((l) => ({
          label: l.label.trim(),
          ...(mode === 'staff' && l.assigneeId ? { assigneeUserId: l.assigneeId } : {}),
        }))
        .filter((i) => i.label.length > 0);
      if (items.length < 2) {
        setFeedback({ ok: false, msg: 'Felosztásnál legalább két kitöltött tétel kell.' });
        return;
      }
      body.splitItems = items;
      if (mode === 'staff') {
        if (!assigneeId && !items.every((i) => 'assigneeUserId' in i)) {
          setFeedback({
            ok: false,
            msg: 'Válassz alapértelmezett címzettet, vagy minden tételhez rendelj munkatársat.',
          });
          return;
        }
        if (assigneeId) body.assigneeUserId = assigneeId;
      } else {
        if (externalLabel.trim().length < 2) {
          setFeedback({ ok: false, msg: 'Írd le a külső címzettet.' });
          return;
        }
        body.externalAssigneeLabel = externalLabel.trim();
        body.taskOwnerUserId = (taskOwnerUserId || selfUserId).trim();
      }
    } else if (mode === 'staff') {
      if (!assigneeId) {
        setFeedback({ ok: false, msg: 'Válassz címzettet a listából.' });
        return;
      }
      body.assigneeUserId = assigneeId;
    } else {
      if (externalLabel.trim().length < 2) {
        setFeedback({ ok: false, msg: 'Írd le a külső címzettet.' });
        return;
      }
      body.externalAssigneeLabel = externalLabel.trim();
      body.taskOwnerUserId = (taskOwnerUserId || selfUserId).trim();
    }

    setSending(true);
    try {
      const res = await fetch(
        `/api/episodes/${episodeId}/work-phases/${workPhaseId}/delegate-task`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        tasks?: Array<{ id: string }>;
        split?: boolean;
      };
      if (!res.ok) {
        setFeedback({
          ok: false,
          msg: typeof data.error === 'string' ? data.error : 'Sikertelen küldés',
        });
        return;
      }
      const n = data.tasks?.length ?? 1;
      setFeedback({
        ok: true,
        msg:
          data.split || n > 1
            ? `${n} feladat elküldve — a címzettek Feladataim listáján jelennek meg.`
            : 'Feladat elküldve — a címzett Feladataim listáján jelenik meg.',
      });
      setNote('');
      setDueLocal('');
      onDelegated?.();
    } catch {
      setFeedback({ ok: false, msg: 'Hálózati hiba' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-2 p-2 rounded border border-indigo-200/80 bg-indigo-50/40 text-xs space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-indigo-900 flex items-center gap-1">
          <SendHorizontal className="w-3.5 h-3.5" />
          Feladat: {phaseLabel}
        </span>
        <button type="button" onClick={onClose} className="text-indigo-700 underline">
          Bezár
        </button>
      </div>

      {userRole === 'admin' && (
        <p className="text-[10px] text-indigo-800/80">
          Admin: feladat kiosztható bármely aktív, nem technikus felhasználónak (intézménytől függetlenül).
        </p>
      )}

      <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium text-indigo-900">
        <input
          type="checkbox"
          checked={splitMode}
          onChange={(e) => {
            setSplitMode(e.target.checked);
            setFeedback(null);
            if (e.target.checked && splitLines.length < 2) {
              setSplitLines([newSplitLine(), newSplitLine()]);
            }
          }}
        />
        <ListPlus className="w-3.5 h-3.5" />
        Felosztás részletes listára
      </label>

      <div className="flex flex-wrap gap-2">
        <label className="inline-flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name={`wp-deleg-mode-${workPhaseId}`}
            checked={mode === 'staff'}
            onChange={() => {
              setMode('staff');
              setFeedback(null);
            }}
          />
          Rendezőben lévő orvos / munkatárs
        </label>
        <label className="inline-flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name={`wp-deleg-mode-${workPhaseId}`}
            checked={mode === 'external'}
            onChange={() => {
              setMode('external');
              setFeedback(null);
              setTaskOwnerUserId((prev) => prev || selfUserId);
            }}
          />
          Külső (nincs belépése)
        </label>
      </div>

      {splitMode ? (
        <div className="space-y-2 rounded border border-indigo-100 bg-white/60 p-2">
          <p className="text-[10px] text-gray-600">
            Minden sor külön Feladataim tétel lesz (pl. implantációs kütyük tételenként).
          </p>
          {splitLines.map((line, idx) => (
            <div key={line.id} className="flex flex-col gap-1 border-b border-gray-100 pb-2 last:border-0">
              <div className="flex gap-1 items-start">
                <span className="text-[10px] text-gray-400 pt-1.5 w-4 shrink-0">{idx + 1}.</span>
                <input
                  type="text"
                  className="form-input text-xs py-1 flex-1"
                  placeholder="Tétel leírása (pl. csavar típus A)"
                  value={line.label}
                  onChange={(e) => updateSplitLine(line.id, { label: e.target.value })}
                />
                {splitLines.length > 2 && (
                  <button
                    type="button"
                    className="p-1 text-red-600 hover:bg-red-50 rounded"
                    title="Tétel törlése"
                    onClick={() => setSplitLines((prev) => prev.filter((l) => l.id !== line.id))}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {mode === 'staff' && (
                <input
                  type="text"
                  className="form-input text-xs py-1 ml-5"
                  placeholder="Opcionális címzett (üres → alapértelmezett)"
                  value={line.assigneeInput}
                  list={`wp-split-users-${workPhaseId}`}
                  onChange={(e) => {
                    const v = e.target.value;
                    updateSplitLine(line.id, { assigneeInput: v, assigneeId: '' });
                    const hit = institutionUsers.find((u) => formatUserOption(u) === v);
                    if (hit) updateSplitLine(line.id, { assigneeId: hit.id });
                  }}
                />
              )}
            </div>
          ))}
          <button
            type="button"
            className="inline-flex items-center gap-1 text-indigo-700 hover:underline"
            onClick={() => setSplitLines((prev) => [...prev, newSplitLine()])}
          >
            <Plus className="w-3 h-3" />
            Tétel hozzáadása
          </button>
          <datalist id={`wp-split-users-${workPhaseId}`}>
            {institutionUsers.map((u) => (
              <option key={u.id} value={formatUserOption(u)} />
            ))}
          </datalist>
        </div>
      ) : null}

      {mode === 'staff' && (!splitMode || splitMode) ? (
        <div className="relative space-y-1">
          <label className="block text-[11px] text-gray-600">
            {splitMode ? 'Alapértelmezett címzett (opcionális, ha minden sorhoz külön van)' : 'Címzett'}
          </label>
          <input
            type="text"
            className="form-input text-xs py-1 w-full"
            placeholder={institutionUsersLoading ? 'Felhasználók betöltése…' : 'Név vagy e-mail…'}
            value={assigneeInput}
            disabled={institutionUsersLoading}
            onChange={(e) => {
              setAssigneeInput(e.target.value);
              setAssigneeId('');
              setListOpen(true);
              setFeedback(null);
            }}
            onFocus={() => {
              clearBlurTimer();
              setListOpen(true);
            }}
            onBlur={() => {
              blurTimer.current = setTimeout(() => setListOpen(false), 180);
            }}
            autoComplete="off"
          />
          {listOpen && assigneeInput.trim().length > 0 && !institutionUsersLoading && (
            <ul className="absolute z-20 left-0 right-0 mt-0.5 max-h-36 overflow-auto rounded border border-gray-200 bg-white shadow text-[11px]">
              {suggestions.length === 0 ? (
                <li className="px-2 py-1.5 text-gray-500">Nincs találat</li>
              ) : (
                suggestions.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      className="w-full text-left px-2 py-1.5 hover:bg-gray-50"
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
      ) : mode === 'external' ? (
        <div className="space-y-2">
          <div>
            <label className="block text-[11px] text-gray-600 mb-0.5">Külső címzett / kapcsolat</label>
            <textarea
              className="form-input text-xs py-1 w-full min-h-[48px]"
              rows={2}
              placeholder="Pl. labor / beszállító, elérhetőség"
              value={externalLabel}
              onChange={(e) => setExternalLabel(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11px] text-gray-600 mb-0.5 flex items-center gap-1">
              <UserRound className="w-3 h-3" />
              Kinél maradjon a feladat a Feladataim listán
            </label>
            <select
              className="form-input text-xs py-1 w-full"
              value={taskOwnerUserId}
              disabled={institutionUsersLoading || institutionUsers.length === 0}
              onChange={(e) => setTaskOwnerUserId(e.target.value)}
            >
              {institutionUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {formatUserOption(u)}
                  {u.id === selfUserId ? ' (te)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="block text-[11px] text-gray-600 mb-0.5">Megjegyzés (opcionális)</label>
          <textarea
            className="form-input text-xs py-1 w-full min-h-[40px]"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-[11px] text-gray-600 mb-0.5">Határidő (opcionális)</label>
          <input
            type="datetime-local"
            className="form-input text-xs py-1 w-full"
            value={dueLocal}
            onChange={(e) => setDueLocal(e.target.value)}
          />
        </div>
      </div>

      {feedback && (
        <p className={feedback.ok ? 'text-green-700' : 'text-red-700'}>{feedback.msg}</p>
      )}

      <button
        type="button"
        disabled={sending}
        onClick={() => void send()}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
      >
        <SendHorizontal className="w-3.5 h-3.5" />
        {sending ? 'Küldés…' : splitMode ? 'Feladatok küldése' : 'Feladat küldése'}
      </button>
    </div>
  );
}

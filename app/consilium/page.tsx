'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowLeft, ArrowUp, CalendarClock, Mail, Plus, Presentation, Send, Trash2, Users } from 'lucide-react';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { MobileBottomNav } from '@/components/mobile/MobileBottomNav';
import { SendConsiliumPrepLinkModal } from '@/components/SendConsiliumPrepLinkModal';
import { useToast } from '@/contexts/ToastContext';
import type { ConsiliumPresentationItem } from '@/lib/consilium-presentation';
import {
  type ConsiliumPrepCommentSnapshot,
  formatConsiliumHuDateTime,
  orphanPrepCommentsByKey,
  prepCommentsGroupedByKey,
} from '@/lib/consilium-view-helpers';

type SessionSummary = {
  id: string;
  title: string;
  scheduledAt: string;
  status: 'draft' | 'active' | 'closed';
  itemCount: number;
  discussedCount: number;
  openCount: number;
};

type SessionAttendee = { id: string; name: string; present: boolean };

type InvitationStatusRow = {
  id: string;
  attendeeId: string;
  attendeeName: string;
  attendeeEmail: string;
  sentAt: string | null;
  revokedAt: string | null;
  respondedAt: string | null;
  response: 'going' | 'late' | 'reschedule' | null;
  proposedAt: string | null;
  proposedNote: string | null;
};

function rsvpResponseLabelHu(r: InvitationStatusRow['response']): string {
  if (r === 'going') return 'Ott leszek';
  if (r === 'late') return 'Kések';
  if (r === 'reschedule') return 'Máskor lenne jó';
  return 'Még nem válaszolt';
}

function rsvpResponseBadgeClass(r: InvitationStatusRow['response']): string {
  if (r === 'going') return 'bg-emerald-100 text-emerald-900 border-emerald-200';
  if (r === 'late') return 'bg-amber-100 text-amber-900 border-amber-200';
  if (r === 'reschedule') return 'bg-indigo-100 text-indigo-900 border-indigo-200';
  return 'bg-gray-100 text-gray-700 border-gray-200';
}

type PatientHit = {
  id: string;
  nev?: string | null;
  taj?: string | null;
};

type InstitutionUserRow = {
  id: string;
  email: string;
  doktorNeve: string | null;
  role: string;
  intezmeny?: string | null;
};

function institutionUserDisplayName(u: { doktorNeve: string | null; email: string }) {
  const n = u.doktorNeve?.trim();
  return n || u.email;
}

function institutionRoleShortHu(role: string) {
  switch (role) {
    case 'beutalo_orvos':
      return 'beutaló orvos';
    case 'fogpótlástanász':
      return 'fogpótlástanász';
    case 'technikus':
      return 'technikus';
    case 'admin':
      return 'admin';
    default:
      return role;
  }
}

function delegatedTaskStatusRank(status: string): number {
  if (status === 'open') return 0;
  if (status === 'done') return 1;
  return 2;
}

function delegatedTaskStatusLabelHu(status: string): string {
  if (status === 'open') return 'Nyitott';
  if (status === 'done') return 'Kész';
  if (status === 'cancelled') return 'Visszavonva';
  return status;
}

function canCancelDelegatedTask(
  task: { status: string; assigneeUserId: string; createdByUserId?: string | null },
  userId: string | undefined,
  role: string | undefined,
): boolean {
  if (task.status !== 'open' || !userId) return false;
  if (role === 'admin') return true;
  if (task.assigneeUserId === userId) return true;
  if (task.createdByUserId && task.createdByUserId === userId) return true;
  return false;
}

function attendeePickerMatches(u: InstitutionUserRow, needleRaw: string): boolean {
  const needle = needleRaw.trim().toLowerCase();
  if (!needle) return false;
  const name = institutionUserDisplayName(u).toLowerCase();
  const email = u.email.toLowerCase();
  const org = (u.intezmeny || '').trim().toLowerCase();
  if (email.includes(needle) || org.includes(needle) || name.includes(needle)) return true;
  return name.split(/\s+/).some((w) => w.length > 0 && w.startsWith(needle));
}

function ConsiliumAttendeeTagField({
  attendees,
  readonly,
  availableUsers,
  usersLoading,
  onChange,
}: {
  attendees: SessionAttendee[];
  readonly: boolean;
  availableUsers: InstitutionUserRow[];
  usersLoading: boolean;
  onChange: (next: SessionAttendee[]) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const t = q.trim();
    if (!t) return [];
    return availableUsers.filter((u) => attendeePickerMatches(u, t)).slice(0, 30);
  }, [q, availableUsers]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [q, availableUsers]);

  const pick = (row: InstitutionUserRow) => {
    const name = institutionUserDisplayName(row);
    onChange([...attendees, { id: row.id, name, present: true }]);
    setQ('');
    setOpen(false);
  };

  const remove = (id: string) => {
    onChange(attendees.filter((a) => a.id !== id));
  };

  const togglePresent = (id: string) => {
    onChange(attendees.map((a) => (a.id === id ? { ...a, present: !a.present } : a)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open) {
        setOpen(false);
        e.preventDefault();
      }
      return;
    }
    if (!q.trim()) return;
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter') && filtered.length > 0) {
      e.preventDefault();
      setOpen(true);
      if (e.key === 'Enter') pick(filtered[0]);
      return;
    }
    if (!open || filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(filtered[highlight]);
    }
  };

  if (usersLoading && attendees.length === 0 && availableUsers.length === 0) {
    return <p className="text-xs text-gray-500">Felhasználók betöltése…</p>;
  }

  return (
    <div ref={rootRef} className="relative space-y-2">
      <label className="text-[10px] text-gray-500 uppercase tracking-wide">Jelenlévők</label>
      <div
        className={`flex flex-wrap gap-1.5 items-center min-h-[42px] p-2 rounded-md border border-gray-200 bg-white ${
          readonly ? '' : 'focus-within:border-medical-primary/40 focus-within:ring-1 focus-within:ring-medical-primary/20'
        }`}
      >
        {attendees.map((a) => (
          <span
            key={a.id}
            className="inline-flex items-center gap-1 max-w-full rounded-full border border-gray-200 bg-medical-primary/5 pl-1.5 pr-0.5 py-0.5 text-xs text-gray-800"
          >
            {!readonly ? (
              <input
                type="checkbox"
                checked={a.present}
                onChange={() => togglePresent(a.id)}
                className="rounded border-gray-300 shrink-0"
                title="Jelen van"
              />
            ) : (
              <span className="text-[10px] text-gray-500 shrink-0 w-4 text-center" title="Jelenlét">
                {a.present ? '✓' : '○'}
              </span>
            )}
            <span className="truncate max-w-[220px]" title={a.name}>
              {a.name}
            </span>
            {!readonly && (
              <button
                type="button"
                className="shrink-0 rounded-full px-1 leading-none text-gray-500 hover:bg-red-50 hover:text-red-700"
                aria-label="Eltávolítás"
                onClick={() => remove(a.id)}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!readonly && (
          <input
            type="text"
            className="flex-1 min-w-[8rem] border-0 bg-transparent p-1 text-sm outline-none focus:ring-0 placeholder:text-gray-400"
            placeholder={
              availableUsers.length === 0 ? 'Minden felhasználó már a listán' : 'Kezdőbetűk, név vagy e-mail…'
            }
            value={q}
            disabled={availableUsers.length === 0}
            onChange={(e) => {
              const v = e.target.value;
              setQ(v);
              setOpen(!!v.trim());
            }}
            onFocus={() => {
              if (q.trim()) setOpen(true);
            }}
            onKeyDown={onKeyDown}
          />
        )}
      </div>
      {!readonly && open && q.trim() && (
        <ul className="absolute z-30 left-0 right-0 mt-0.5 max-w-lg rounded-md border border-gray-200 bg-white py-1 shadow-lg max-h-52 overflow-auto">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-gray-500">Nincs találat — próbálj más betűket.</li>
          ) : (
            filtered.map((u, i) => {
              const org = u.intezmeny?.trim();
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${i === highlight ? 'bg-gray-50' : ''}`}
                    onMouseEnter={() => setHighlight(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(u)}
                  >
                    <span className="font-medium text-gray-900">{institutionUserDisplayName(u)}</span>
                    <span className="text-gray-500">
                      {' '}
                      ({institutionRoleShortHu(u.role)}
                      {org ? ` · ${org}` : ''})
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

type ChecklistEntryRow = {
  key: string;
  label: string;
  checked?: boolean;
  response?: string | null;
  respondedAt?: string | null;
  respondedBy?: string | null;
  delegatedTasks?: Array<{
    id: string;
    title: string;
    status: string;
    assigneeUserId: string;
    assigneeName: string;
    createdByUserId?: string | null;
    createdByName?: string | null;
    note?: string | null;
    createdAt: string;
    completedAt?: string | null;
    dueAt?: string | null;
  }>;
};

function ConsiliumItemPrepCommentsReadonly({
  checklist,
  prepComments,
}: {
  checklist: ChecklistEntryRow[];
  prepComments?: ConsiliumPrepCommentSnapshot[] | null;
}) {
  const byKey = useMemo(() => prepCommentsGroupedByKey(prepComments), [prepComments]);
  const checklistKeySet = useMemo(() => new Set(checklist.map((c) => c.key)), [checklist]);
  const orphanByKey = useMemo(
    () => orphanPrepCommentsByKey(prepComments, checklistKeySet),
    [prepComments, checklistKeySet],
  );

  const keysWithComments = checklist.filter((row) => (byKey.get(row.key) ?? []).length > 0);

  const hasAny = (prepComments?.length ?? 0) > 0;

  return (
    <div className="rounded-lg border border-cyan-200 bg-gradient-to-b from-cyan-50/90 to-white px-3 py-2.5 space-y-2">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-900/85">Előkészítő megjegyzések</p>
        <p className="text-[11px] text-cyan-800/55 mt-0.5">
          Linken írt hozzászólások — az élő ülésen rögzített verdiktet nem váltják ki.
        </p>
      </div>
      {!hasAny ? (
        <p className="text-xs text-cyan-800/45">Még nincs előkészítő hozzászólás.</p>
      ) : (
        <div className="space-y-3">
          {keysWithComments.map((row) => {
            const list = byKey.get(row.key) ?? [];
            return (
              <div key={row.key} className="border-b border-cyan-100 pb-2 last:border-0 last:pb-0 space-y-1.5">
                <p className="text-xs font-medium text-cyan-950">{row.label}</p>
                <ul className="space-y-1.5">
                  {list.map((cm) => (
                    <li
                      key={cm.id}
                      className="text-xs text-gray-800 bg-white border border-cyan-100/80 rounded-md px-2 py-1.5 shadow-sm"
                    >
                      <span className="text-[10px] text-cyan-700/75">
                        {formatConsiliumHuDateTime(cm.createdAt)} · {cm.authorDisplay}
                      </span>
                      <p className="whitespace-pre-wrap mt-0.5 leading-snug">{cm.body}</p>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {Array.from(orphanByKey.entries()).map(([key, list]) => (
            <div key={`orphan-${key}`} className="border-b border-amber-100 pb-2 last:border-0 space-y-1.5">
              <p className="text-xs font-medium text-amber-900">
                Törölt vagy átnevezett pont <span className="font-mono text-[10px] opacity-70">({key})</span>
              </p>
              <ul className="space-y-1.5">
                {list.map((cm) => (
                  <li
                    key={cm.id}
                    className="text-xs text-gray-800 bg-amber-50/80 border border-amber-100 rounded-md px-2 py-1.5"
                  >
                    <span className="text-[10px] text-amber-800/70">
                      {formatConsiliumHuDateTime(cm.createdAt)} · {cm.authorDisplay}
                    </span>
                    <p className="whitespace-pre-wrap mt-0.5 leading-snug">{cm.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConsiliumItemChecklist({
  sessionId,
  itemId,
  entries,
  readonly,
  onRefresh,
  showToast,
  staffUserId,
  staffRole,
}: {
  sessionId: string;
  itemId: string;
  entries: ChecklistEntryRow[];
  readonly: boolean;
  onRefresh: () => void;
  showToast: (msg: string, type?: 'error' | 'success') => void;
  staffUserId?: string;
  staffRole?: string;
}) {
  const [newLabel, setNewLabel] = useState('');

  const addPoint = async () => {
    const label = newLabel.trim();
    if (!label) return;
    try {
      const res = await fetch(`/api/consilium/sessions/${sessionId}/items/${itemId}/checklist`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) throw new Error('add_failed');
      setNewLabel('');
      onRefresh();
    } catch {
      showToast('Napirendi pont hozzáadása sikertelen', 'error');
    }
  };

  const movePoint = async (entryKey: string, move: 'up' | 'down') => {
    try {
      const res = await fetch(`/api/consilium/sessions/${sessionId}/items/${itemId}/checklist/${encodeURIComponent(entryKey)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ move }),
      });
      if (!res.ok) throw new Error('move_failed');
      onRefresh();
    } catch {
      showToast('Napirendi pont átrendezése sikertelen', 'error');
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">
        Napirendi pontok — címke, pipa, és pontonként rögzíthető válasz / megállapodás.
      </p>
      <p className="text-xs text-gray-500">
        Bármikor bővítheted vagy szerkesztheted — nem kell betegfelvételkor mindent begépelni.
      </p>
      {!readonly && (
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className="form-input flex-1 min-w-[200px] text-sm"
            placeholder="Új pont, pl. Labor eredmények értékelése"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addPoint();
              }
            }}
          />
          <button type="button" className="btn-secondary text-sm px-3 py-1.5 shrink-0" onClick={() => void addPoint()}>
            Hozzáadás
          </button>
        </div>
      )}
      <ul className="space-y-2">
        {entries.length === 0 && <li className="text-xs text-gray-500">Még nincs felírva pont.</li>}
        {entries.map((c, idx) => (
          <ChecklistRowEditor
            key={c.key}
            sessionId={sessionId}
            itemId={itemId}
            entry={c}
            readonly={readonly}
            canMoveUp={idx > 0}
            canMoveDown={idx < entries.length - 1}
            onMove={(dir) => void movePoint(c.key, dir)}
            onRefresh={onRefresh}
            showToast={showToast}
            staffUserId={staffUserId}
            staffRole={staffRole}
          />
        ))}
      </ul>
    </div>
  );
}

function ChecklistRowEditor({
  sessionId,
  itemId,
  entry,
  readonly,
  canMoveUp,
  canMoveDown,
  onMove,
  onRefresh,
  showToast,
  staffUserId,
  staffRole,
}: {
  sessionId: string;
  itemId: string;
  entry: ChecklistEntryRow;
  readonly: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: 'up' | 'down') => void;
  onRefresh: () => void;
  showToast: (msg: string, type?: 'error' | 'success') => void;
  staffUserId?: string;
  staffRole?: string;
}) {
  const [text, setText] = useState(entry.label);
  const [responseText, setResponseText] = useState(entry.response ?? '');
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);

  useEffect(() => {
    setText(entry.label);
  }, [entry.key, entry.label]);

  useEffect(() => {
    setResponseText(entry.response ?? '');
  }, [entry.key, entry.response]);

  const saveLabel = async () => {
    const t = text.trim();
    if (!t) {
      setText(entry.label);
      return;
    }
    if (t === entry.label) return;
    try {
      const res = await fetch(
        `/api/consilium/sessions/${sessionId}/items/${itemId}/checklist/${encodeURIComponent(entry.key)}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: t }),
        },
      );
      if (!res.ok) throw new Error('rename_failed');
      onRefresh();
    } catch {
      showToast('Pont szövegének mentése sikertelen', 'error');
      setText(entry.label);
    }
  };

  const remove = async () => {
    if (!confirm('Törlöd ezt a napirendi pontot?')) return;
    try {
      const res = await fetch(
        `/api/consilium/sessions/${sessionId}/items/${itemId}/checklist/${encodeURIComponent(entry.key)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error('delete_failed');
      onRefresh();
    } catch {
      showToast('Törlés sikertelen', 'error');
    }
  };

  const toggle = async (checked: boolean) => {
    try {
      const res = await fetch(
        `/api/consilium/sessions/${sessionId}/items/${itemId}/checklist/${encodeURIComponent(entry.key)}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checked }),
        },
      );
      if (!res.ok) throw new Error('toggle_failed');
      onRefresh();
    } catch {
      showToast('Checklist mentése sikertelen', 'error');
      onRefresh();
    }
  };

  const cancelDelegatedTask = async (taskId: string) => {
    if (!confirm('Visszavonod ezt a delegált feladatot?')) return;
    setCancellingTaskId(taskId);
    try {
      const res = await fetch(`/api/user-tasks/${taskId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(typeof data.error === 'string' ? data.error : 'Visszavonás sikertelen', 'error');
        return;
      }
      showToast('Feladat visszavonva', 'success');
      onRefresh();
    } finally {
      setCancellingTaskId(null);
    }
  };

  const saveResponse = async () => {
    const next = responseText;
    const prev = entry.response ?? '';
    if (next.trim() === prev.trim()) return;
    try {
      const res = await fetch(
        `/api/consilium/sessions/${sessionId}/items/${itemId}/checklist/${encodeURIComponent(entry.key)}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response: next }),
        },
      );
      if (!res.ok) throw new Error('response_failed');
      onRefresh();
    } catch {
      showToast('Válasz mentése sikertelen', 'error');
      setResponseText(entry.response ?? '');
    }
  };

  return (
    <li className="flex items-start gap-2 text-sm text-gray-800 border border-gray-100 rounded-md p-2 bg-gray-50/80">
      <input
        type="checkbox"
        className="mt-1.5 shrink-0"
        checked={!!entry.checked}
        disabled={readonly}
        onChange={(e) => void toggle(e.target.checked)}
      />
      <div className="flex-1 min-w-0 space-y-1.5">
        <input
          className="form-input text-sm w-full"
          value={text}
          disabled={readonly}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void saveLabel()}
        />
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wide">Válasz / megállapodás</label>
          <textarea
            className="form-input text-sm w-full min-h-[72px] mt-0.5"
            placeholder="Mit hangzott el a pontról, döntés, teendő…"
            value={responseText}
            disabled={readonly}
            onChange={(e) => setResponseText(e.target.value)}
            onBlur={() => void saveResponse()}
          />
        </div>
        {(entry.delegatedTasks?.length ?? 0) > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50/70 px-2 py-1.5">
            <p className="text-[10px] text-amber-800/80 uppercase tracking-wide mb-1">Delegált feladatok</p>
            <ul className="space-y-2">
              {[...(entry.delegatedTasks ?? [])]
                .sort((a, b) => {
                  const d = delegatedTaskStatusRank(a.status) - delegatedTaskStatusRank(b.status);
                  if (d !== 0) return d;
                  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                })
                .map((task) => {
                  const showCancel = !readonly && canCancelDelegatedTask(task, staffUserId, staffRole);
                  const badgeClass =
                    task.status === 'done'
                      ? 'bg-emerald-100 text-emerald-900 border-emerald-200'
                      : task.status === 'cancelled'
                        ? 'bg-gray-100 text-gray-600 border-gray-200'
                        : 'bg-amber-100 text-amber-900 border-amber-200';
                  return (
                    <li key={task.id} className="text-xs text-amber-900 border border-amber-100/80 rounded-md px-2 py-1.5 bg-white/80">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{task.assigneeName}</span>
                            <span className="text-amber-800/70">· küldve {new Date(task.createdAt).toLocaleString('hu-HU')}</span>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border shrink-0 ${badgeClass}`}>
                              {delegatedTaskStatusLabelHu(task.status)}
                            </span>
                          </p>
                          {task.note ? (
                            <p className="text-[11px] text-amber-800/80">Megjegyzés: {task.note}</p>
                          ) : (
                            <p className="text-[11px] text-amber-700/65 italic">Nincs megjegyzés.</p>
                          )}
                          {task.dueAt ? (
                            <p className="text-[11px] text-amber-900/85 mt-0.5">
                              Határidő:{' '}
                              {new Date(task.dueAt).toLocaleString('hu-HU', { dateStyle: 'medium', timeStyle: 'short' })}
                            </p>
                          ) : null}
                          {task.status === 'done' && task.completedAt ? (
                            <p className="text-[11px] text-emerald-800/90 mt-0.5">
                              Késznek jelölve: {new Date(task.completedAt).toLocaleString('hu-HU')}
                            </p>
                          ) : null}
                          {task.status === 'cancelled' && task.completedAt ? (
                            <p className="text-[11px] text-gray-600 mt-0.5">
                              Visszavonva: {new Date(task.completedAt).toLocaleString('hu-HU')}
                            </p>
                          ) : null}
                        </div>
                        {showCancel ? (
                          <button
                            type="button"
                            disabled={cancellingTaskId === task.id}
                            className="shrink-0 text-[11px] text-red-700 hover:underline disabled:opacity-40"
                            onClick={() => void cancelDelegatedTask(task.id)}
                          >
                            {cancellingTaskId === task.id ? '…' : 'Visszavonás'}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
            </ul>
          </div>
        )}
        {!entry.key.startsWith('pt-') && (
          <p className="text-[10px] text-gray-400 truncate" title={entry.key}>
            Kulcs: {entry.key}
          </p>
        )}
      </div>
      {!readonly && (
        <div className="shrink-0 pt-1 flex items-center gap-2">
          <button
            type="button"
            className="text-xs text-gray-700 hover:text-gray-900 disabled:opacity-40"
            disabled={!canMoveUp}
            onClick={() => onMove('up')}
            title="Mozgatás fel"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="text-xs text-gray-700 hover:text-gray-900 disabled:opacity-40"
            disabled={!canMoveDown}
            onClick={() => onMove('down')}
            title="Mozgatás le"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => void remove()}>
            Törlés
          </button>
        </div>
      )}
    </li>
  );
}

export default function ConsiliumPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);

  const [title, setTitle] = useState('');
  const [scheduledLocal, setScheduledLocal] = useState('');

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) || null,
    [sessions, selectedSessionId],
  );

  const [items, setItems] = useState<ConsiliumPresentationItem[]>([]);
  const [moveTargetByItemId, setMoveTargetByItemId] = useState<Record<string, string>>({});
  const [sessionDetail, setSessionDetail] = useState<{
    id: string;
    title: string;
    scheduledAt: string;
    status: string;
    attendees: SessionAttendee[];
  } | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [institutionUsers, setInstitutionUsers] = useState<InstitutionUserRow[]>([]);
  const [institutionUsersLoading, setInstitutionUsersLoading] = useState(false);

  const [patientQuery, setPatientQuery] = useState('');
  const [patientHits, setPatientHits] = useState<PatientHit[]>([]);
  const searchDebounceRef = useRef<NodeJS.Timeout>();

  const [shareModalState, setShareModalState] = useState<{
    sessionId: string;
    itemId: string;
    patientName: string;
  } | null>(null);

  const [invitations, setInvitations] = useState<InvitationStatusRow[]>([]);
  const [loadingInvitations, setLoadingInvitations] = useState(false);
  const [sendingInvitations, setSendingInvitations] = useState(false);
  const [invitationNote, setInvitationNote] = useState('');
  const [invitationsExpanded, setInvitationsExpanded] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await fetch('/api/consilium/sessions/summary', { credentials: 'include' });
      if (!res.ok) throw new Error('summary_failed');
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch {
      showToast('Nem sikerült betölteni a konzílium alkalmakat', 'error');
    } finally {
      setLoadingSessions(false);
    }
  }, [showToast]);

  const loadItems = useCallback(
    async (sessionId: string) => {
      setLoadingItems(true);
      try {
        const res = await fetch(`/api/consilium/sessions/${sessionId}/presentation`, { credentials: 'include' });
        if (!res.ok) throw new Error('presentation_failed');
        const data = (await res.json()) as {
          items?: ConsiliumPresentationItem[];
          session?: {
            id: string;
            title: string;
            scheduledAt: string;
            status: string;
            attendees?: unknown;
          };
        };
        setItems(data.items ?? []);
        if (data.session) {
          const att = Array.isArray(data.session.attendees) ? data.session.attendees : [];
          setSessionDetail({
            id: data.session.id,
            title: data.session.title,
            scheduledAt: data.session.scheduledAt,
            status: data.session.status,
            attendees: att.filter(
              (a): a is SessionAttendee =>
                !!a &&
                typeof a === 'object' &&
                typeof (a as SessionAttendee).id === 'string' &&
                typeof (a as SessionAttendee).name === 'string' &&
                typeof (a as SessionAttendee).present === 'boolean',
            ),
          });
        }
      } catch {
        showToast('Nem sikerült betölteni az alkalom elemeit', 'error');
      } finally {
        setLoadingItems(false);
      }
    },
    [showToast],
  );

  const loadInvitations = useCallback(
    async (sessionId: string) => {
      setLoadingInvitations(true);
      try {
        const res = await fetch(`/api/consilium/sessions/${sessionId}/invitations`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('invitations_failed');
        const data = (await res.json()) as { invitations?: InvitationStatusRow[] };
        setInvitations(Array.isArray(data.invitations) ? data.invitations : []);
      } catch {
        setInvitations([]);
      } finally {
        setLoadingInvitations(false);
      }
    },
    [],
  );

  const availableInstitutionUsers = useMemo(() => {
    if (!sessionDetail) return [];
    const taken = new Set(sessionDetail.attendees.map((a) => a.id));
    return institutionUsers.filter((u) => !taken.has(u.id));
  }, [sessionDetail, institutionUsers]);

  const activeInvitationsByAttendeeId = useMemo(() => {
    const m = new Map<string, InvitationStatusRow>();
    for (const inv of invitations) {
      if (inv.revokedAt) continue;
      m.set(inv.attendeeId, inv);
    }
    return m;
  }, [invitations]);

  const invitationSummary = useMemo(() => {
    const attendees = sessionDetail?.attendees ?? [];
    let going = 0;
    let late = 0;
    let reschedule = 0;
    let pending = 0;
    let notInvited = 0;
    for (const a of attendees) {
      const inv = activeInvitationsByAttendeeId.get(a.id);
      if (!inv || !inv.sentAt) {
        notInvited += 1;
        continue;
      }
      if (inv.response === 'going') going += 1;
      else if (inv.response === 'late') late += 1;
      else if (inv.response === 'reschedule') reschedule += 1;
      else pending += 1;
    }
    return { going, late, reschedule, pending, notInvited, total: attendees.length };
  }, [sessionDetail, activeInvitationsByAttendeeId]);

  const draftTransferTargets = useMemo(() => {
    return sessions.filter((s) => s.status === 'draft' && s.id !== selectedSessionId);
  }, [sessions, selectedSessionId]);

  useEffect(() => {
    if (!user || user.role === 'technikus') return;
    let cancelled = false;
    setInstitutionUsersLoading(true);
    fetch('/api/consilium/institution-users', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : Promise.resolve({ users: [] })))
      .then((data) => {
        if (!cancelled) setInstitutionUsers(Array.isArray(data.users) ? data.users : []);
      })
      .catch(() => {
        if (!cancelled) setInstitutionUsers([]);
      })
      .finally(() => {
        if (!cancelled) setInstitutionUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        setUser(u);
        if (!u) router.replace('/login');
      })
      .catch(() => router.replace('/login'))
      .finally(() => setLoadingUser(false));
  }, [router]);

  useEffect(() => {
    if (!user) return;
    loadSessions();
  }, [user, loadSessions]);

  useEffect(() => {
    if (!selectedSessionId) {
      setItems([]);
      setSessionDetail(null);
      setInvitations([]);
      setInvitationsExpanded(false);
      setInvitationNote('');
      return;
    }
    setSessionDetail(null);
    setInvitations([]);
    loadItems(selectedSessionId);
    loadInvitations(selectedSessionId);
  }, [selectedSessionId, loadItems, loadInvitations]);

  useEffect(() => {
    return () => clearTimeout(searchDebounceRef.current);
  }, []);

  useEffect(() => {
    clearTimeout(searchDebounceRef.current);
    const q = patientQuery.trim();
    if (q.length < 2) {
      setPatientHits([]);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/patients?q=${encodeURIComponent(q)}&limit=10`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        setPatientHits(data.patients || []);
      } catch {
        // ignore
      }
    }, 350);
  }, [patientQuery]);

  const canUseConsilium = user && user.role !== 'technikus';

  const handleCreateSession = async () => {
    if (!title.trim() || !scheduledLocal) {
      showToast('Cím és időpont kötelező', 'error');
      return;
    }
    const scheduledAt = new Date(scheduledLocal).toISOString();
    try {
      const res = await fetch('/api/consilium/sessions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), scheduledAt }),
      });
      if (!res.ok) throw new Error('create_failed');
      const data = await res.json();
      setTitle('');
      setScheduledLocal('');
      await loadSessions();
      setSelectedSessionId(data.session.id);
      showToast('Alkalom létrehozva', 'success');
    } catch {
      showToast('Nem sikerült létrehozni az alkalmat', 'error');
    }
  };

  const patchSessionStatus = async (sessionId: string, status: 'draft' | 'active' | 'closed') => {
    try {
      const res = await fetch(`/api/consilium/sessions/${sessionId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('patch_failed');
      await loadSessions();
      if (selectedSessionId === sessionId) await loadItems(sessionId);
      showToast('Állapot frissítve', 'success');
    } catch {
      showToast('Állapotváltás sikertelen', 'error');
    }
  };

  const deleteSession = async (sessionId: string, status: SessionSummary['status']) => {
    const statusLabel =
      status === 'draft' ? 'draft' : status === 'active' ? 'aktív' : 'lezárt';
    if (
      !confirm(
        `Biztosan törli ezt az ${statusLabel} konzílium alkalmat? Ez a művelet nem visszavonható.`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/consilium/sessions/${sessionId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('delete_failed');
      if (selectedSessionId === sessionId) setSelectedSessionId(null);
      await loadSessions();
      showToast('Alkalom törölve', 'success');
    } catch {
      showToast('Törlés sikertelen', 'error');
    }
  };

  const sendInvitations = async (
    options: {
      attendeeIds?: string[];
      regenerate?: boolean;
      successLabel?: string;
    } = {},
  ) => {
    if (!selectedSessionId || sendingInvitations) return;
    setSendingInvitations(true);
    try {
      const res = await fetch(
        `/api/consilium/sessions/${selectedSessionId}/invitations/send`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(options.attendeeIds ? { attendeeIds: options.attendeeIds } : {}),
            ...(invitationNote.trim() ? { note: invitationNote.trim() } : {}),
            ...(options.regenerate ? { regenerate: true } : {}),
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        sentCount?: number;
        totalCount?: number;
        error?: string;
        results?: Array<{ skipReason?: string }>;
      };
      if (!res.ok) {
        showToast(data.error || 'Meghívók kiküldése sikertelen', 'error');
        return;
      }
      const sent = data.sentCount ?? 0;
      const total = data.totalCount ?? sent;
      const skipped = total - sent;
      const baseLabel = options.successLabel || 'Meghívók kiküldve';
      showToast(
        skipped > 0
          ? `${baseLabel}: ${sent}/${total} (${skipped} kihagyva)`
          : `${baseLabel}: ${sent}/${total}`,
        sent > 0 ? 'success' : 'error',
      );
      await loadInvitations(selectedSessionId);
    } catch {
      showToast('Hálózati hiba a meghívók kiküldésekor', 'error');
    } finally {
      setSendingInvitations(false);
    }
  };

  const saveAttendees = async (next: SessionAttendee[]) => {
    if (!selectedSessionId) return;
    try {
      const res = await fetch(`/api/consilium/sessions/${selectedSessionId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendees: next }),
      });
      if (!res.ok) throw new Error('attendees_failed');
      setSessionDetail((d) => (d ? { ...d, attendees: next } : d));
      await loadSessions();
    } catch {
      showToast('Jelenlévők mentése sikertelen', 'error');
      await loadItems(selectedSessionId);
    }
  };

  const addPatientToSession = async (patientId: string) => {
    if (!selectedSessionId) return;
    try {
      const res = await fetch(`/api/consilium/sessions/${selectedSessionId}/items`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || 'add_failed');
      }
      setPatientQuery('');
      setPatientHits([]);
      await loadSessions();
      await loadItems(selectedSessionId);
      showToast('Beteg hozzáadva', 'success');
    } catch (e: any) {
      showToast(e?.message ? String(e.message) : 'Beteg hozzáadása sikertelen', 'error');
    }
  };

  const removeItem = async (itemId: string) => {
    if (!selectedSessionId) return;
    if (!confirm('Eltávolítja ezt a beteget az alkalomról?')) return;
    try {
      const res = await fetch(`/api/consilium/sessions/${selectedSessionId}/items/${itemId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('delete_item_failed');
      await loadSessions();
      await loadItems(selectedSessionId);
      showToast('Elem törölve', 'success');
    } catch {
      showToast('Elem törlése sikertelen', 'error');
    }
  };

  const moveItemToAnotherDraftSession = async (itemId: string, patientName: string) => {
    if (!selectedSessionId) return;
    const preferred = moveTargetByItemId[itemId];
    const targetSessionId = draftTransferTargets.some((x) => x.id === preferred)
      ? preferred
      : (draftTransferTargets[0]?.id ?? '');
    if (!targetSessionId) {
      showToast('Nincs másik draft alkalom, ahová át lehetne tenni', 'error');
      return;
    }
    try {
      const res = await fetch(`/api/consilium/sessions/${selectedSessionId}/items/${itemId}/move`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetSessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || 'Áthelyezés sikertelen', 'error');
        return;
      }
      showToast(`Beteg áthelyezve: ${patientName}`, 'success');
      await loadSessions();
      await loadItems(selectedSessionId);
    } catch {
      showToast('Áthelyezés sikertelen', 'error');
    }
  };

  const patchItemField = async (itemId: string, payload: any) => {
    if (!selectedSessionId) return;
    const res = await fetch(`/api/consilium/sessions/${selectedSessionId}/items/${itemId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('patch_item_failed');
    return res.json();
  };

  const copyPrepLinkForItem = useCallback(
    async (itemId: string) => {
      if (!selectedSessionId) return;
      try {
        const res = await fetch(
          `/api/consilium/sessions/${selectedSessionId}/items/${itemId}/prep-link`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error('prep_link_failed');
        const path = typeof data.prepPath === 'string' ? data.prepPath : '';
        const prepUrl = typeof data.prepUrl === 'string' ? data.prepUrl : '';
        if (!path && !prepUrl) throw new Error('prep_path_missing');
        const fullUrl = prepUrl || `${window.location.origin}${path}`;
        try {
          await navigator.clipboard.writeText(fullUrl);
          showToast('Előkészítő link a vágólapon', 'success');
        } catch {
          // Bizonyos böngészők / környezetek tiltják a vágólap API-t, ettől még a link létrejött.
          window.prompt('A link elkészült, de a másolás nem sikerült. Másold ki kézzel:', fullUrl);
          showToast('Előkészítő link elkészült, de automatikus másolás sikertelen', 'success');
        }
      } catch {
        showToast('Előkészítő link létrehozása sikertelen', 'error');
      }
    },
    [selectedSessionId, showToast],
  );

  const revokePrepLinksForItem = useCallback(
    async (itemId: string) => {
      if (!selectedSessionId) return;
      if (
        !confirm(
          'Visszavonod az előkészítő linkeket ehhez a beteghez? A korábban kiküldött linkek többé nem működnek.',
        )
      ) {
        return;
      }
      try {
        const res = await fetch(
          `/api/consilium/sessions/${selectedSessionId}/items/${itemId}/prep-link`,
          { method: 'DELETE', credentials: 'include' },
        );
        if (!res.ok) throw new Error('revoke_failed');
        showToast('Előkészítő linkek visszavonva', 'success');
      } catch {
        showToast('Visszavonás sikertelen', 'error');
      }
    },
    [selectedSessionId, showToast],
  );

  if (loadingUser) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Betöltés...</div>
      </div>
    );
  }

  if (!canUseConsilium) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full card p-6 text-center space-y-3">
          <Users className="w-10 h-10 mx-auto text-medical-primary" />
          <h1 className="text-lg font-semibold text-gray-900">Konzílium</h1>
          <p className="text-sm text-gray-600">Ehhez a szerepkörhöz ez a modul nem elérhető.</p>
          <Link href="/" className="btn-secondary inline-flex items-center justify-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Vissza a főoldalra
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-soft border-b border-gray-200/60 sticky top-0 z-30 backdrop-blur-sm bg-white/95 max-md:mobile-safe-top">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-2 md:py-3 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Logo width={32} height={37} className="md:w-[50px] md:h-[58px] flex-shrink-0" />
              <div className="min-w-0">
                <h1 className="text-base md:text-xl font-semibold text-medical-primary truncate">Konzílium</h1>
                <p className="text-xs text-gray-500 hidden sm:block">Alkalmak, beteglista és vetítés (MVP)</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link href="/" className="btn-secondary text-sm px-3 py-2 inline-flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Főoldal</span>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-6 pb-mobile-nav-staff md:pb-8 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <section className="card p-4 space-y-3 lg:col-span-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Alkalmak</h2>
              <button type="button" className="btn-secondary text-xs px-2 py-1" onClick={loadSessions} disabled={loadingSessions}>
                Frissítés
              </button>
            </div>
            <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
              {loadingSessions && <p className="text-sm text-gray-500">Betöltés...</p>}
              {!loadingSessions && sessions.length === 0 && <p className="text-sm text-gray-500">Még nincs alkalom.</p>}
              {sessions.map((s) => {
                const active = s.id === selectedSessionId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedSessionId(s.id)}
                    className={`w-full text-left rounded-lg border px-3 py-2 transition ${
                      active ? 'border-medical-primary bg-medical-primary/5' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{s.title}</p>
                        <p className="text-xs text-gray-500">
                          {new Date(s.scheduledAt).toLocaleString('hu-HU')} · {s.status}
                        </p>
                        <p className="text-xs text-gray-600 mt-1">
                          {s.itemCount} beteg · {s.discussedCount ?? 0} megbeszélve · {s.openCount ?? 0} még nem
                        </p>
                      </div>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                          s.status === 'draft'
                            ? 'bg-gray-100 text-gray-700'
                            : s.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="card p-4 space-y-3 lg:col-span-2">
            <h2 className="text-sm font-semibold text-gray-900">Új alkalom</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-600">Cím</label>
                <input className="form-input mt-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="pl. Heti konzílium" />
              </div>
              <div>
                <label className="text-xs text-gray-600">Időpont</label>
                <input
                  className="form-input mt-1"
                  type="datetime-local"
                  value={scheduledLocal}
                  onChange={(e) => setScheduledLocal(e.target.value)}
                />
              </div>
            </div>
            <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={handleCreateSession}>
              <Plus className="w-4 h-4" />
              Létrehozás
            </button>

            <div className="border-t border-gray-200 pt-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900">Kiválasztott alkalom</h3>
                {selectedSession && (
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/consilium/${selectedSession.id}/present`}
                      className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1"
                    >
                      <Presentation className="w-3.5 h-3.5" />
                      Vetítés
                    </Link>
                    {selectedSession.status === 'draft' && (
                      <button
                        type="button"
                        className="btn-primary text-xs px-3 py-1.5"
                        onClick={() => patchSessionStatus(selectedSession.id, 'active')}
                      >
                        Aktiválás
                      </button>
                    )}
                    {selectedSession.status === 'active' && (
                      <button
                        type="button"
                        className="btn-secondary text-xs px-3 py-1.5"
                        onClick={() => patchSessionStatus(selectedSession.id, 'closed')}
                      >
                        Lezárás
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1 text-red-700"
                      onClick={() => deleteSession(selectedSession.id, selectedSession.status)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Törlés
                    </button>
                  </div>
                )}
              </div>

              {!selectedSession && <p className="text-sm text-gray-500">Válassz egy alkalmat a bal oldali listából.</p>}

              {selectedSession && selectedSession.status === 'closed' && (
                <p className="text-xs text-gray-600">
                  Lezárt alkalom: csak olvasható. A vetítés továbbra is elérhető, de szerkesztés nem engedélyezett.
                </p>
              )}

              {selectedSession && (sessionDetail || loadingItems) && (
                <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-3 space-y-2">
                  <h4 className="text-sm font-semibold text-gray-900">Jelenlévők az értekezleten</h4>
                  <p className="text-xs text-gray-600">
                    Intézményi felhasználók (nem a beteglista): gépelj név- vagy e-mail-részletet, válassz a javaslatok közül.
                    Minden kiválasztott címkeként látszik — pipa: jelen van, ×: eltávolítás. Csak aktív fiókok; aki már rajta van,
                    nem jelenik meg újra a keresésben.
                  </p>
                  {loadingItems && !sessionDetail && <p className="text-xs text-gray-500">Betöltés…</p>}
                  {sessionDetail &&
                    !institutionUsersLoading &&
                    institutionUsers.length === 0 &&
                    sessionDetail.attendees.length === 0 ? (
                      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
                        Nincs listázható aktív felhasználó a rendszerben.
                      </p>
                    ) : sessionDetail ? (
                      <ConsiliumAttendeeTagField
                        key={selectedSession.id}
                        attendees={sessionDetail.attendees}
                        readonly={selectedSession.status === 'closed'}
                        availableUsers={availableInstitutionUsers}
                        usersLoading={institutionUsersLoading}
                        onChange={(next) => void saveAttendees(next)}
                      />
                    ) : null}
                </div>
              )}

              {selectedSession && sessionDetail && (
                <div className="rounded-lg border border-cyan-100 bg-cyan-50/40 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5">
                        <Mail className="w-4 h-4 text-cyan-700" /> Meghívók és RSVP
                      </h4>
                      <p className="text-xs text-gray-600 mt-0.5">
                        Email-meghívót küld a jelenlévőknek. A címzettek a levélből egy kattintással
                        jelezhetik: <em>Ott leszek</em> / <em>Kések</em> / <em>Máskor lenne jó</em>.
                      </p>
                    </div>
                    {selectedSession.status !== 'closed' && sessionDetail.attendees.length > 0 && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50"
                          disabled={sendingInvitations}
                          onClick={() =>
                            void sendInvitations({
                              successLabel: 'Meghívók kiküldve',
                            })
                          }
                          title="Email-meghívót küld minden jelenlévőnek; aki már kapott, ugyanazt a linket kapja újra (RSVP nem vész el)."
                        >
                          <Send className="w-3.5 h-3.5" />
                          {sendingInvitations ? 'Küldés…' : 'Meghívók kiküldése'}
                        </button>
                        <button
                          type="button"
                          className="text-xs text-gray-700 hover:underline"
                          onClick={() => setInvitationsExpanded((v) => !v)}
                        >
                          {invitationsExpanded ? 'Kevesebb' : 'Részletek'}
                        </button>
                      </div>
                    )}
                  </div>

                  {sessionDetail.attendees.length === 0 ? (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
                      Adj hozzá legalább egy jelenlévőt, mielőtt meghívót küldenél.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-900">
                        Ott leszek: <strong>{invitationSummary.going}</strong>
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-900">
                        Kések: <strong>{invitationSummary.late}</strong>
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-indigo-900">
                        Máskor: <strong>{invitationSummary.reschedule}</strong>
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-gray-700">
                        Még nem válaszolt: <strong>{invitationSummary.pending}</strong>
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-gray-600">
                        Nincs meghívó: <strong>{invitationSummary.notInvited}</strong>
                      </span>
                    </div>
                  )}

                  {invitationsExpanded && (
                    <div className="space-y-2 pt-2 border-t border-cyan-100">
                      {selectedSession.status !== 'closed' && (
                        <div>
                          <label className="text-[11px] uppercase tracking-wide text-gray-500">
                            Üzenet a meghívóhoz (opcionális)
                          </label>
                          <textarea
                            className="form-input mt-1 w-full min-h-[60px] text-sm"
                            placeholder="Pár szó a meghívottaknak (pl. mi a téma, miért fontos)…"
                            value={invitationNote}
                            maxLength={1000}
                            onChange={(e) => setInvitationNote(e.target.value)}
                          />
                          <p className="text-[11px] text-gray-400 text-right">
                            {invitationNote.length}/1000
                          </p>
                        </div>
                      )}

                      {loadingInvitations && invitations.length === 0 ? (
                        <p className="text-xs text-gray-500">Meghívók betöltése…</p>
                      ) : (
                        <ul className="divide-y divide-cyan-100 rounded-md border border-cyan-100 bg-white">
                          {sessionDetail.attendees.map((a) => {
                            const inv = activeInvitationsByAttendeeId.get(a.id);
                            const responded = inv?.respondedAt ? inv.response : null;
                            const sent = !!inv?.sentAt;
                            return (
                              <li key={a.id} className="px-3 py-2 flex items-start gap-2 text-sm">
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium text-gray-900 truncate">{a.name}</p>
                                  {inv?.attendeeEmail && (
                                    <p className="text-[11px] text-gray-500 truncate">
                                      {inv.attendeeEmail}
                                    </p>
                                  )}
                                  {sent && inv && (
                                    <p className="text-[11px] text-gray-500 mt-0.5">
                                      Küldve: {new Date(inv.sentAt!).toLocaleString('hu-HU')}
                                      {inv.respondedAt
                                        ? ` · Válaszolt: ${new Date(inv.respondedAt).toLocaleString('hu-HU')}`
                                        : ''}
                                    </p>
                                  )}
                                  {inv?.response === 'reschedule' && inv.proposedAt && (
                                    <p className="text-[11px] text-indigo-800 mt-0.5">
                                      Javasolt időpont:{' '}
                                      <strong>
                                        {new Date(inv.proposedAt).toLocaleString('hu-HU', {
                                          dateStyle: 'medium',
                                          timeStyle: 'short',
                                        })}
                                      </strong>
                                      {inv.proposedNote ? ` — „${inv.proposedNote}”` : ''}
                                    </p>
                                  )}
                                </div>
                                <span
                                  className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded border ${rsvpResponseBadgeClass(
                                    responded ?? null,
                                  )}`}
                                >
                                  {sent
                                    ? rsvpResponseLabelHu(responded ?? null)
                                    : 'Nincs meghívó'}
                                </span>
                                {sent && selectedSession.status !== 'closed' && (
                                  <button
                                    type="button"
                                    disabled={sendingInvitations}
                                    className="shrink-0 text-[11px] text-cyan-800 hover:underline disabled:opacity-40"
                                    onClick={() =>
                                      void sendInvitations({
                                        attendeeIds: [a.id],
                                        successLabel: 'Meghívó újraküldve',
                                      })
                                    }
                                    title="Ugyanazt a linket küldjük újra; az addigi RSVP válasz megmarad."
                                  >
                                    Újraküld
                                  </button>
                                )}
                                {!sent && selectedSession.status !== 'closed' && (
                                  <button
                                    type="button"
                                    disabled={sendingInvitations}
                                    className="shrink-0 text-[11px] text-cyan-800 hover:underline disabled:opacity-40"
                                    onClick={() =>
                                      void sendInvitations({
                                        attendeeIds: [a.id],
                                        successLabel: 'Meghívó kiküldve',
                                      })
                                    }
                                  >
                                    Küldés
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}

              {selectedSession && selectedSession.status !== 'closed' && (
                <div className="space-y-2">
                  <label className="text-xs text-gray-600">Beteg keresése (min. 2 karakter)</label>
                  <input
                    className="form-input"
                    value={patientQuery}
                    onChange={(e) => setPatientQuery(e.target.value)}
                    placeholder="Név / TAJ / telefon..."
                  />
                  {patientHits.length > 0 && (
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 bg-white">
                      {patientHits.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-gray-50"
                          onClick={() => addPatientToSession(p.id)}
                          disabled={selectedSession.status !== 'draft'}
                        >
                          <p className="text-sm font-medium text-gray-900">{p.nev || 'Névtelen'}</p>
                          <p className="text-xs text-gray-500">{p.taj ? `TAJ: ${p.taj}` : p.id}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedSession.status !== 'draft' && (
                    <p className="text-xs text-gray-600">Aktív alkalom alatt új beteg nem adható hozzá (stabil vetítés-index).</p>
                  )}
                </div>
              )}

              {selectedSession && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="w-4 h-4 text-gray-500" />
                    <h4 className="text-sm font-semibold text-gray-900">Beteglista</h4>
                  </div>
                  {loadingItems && <p className="text-sm text-gray-500">Elemek betöltése...</p>}
                  {!loadingItems && items.length === 0 && <p className="text-sm text-gray-500">Még nincs beteg az alkalmon.</p>}
                  <div className="space-y-3">
                    {items.map((it) => {
                      const name = it.patientSummary?.name || 'Ismeretlen beteg';
                      const readonly = selectedSession.status === 'closed';
                      const listLocked = selectedSession.status !== 'draft';
                      return (
                        <div key={it.id} className="border border-gray-200 rounded-lg p-3 bg-white space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate">{name}</p>
                              <p className="text-xs text-gray-500">
                                #{it.sortOrder} · {it.patientSummary?.missingPatient ? 'Beteg rekord hiányzik / nem látható' : it.patientId}
                              </p>
                            </div>
                            {!listLocked && (
                              <div className="flex items-center gap-2">
                                {draftTransferTargets.length > 0 && (
                                  <>
                                    <select
                                      className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white"
                                      value={moveTargetByItemId[it.id] ?? draftTransferTargets[0].id}
                                      onChange={(e) =>
                                        setMoveTargetByItemId((prev) => ({
                                          ...prev,
                                          [it.id]: e.target.value,
                                        }))
                                      }
                                    >
                                      {draftTransferTargets.map((s) => (
                                        <option key={s.id} value={s.id}>
                                          {s.title}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      className="text-xs text-medical-primary hover:underline"
                                      onClick={() => void moveItemToAnotherDraftSession(it.id, name)}
                                    >
                                      Áthelyezés
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  className="text-xs text-red-700 hover:underline"
                                  onClick={() => removeItem(it.id)}
                                >
                                  Eltávolítás
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <div>
                              <label className="flex items-center gap-2 text-sm text-gray-800 mt-1">
                                <input
                                  type="checkbox"
                                  checked={!!it.discussionState?.discussed}
                                  disabled={readonly}
                                  onChange={async (e) => {
                                    const discussed = e.target.checked;
                                    setItems((prev) =>
                                      prev.map((x) =>
                                        x.id === it.id
                                          ? { ...x, discussionState: { ...x.discussionState, discussed } }
                                          : x,
                                      ),
                                    );
                                    try {
                                      await patchItemField(it.id, { operation: 'update_discussed', discussed });
                                    } catch {
                                      showToast('Státusz mentése sikertelen', 'error');
                                      await loadItems(selectedSession.id);
                                    }
                                  }}
                                />
                                Megbeszélve
                              </label>
                            </div>
                            <div className="text-xs text-gray-600 md:self-end">
                              Média: OP kép {it.mediaSummary?.opPreview?.imageCount ?? 0}/{it.mediaSummary?.opPreview?.totalCount ?? 0} · Foto{' '}
                              {it.mediaSummary?.photoPreview?.imageCount ?? 0}/{it.mediaSummary?.photoPreview?.totalCount ?? 0}
                              {it.mediaSummary?.error ? ' · média összegzés részben hibás' : ''}
                            </div>
                          </div>

                          <ConsiliumItemPrepCommentsReadonly
                            checklist={(it.discussionState?.checklist || []) as ChecklistEntryRow[]}
                            prepComments={it.prepComments ?? []}
                          />

                          <ConsiliumItemChecklist
                            sessionId={selectedSession.id}
                            itemId={it.id}
                            entries={(it.discussionState.checklist || []) as ChecklistEntryRow[]}
                            readonly={readonly}
                            onRefresh={() => loadItems(selectedSession.id)}
                            showToast={showToast}
                            staffUserId={user?.id}
                            staffRole={user?.role}
                          />

                          {selectedSession.status !== 'closed' && (
                            <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                              <button
                                type="button"
                                className="text-xs px-2 py-1 rounded-md border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
                                onClick={() => void copyPrepLinkForItem(it.id)}
                              >
                                Előkészítő link másolása
                              </button>
                              <button
                                type="button"
                                className="text-xs px-2 py-1 rounded-md bg-cyan-700 text-white hover:bg-cyan-800 inline-flex items-center gap-1"
                                onClick={() =>
                                  setShareModalState({
                                    sessionId: selectedSession.id,
                                    itemId: it.id,
                                    patientName: name,
                                  })
                                }
                              >
                                <Send className="w-3 h-3" />
                                Küldés felhasználónak
                              </button>
                              <button
                                type="button"
                                className="text-xs px-2 py-1 rounded-md text-red-700 hover:bg-red-50"
                                onClick={() => void revokePrepLinksForItem(it.id)}
                              >
                                Előkészítő linkek visszavonása
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <p className="text-xs text-gray-500">
          MVP: a betegprofil régi „Konzílium” füle és tartalma megmarad; ez az oldal az alkalmakat és a hozzájuk tartozó listát
          külön tárolja.
        </p>
      </main>

      {shareModalState && (
        <SendConsiliumPrepLinkModal
          isOpen={!!shareModalState}
          onClose={() => setShareModalState(null)}
          sessionId={shareModalState.sessionId}
          itemId={shareModalState.itemId}
          patientName={shareModalState.patientName}
          currentUserId={user?.id}
          currentEmail={user?.email}
        />
      )}

      <MobileBottomNav />
    </div>
  );
}

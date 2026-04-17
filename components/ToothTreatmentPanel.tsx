'use client';

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import { Plus, X, ExternalLink, Check, Loader2, SendHorizontal, UserRound } from 'lucide-react';
import type { ToothTreatment, ToothTreatmentCatalogItem } from '@/lib/types';
import { getCurrentUser } from '@/lib/auth';
import { isToothTreatmentPathwayDone } from '@/lib/tooth-treatment-pathway';

type InstitutionUserRow = {
  id: string;
  email: string;
  doktorNeve: string | null;
  role: string;
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
  return n ? `${n} (${u.email})` : u.email;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Függőben' },
  episode_linked: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Epizódhoz kötve' },
  completed: { bg: 'bg-green-100', text: 'text-green-800', label: 'Kész' },
};

// ---- Context: load treatments + catalog once, share across all tooth cards ----

interface ToothTreatmentContextValue {
  treatments: ToothTreatment[];
  catalog: ToothTreatmentCatalogItem[];
  loading: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  reload: () => Promise<void>;
  patientId: string;
  institutionUsers: InstitutionUserRow[];
  institutionUsersLoading: boolean;
  loadInstitutionUsers: () => Promise<void>;
}

const ToothTreatmentContext = createContext<ToothTreatmentContextValue | null>(null);

interface ToothTreatmentProviderProps {
  patientId: string;
  children: ReactNode;
}

export function ToothTreatmentProvider({ patientId, children }: ToothTreatmentProviderProps) {
  const [treatments, setTreatments] = useState<ToothTreatment[]>([]);
  const [catalog, setCatalog] = useState<ToothTreatmentCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [institutionUsers, setInstitutionUsers] = useState<InstitutionUserRow[]>([]);
  const [institutionUsersLoading, setInstitutionUsersLoading] = useState(false);
  const institutionUsersFetchedOk = useRef(false);

  const loadInstitutionUsers = useCallback(async () => {
    if (institutionUsersFetchedOk.current) return;
    setInstitutionUsersLoading(true);
    try {
      const res = await fetch('/api/consilium/institution-users', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setInstitutionUsers((data.users ?? []) as InstitutionUserRow[]);
      institutionUsersFetchedOk.current = true;
    } finally {
      setInstitutionUsersLoading(false);
    }
  }, []);

  const reload = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError(null);
    try {
      const [txRes, catRes] = await Promise.all([
        fetch(`/api/patients/${patientId}/tooth-treatments`, { credentials: 'include' }),
        fetch('/api/tooth-treatment-catalog', { credentials: 'include' }),
      ]);
      if (txRes.ok) {
        const txData = await txRes.json();
        setTreatments(txData.items ?? []);
      }
      if (catRes.ok) {
        const catData = await catRes.json();
        setCatalog(catData.items ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <ToothTreatmentContext.Provider
      value={{
        treatments,
        catalog,
        loading,
        error,
        setError,
        reload,
        patientId,
        institutionUsers,
        institutionUsersLoading,
        loadInstitutionUsers,
      }}
    >
      {children}
    </ToothTreatmentContext.Provider>
  );
}

// ---- Delegate Feladataim (belső user vagy külső megnevezés + belső felelős) ----

function ToothTreatmentDelegateBlock({
  treatment,
  patientId,
  institutionUsers,
  institutionUsersLoading,
  loadInstitutionUsers,
  onClose,
  onDelegated,
}: {
  treatment: ToothTreatment;
  patientId: string;
  institutionUsers: InstitutionUserRow[];
  institutionUsersLoading: boolean;
  loadInstitutionUsers: () => Promise<void>;
  onClose: () => void;
  onDelegated: () => void;
}) {
  const [mode, setMode] = useState<'staff' | 'external'>('staff');
  const [selfUserId, setSelfUserId] = useState<string>('');
  const [assigneeInput, setAssigneeInput] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [externalLabel, setExternalLabel] = useState('');
  const [taskOwnerUserId, setTaskOwnerUserId] = useState('');
  const [note, setNote] = useState('');
  const [dueLocal, setDueLocal] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void loadInstitutionUsers();
    void getCurrentUser().then((u) => setSelfUserId((u?.id ?? '').trim()));
  }, [loadInstitutionUsers]);

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

  const send = async () => {
    setFeedback(null);
    const dueIso =
      dueLocal.trim().length > 0
        ? (() => {
            const d = new Date(dueLocal);
            return !Number.isNaN(d.getTime()) ? d.toISOString() : null;
          })()
        : null;

    if (mode === 'staff') {
      if (!assigneeId) {
        setFeedback({ ok: false, msg: 'Válassz címzettet a listából (kezd el gépelni a nevet vagy e-mailt).' });
        return;
      }
    } else if (externalLabel.trim().length < 2) {
      setFeedback({ ok: false, msg: 'Írd le a külső címzettet (pl. Dr. … telefon / e-mail).' });
      return;
    }

    setSending(true);
    try {
      const ownerForExternal = (taskOwnerUserId || selfUserId).trim();
      if (mode === 'external' && !ownerForExternal) {
        setFeedback({ ok: false, msg: 'A feladat felelőse még betöltődik — várj egy pillanatot, majd próbáld újra.' });
        return;
      }

      const body: Record<string, unknown> = {
        mode,
        ...(mode === 'staff'
          ? { assigneeUserId: assigneeId }
          : {
              externalAssigneeLabel: externalLabel.trim(),
              taskOwnerUserId: ownerForExternal,
            }),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(dueIso ? { dueAt: dueIso } : {}),
      };
      const res = await fetch(
        `/api/patients/${patientId}/tooth-treatments/${treatment.id}/delegate-task`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setFeedback({
          ok: false,
          msg: typeof data.error === 'string' ? data.error : 'Sikertelen küldés',
        });
        return;
      }
      setFeedback({
        ok: true,
        msg:
          mode === 'staff'
            ? 'Feladat elküldve — a címzettnek a Feladataim oldalon jelenik meg.'
            : 'Feladat rögzítve — a kiválasztott felelősnél (alapértelmezés: te) a Feladataim listán követhető a külső egyeztetés.',
      });
      setNote('');
      setDueLocal('');
      setAssigneeId('');
      setAssigneeInput('');
      setExternalLabel('');
      setTaskOwnerUserId('');
      setListOpen(false);
      onDelegated();
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
          Feladatként küldés
        </span>
        <button type="button" onClick={onClose} className="text-indigo-700 underline">
          Bezár
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="inline-flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name={`deleg-mode-${treatment.id}`}
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
            name={`deleg-mode-${treatment.id}`}
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

      {mode === 'staff' ? (
        <div className="relative space-y-1">
          <label className="block text-[11px] text-gray-600">Címzett</label>
          <input
            type="text"
            className="form-input text-xs py-1 w-full"
            placeholder={institutionUsersLoading ? 'Felhasználók betöltése…' : 'Név vagy e-mail kezdete…'}
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
            aria-autocomplete="list"
          />
          {listOpen && assigneeInput.trim().length > 0 && !institutionUsersLoading && (
            <ul
              className="absolute z-20 left-0 right-0 mt-0.5 max-h-36 overflow-auto rounded border border-gray-200 bg-white shadow text-[11px]"
              role="listbox"
            >
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
      ) : (
        <div className="space-y-2">
          <div>
            <label className="block text-[11px] text-gray-600 mb-0.5">Külső címzett / kapcsolat</label>
            <textarea
              className="form-input text-xs py-1 w-full min-h-[48px]"
              rows={2}
              placeholder="Pl. Dr. Kiss Péter — Szájsebészet XYZ, +36…"
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
            <p className="text-[10px] text-gray-500 mt-0.5">
              A külső fél nem kap bejelentkezést; a választott kolléga (vagy te) látja a feladatot és lezárhatja, ha
              megtörtént az egyeztetés.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] text-gray-600 mb-0.5">Megjegyzés (opcionális)</label>
          <input
            className="form-input text-xs py-1 w-full"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
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
        <p className={feedback.ok ? 'text-green-800' : 'text-red-700'}>{feedback.msg}</p>
      )}

      <button
        type="button"
        className="px-2 py-1 rounded text-xs bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        disabled={
          sending ||
          institutionUsersLoading ||
          (mode === 'external' && (!selfUserId || !taskOwnerUserId || institutionUsers.length === 0))
        }
        onClick={() => void send()}
      >
        {sending ? 'Küldés…' : 'Feladat létrehozása'}
      </button>
    </div>
  );
}

// ---- Per-tooth inline component (rendered inside each tooth card) ----

interface ToothTreatmentInlineProps {
  toothNumber: string;
  isViewOnly?: boolean;
}

export function ToothTreatmentInline({ toothNumber, isViewOnly }: ToothTreatmentInlineProps) {
  const ctx = useContext(ToothTreatmentContext);
  const [adding, setAdding] = useState(false);
  const [selectedCode, setSelectedCode] = useState('');
  const [savingAdd, setSavingAdd] = useState(false);
  const [creatingEpisodeId, setCreatingEpisodeId] = useState<string | null>(null);
  const [delegateTreatmentId, setDelegateTreatmentId] = useState<string | null>(null);

  if (!ctx) return null;
  const {
    treatments,
    catalog,
    error,
    setError,
    reload,
    patientId,
    institutionUsers,
    institutionUsersLoading,
    loadInstitutionUsers,
  } = ctx;

  const toothTreatments = treatments.filter((t) => String(t.toothNumber) === toothNumber);
  const active = toothTreatments.filter((t) => !isToothTreatmentPathwayDone(t));
  const completed = toothTreatments.filter((t) => isToothTreatmentPathwayDone(t));

  const handleAdd = async () => {
    if (!selectedCode) return;
    setSavingAdd(true);
    setError(null);
    try {
      const res = await fetch(`/api/patients/${patientId}/tooth-treatments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ toothNumber: parseInt(toothNumber), treatmentCode: selectedCode }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? `Hiba (${res.status})`); return; }
      setAdding(false);
      setSelectedCode('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setSavingAdd(false);
    }
  };

  const handleDelete = async (treatmentId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/patients/${patientId}/tooth-treatments/${treatmentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) { const data = await res.json(); setError(data.error ?? `Hiba`); return; }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    }
  };

  const handleComplete = async (treatmentId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/patients/${patientId}/tooth-treatments/${treatmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'completed' }),
      });
      if (!res.ok) { const data = await res.json(); setError(data.error ?? `Hiba`); return; }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    }
  };

  const handleCreateEpisode = async (treatment: ToothTreatment) => {
    setCreatingEpisodeId(treatment.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/patients/${patientId}/tooth-treatments/${treatment.id}/create-episode`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({}) }
      );
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? `Hiba (${res.status})`); return; }
      await reload();
      window.dispatchEvent(new CustomEvent('episode-created'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setCreatingEpisodeId(null);
    }
  };

  return (
    <div className="mt-2 space-y-1.5">
      {error && (
        <div className="p-1.5 bg-red-50 border border-red-200 rounded text-red-800 text-xs">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 underline">Bezár</button>
        </div>
      )}

      {/* Active treatments */}
      {active.map((t) => {
        const statusInfo = STATUS_COLORS[t.status] ?? STATUS_COLORS.pending;
        const openDel = (t.openDelegatedTasks?.length ?? 0) > 0;
        return (
          <div key={t.id} className="text-sm bg-gray-50 rounded px-2 py-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded text-xs whitespace-nowrap ${statusInfo.bg} ${statusInfo.text}`}>
                {statusInfo.label}
              </span>
              <span className="font-medium text-sm">{t.labelHu ?? t.treatmentCode}</span>
              {openDel && (
                <span
                  className="text-[10px] px-1 py-0.5 rounded bg-indigo-100 text-indigo-900"
                  title="Ehhez a kezeléshez már van nyitott, delegált feladat"
                >
                  Feladat: {t.openDelegatedTasks!.length}
                </span>
              )}
              {!isViewOnly && (
                <div className="flex gap-1 ml-auto shrink-0 flex-wrap justify-end">
                  {(t.status === 'pending' || t.status === 'episode_linked') && (
                    <button
                      type="button"
                      onClick={() =>
                        setDelegateTreatmentId((cur) => (cur === t.id ? null : t.id))
                      }
                      className="px-1.5 py-0.5 bg-indigo-100 text-indigo-900 rounded text-xs hover:bg-indigo-200 flex items-center gap-1"
                      title="Feladat küldése egy kollégának vagy külső koordináció rögzítése"
                    >
                      <SendHorizontal className="w-3 h-3" />
                      Feladat
                    </button>
                  )}
                  {t.status === 'pending' && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleCreateEpisode(t)}
                        disabled={creatingEpisodeId === t.id}
                        className="px-1.5 py-0.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                        title="A kezelést felveszi a beteg nyitott epizódjába (ha nincs ilyen, újat nyit). Megjelenik a kezelési munkafázisok között, így ütemezhető."
                      >
                        {creatingEpisodeId === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                        Munkafázisba
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(t.id)}
                        className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200"
                        title="Törlés"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  )}
                  {t.status === 'episode_linked' && (
                    <button
                      type="button"
                      onClick={() => handleComplete(t.id)}
                      className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200 flex items-center gap-1"
                      title="Késznek jelölés"
                    >
                      <Check className="w-3 h-3" />
                      Kész
                    </button>
                  )}
                </div>
              )}
            </div>
            {!isViewOnly && delegateTreatmentId === t.id && (
              <ToothTreatmentDelegateBlock
                treatment={t}
                patientId={patientId}
                institutionUsers={institutionUsers}
                institutionUsersLoading={institutionUsersLoading}
                loadInstitutionUsers={loadInstitutionUsers}
                onClose={() => setDelegateTreatmentId(null)}
                onDelegated={() => void reload()}
              />
            )}
          </div>
        );
      })}

      {/* Completed (collapsed) */}
      {completed.length > 0 && (
        <details className="text-xs text-gray-400">
          <summary className="cursor-pointer hover:text-gray-600">{completed.length} befejezett</summary>
          <div className="mt-1 space-y-0.5 pl-1">
            {completed.map((t) => (
              <div key={t.id} className="flex gap-1 items-center flex-wrap">
                <Check className="w-3 h-3 text-green-500 shrink-0" />
                <span>{t.labelHu ?? t.treatmentCode}</span>
                {t.status !== 'completed' && t.pathwayClosed ? (
                  <span className="text-gray-400">(munkafázisban lezárva)</span>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Add button / inline form */}
      {!isViewOnly && (
        <>
          {adding ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <select
                value={selectedCode}
                onChange={(e) => setSelectedCode(e.target.value)}
                className="form-input text-sm py-1 flex-1 min-w-[120px]"
              >
                <option value="">Válassz kezelést...</option>
                {catalog.map((c) => (
                  <option key={c.code} value={c.code}>{c.labelHu}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAdd}
                disabled={savingAdd || !selectedCode}
                className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50"
              >
                {savingAdd ? '…' : 'Hozzáad'}
              </button>
              <button
                type="button"
                onClick={() => { setAdding(false); setSelectedCode(''); }}
                className="px-2 py-1 bg-gray-400 text-white rounded text-xs hover:bg-gray-500"
              >
                Mégse
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded px-1.5 py-0.5 transition-colors"
            >
              <Plus className="w-3 h-3" />
              Kezelés hozzáadása
            </button>
          )}
        </>
      )}
    </div>
  );
}

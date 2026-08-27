'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { AppointmentBookingSection } from './AppointmentBookingSection';
import {
  RECALL_RISK_LEVELS,
  normalizeRecallRiskLevel,
  recallCadenceForRisk,
  recallLabelForInterval,
  type RecallRiskLevel,
} from '@/lib/recall-cadence';

/**
 * „Gondozás" kártya (WP-3.3): rövid és hosszú távú visszarendelések EGY
 * listában, esedékesség szerint. Fejlécben a rizikócsoport-választó, amely
 * csak a JAVASOLT kadenciát állítja — semmit nem tesz kötelezővé, és magától
 * nem töröl semmit (a feleslegessé vált auto sorokat csak felajánlja).
 */

interface RecallTask {
  id: string;
  episodeId: string;
  intervalDays: number;
  source: 'auto' | 'manual' | string | null;
  label: string | null;
  dueAt: string;
  completedAt: string | null;
  appointmentId: string | null;
  appointmentStart: string | null;
  appointmentStatus: string | null;
  dentistEmail: string | null;
}

const RISK_LABELS: Record<RecallRiskLevel, string> = {
  low: 'Alacsony',
  medium: 'Közepes',
  high: 'Magas',
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function EpisodeRecallPanel({ episodeId, patientId }: { episodeId: string; patientId: string }) {
  const [tasks, setTasks] = useState<RecallTask[]>([]);
  const [riskLevel, setRiskLevel] = useState<RecallRiskLevel | null>(null);
  const [loading, setLoading] = useState(true);
  const [bookingTaskId, setBookingTaskId] = useState<string | null>(null);
  const [actingTaskId, setActingTaskId] = useState<string | null>(null);
  const [savingRisk, setSavingRisk] = useState(false);
  const [deletingObsolete, setDeletingObsolete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // „+ Visszarendelés hozzáadása" űrlap
  const [addOpen, setAddOpen] = useState(false);
  const [addDays, setAddDays] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addSaving, setAddSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [tasksResponse, episodeResponse] = await Promise.all([
        fetch(`/api/episodes/${episodeId}/recall-tasks`, { credentials: 'include' }),
        fetch(`/api/episodes/${episodeId}`, { credentials: 'include' }),
      ]);
      if (!tasksResponse.ok) throw new Error('A visszarendelések betöltése sikertelen');
      const data = await tasksResponse.json();
      setTasks(data.recallTasks ?? []);
      if (episodeResponse.ok) {
        const episodeData = await episodeResponse.json();
        const level = episodeData.episode?.recallRiskLevel ?? null;
        setRiskLevel(level && RECALL_RISK_LEVELS.includes(level) ? level : null);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hiba történt');
    } finally {
      setLoading(false);
    }
  }, [episodeId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener('episode-work-phases-reload', refresh);
    return () => window.removeEventListener('episode-work-phases-reload', refresh);
  }, [load]);

  const mutate = async (taskId: string, action: 'complete' | 'reopen') => {
    setActingTaskId(taskId);
    try {
      const response = await fetch(`/api/episodes/${episodeId}/recall-tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'A módosítás sikertelen');
      setBookingTaskId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hiba történt');
    } finally {
      setActingTaskId(null);
    }
  };

  const changeRisk = async (level: RecallRiskLevel) => {
    if (savingRisk || level === riskLevel) return;
    setSavingRisk(true);
    try {
      const response = await fetch(`/api/episodes/${episodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ recallRiskLevel: level }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'A rizikócsoport mentése sikertelen');
      setRiskLevel(data.episode?.recallRiskLevel ?? level);
      setError(null);
      // A váltás új auto sorokat hozhatott; a feleslegessé váltakat a lenti
      // ajánlat-sáv mutatja (törlés csak kifejezett kérésre).
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hiba történt');
    } finally {
      setSavingRisk(false);
    }
  };

  const submitAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    const intervalDays = Number(addDays);
    if (!Number.isInteger(intervalDays) || intervalDays <= 0) {
      setError('A visszarendeléshez pozitív egész napszám szükséges');
      return;
    }
    setAddSaving(true);
    try {
      const response = await fetch(`/api/episodes/${episodeId}/recall-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          intervalDays,
          ...(addLabel.trim() ? { label: addLabel.trim() } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'A visszarendelés felvétele sikertelen');
      setAddOpen(false);
      setAddDays('');
      setAddLabel('');
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hiba történt');
    } finally {
      setAddSaving(false);
    }
  };

  // A jelenlegi kadenciából kikerült, még szabad auto sorok — törlésre
  // FELAJÁNLVA (a szolgáltatás nem törölte őket, a döntés a felhasználóé).
  const cadence = recallCadenceForRisk(riskLevel);
  const obsoleteAutoTasks = tasks.filter(
    (task) =>
      task.source === 'auto' &&
      !task.completedAt &&
      !task.appointmentId &&
      !cadence.includes(task.intervalDays),
  );

  const deleteObsolete = async () => {
    setDeletingObsolete(true);
    try {
      for (const task of obsoleteAutoTasks) {
        const response = await fetch(`/api/episodes/${episodeId}/recall-tasks/${task.id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error ?? 'A törlés sikertelen');
        }
      }
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hiba történt');
    } finally {
      setDeletingObsolete(false);
    }
  };

  if (loading) return null;

  const now = Date.now();
  const sortedTasks = [...tasks].sort(
    (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
  );
  const effectiveRisk = normalizeRecallRiskLevel(riskLevel);

  return (
    <section className="bg-white dark:bg-gray-900 rounded-lg border border-pink-200 dark:border-pink-900 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2 min-w-0">
          <CalendarCheck2 className="w-5 h-5 text-pink-600 dark:text-pink-300 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Gondozás</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Rövid és hosszú távú visszarendelések egy listában. A foglalás kontrollkapacitásból történik.
            </p>
          </div>
        </div>

        <div className="shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Rizikócsoport:</span>
            <div
              role="group"
              aria-label="Rizikócsoport"
              className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              {RECALL_RISK_LEVELS.map((level) => {
                const selected = effectiveRisk === level;
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => void changeRisk(level)}
                    disabled={savingRisk}
                    aria-pressed={selected}
                    className={`px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
                      selected
                        ? 'bg-pink-600 text-white'
                        : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    {RISK_LABELS[level]}
                  </button>
                );
              })}
            </div>
            {savingRisk && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400 dark:text-gray-500" />}
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 max-w-xs">
            A rizikócsoport csak a javasolt kontroll-kadenciát állítja — semmit nem tesz kötelezővé, és magától nem töröl semmit.
          </p>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-300">{error}</p>}

      {obsoleteAutoTasks.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
          <p className="text-xs text-amber-800 dark:text-amber-200">
            {obsoleteAutoTasks.length} automatikus visszarendelés feleslegessé vált a jelenlegi kadenciában
            {' '}({obsoleteAutoTasks.map((t) => t.label ?? recallLabelForInterval(t.intervalDays)).join(', ')})
            {' '}— megtartható, vagy egy kattintással törölhető.
          </p>
          <button
            type="button"
            onClick={() => void deleteObsolete()}
            disabled={deletingObsolete}
            className="text-xs font-medium text-amber-800 dark:text-amber-200 underline hover:no-underline disabled:opacity-50"
          >
            {deletingObsolete ? 'Törlés…' : 'Törlés'}
          </button>
        </div>
      )}

      {sortedTasks.length === 0 && !error && (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          Ehhez az epizódhoz még nincs visszarendelés. Az automatikus kontrollok az átadás után jönnek
          létre; kézi visszarendelés bármikor felvehető.
        </p>
      )}

      <div className="mt-3 space-y-2">
        {sortedTasks.map((task) => {
          const overdue = !task.completedAt && !task.appointmentId && new Date(task.dueAt).getTime() < now;
          const label = task.label ?? recallLabelForInterval(task.intervalDays);
          return (
            <div
              key={task.id}
              className={`rounded-lg border p-3 ${
                overdue
                  ? 'border-red-300 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20'
                  : 'border-gray-200 dark:border-gray-800'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0">
                  {task.completedAt ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-300 mt-0.5 shrink-0" />
                  ) : overdue ? (
                    <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-300 mt-0.5 shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-amber-500 dark:text-amber-300 mt-0.5 shrink-0" />
                  )}
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Esedékes: {formatDate(task.dueAt)}</div>
                    {task.completedAt ? (
                      <div className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">
                        Teljesült: {new Date(task.completedAt).toLocaleString('hu-HU')}
                      </div>
                    ) : task.appointmentStart ? (
                      <div className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                        Foglalva: {new Date(task.appointmentStart).toLocaleString('hu-HU')}
                        {task.dentistEmail ? ` · ${task.dentistEmail}` : ''}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Nincs foglalva</div>
                    )}
                    {overdue && (
                      <div className="text-xs font-medium text-red-700 dark:text-red-300 mt-0.5">Lejárt</div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!task.completedAt && !task.appointmentId && (
                    <>
                      <button
                        type="button"
                        onClick={() => setBookingTaskId((current) => current === task.id ? null : task.id)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-pink-600 text-white text-xs font-medium hover:bg-pink-700"
                      >
                        Foglalás <ChevronDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void mutate(task.id, 'complete')}
                        disabled={actingTaskId === task.id}
                        className="text-xs text-gray-600 dark:text-gray-400 hover:underline disabled:opacity-50"
                        title="Ha a kontroll a rendszeren kívül már megtörtént"
                      >
                        {actingTaskId === task.id ? 'Mentés…' : 'Külső kontroll kész'}
                      </button>
                    </>
                  )}
                  {task.completedAt && !task.appointmentId && (
                    <button
                      type="button"
                      onClick={() => void mutate(task.id, 'reopen')}
                      disabled={actingTaskId === task.id}
                      className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 hover:underline disabled:opacity-50"
                    >
                      {actingTaskId === task.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                      Visszanyitás
                    </button>
                  )}
                </div>
              </div>

              {bookingTaskId === task.id && !task.appointmentId && !task.completedAt && (
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <AppointmentBookingSection
                    patientId={patientId}
                    episodeId={episodeId}
                    pool="control"
                    isViewOnly={false}
                    standalone
                    bookingOnly
                    fixedAppointmentType="recall"
                    recallTaskId={task.id}
                    onBooked={() => { setBookingTaskId(null); void load(); }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
        {addOpen ? (
          <form onSubmit={submitAdd} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              Hány nap múlva?
              <input
                type="number"
                min={1}
                step={1}
                required
                value={addDays}
                onChange={(e) => setAddDays(e.target.value)}
                placeholder="pl. 14"
                className="w-24 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400 grow max-w-sm">
              Címke (opcionális)
              <input
                type="text"
                maxLength={200}
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                placeholder="pl. 2 hetes sebgyógyulási kontroll"
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={addSaving}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-pink-600 text-white text-xs font-medium hover:bg-pink-700 disabled:opacity-50"
              >
                {addSaving ? 'Mentés…' : 'Hozzáadás'}
              </button>
              <button
                type="button"
                onClick={() => { setAddOpen(false); setAddDays(''); setAddLabel(''); }}
                className="text-xs text-gray-600 dark:text-gray-400 hover:underline"
              >
                Mégse
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-pink-700 dark:text-pink-300 hover:underline"
          >
            <Plus className="w-4 h-4" />
            Visszarendelés hozzáadása
          </button>
        )}
      </div>
    </section>
  );
}

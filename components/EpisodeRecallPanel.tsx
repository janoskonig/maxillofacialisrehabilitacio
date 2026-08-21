'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarCheck2, CheckCircle2, ChevronDown, Clock, Loader2, RotateCcw } from 'lucide-react';
import { AppointmentBookingSection } from './AppointmentBookingSection';

interface RecallTask {
  id: string;
  episodeId: string;
  intervalDays: 180 | 365;
  dueAt: string;
  completedAt: string | null;
  appointmentId: string | null;
  appointmentStart: string | null;
  appointmentStatus: string | null;
  dentistEmail: string | null;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function EpisodeRecallPanel({ episodeId, patientId }: { episodeId: string; patientId: string }) {
  const [tasks, setTasks] = useState<RecallTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookingTaskId, setBookingTaskId] = useState<string | null>(null);
  const [actingTaskId, setActingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/episodes/${episodeId}/recall-tasks`, { credentials: 'include' });
      if (!response.ok) throw new Error('A recall-feladatok betöltése sikertelen');
      const data = await response.json();
      setTasks(data.recallTasks ?? []);
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

  if (loading) return null;
  if (tasks.length === 0 && !error) return null;

  const now = Date.now();
  return (
    <section className="bg-white dark:bg-gray-900 rounded-lg border border-pink-200 dark:border-pink-900 p-4">
      <div className="flex items-start gap-2">
        <CalendarCheck2 className="w-5 h-5 text-pink-600 dark:text-pink-300 mt-0.5" />
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Recall gondozás</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Az átadástól számított 6 és 12 hónapos kontrollok. A foglalás kontrollkapacitásból történik.</p>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-300">{error}</p>}

      <div className="mt-3 space-y-2">
        {tasks.map((task) => {
          const overdue = !task.completedAt && !task.appointmentId && new Date(task.dueAt).getTime() < now;
          const label = task.intervalDays === 180 ? '6 hónapos recall' : '12 hónapos recall';
          return (
            <div key={task.id} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
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
                    {task.appointmentStart && !task.completedAt && (
                      <div className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                        Lefoglalva: {new Date(task.appointmentStart).toLocaleString('hu-HU')}
                        {task.dentistEmail ? ` · ${task.dentistEmail}` : ''}
                      </div>
                    )}
                    {task.completedAt && (
                      <div className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">Teljesítve: {new Date(task.completedAt).toLocaleString('hu-HU')}</div>
                    )}
                    {overdue && <div className="text-xs font-medium text-red-700 dark:text-red-300 mt-0.5">Lejárt — időpont szükséges</div>}
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
                        Recall foglalása <ChevronDown className="w-3 h-3" />
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
    </section>
  );
}

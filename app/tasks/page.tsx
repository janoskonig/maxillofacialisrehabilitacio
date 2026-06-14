'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState } from '@/components/ui/EmptyState';
import { QuickTaskForm } from '@/components/QuickTaskForm';
import { TaskDelegateButton } from '@/components/TaskDelegateButton';
import { ClipboardList, Loader2, UserRound } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';

type TaskItem = {
  id: string;
  taskType: string;
  title: string;
  description: string | null;
  patientId: string | null;
  patientName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  dueAt?: string | null;
};

export default function StaffTasksPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [canManage, setCanManage] = useState(false);

  const loadTasks = useCallback(async () => {
    const res = await fetch('/api/user-tasks', { credentials: 'include' });
    if (!res.ok) throw new Error('Betöltés sikertelen');
    const data = await res.json();
    setTasks(data.tasks || []);
  }, []);

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      setCanManage(user.role === 'admin');
      try {
        await loadTasks();
        await fetch('/api/user-tasks/mark-viewed', { method: 'POST', credentials: 'include' }).catch(() => {});
      } catch {
        setTasks([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [router, loadTasks]);

  return (
    <AppShell
      title="Feladataim"
      backTo="/"
      maxWidth="md"
      actions={
        canManage ? (
          <Link href="/tasks/overview" className="text-sm text-medical-primary hover:underline">
            Vezetői nézet
          </Link>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <section className="card p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Új teendő</h2>
          <QuickTaskForm onCreated={() => void loadTasks()} />
        </section>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500 gap-2">
            <Loader2 className="w-6 h-6 animate-spin" />
            Betöltés...
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Nincs nyitott feladat." />
        ) : (
          <ul className="space-y-3">
            {tasks.map((t) => (
              <li key={t.id} className="card p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start gap-3">
                  <ClipboardList className="w-5 h-5 text-medical-primary flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900">{t.title}</p>
                    {(t.patientName || t.patientId) && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-medical-primary/10 px-2 py-0.5 text-xs font-medium text-medical-primary">
                        <UserRound className="w-3.5 h-3.5" />
                        Beteg: {t.patientName || 'ismeretlen'}
                      </span>
                    )}
                    {t.description && (
                      <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{t.description}</p>
                    )}
                    {t.dueAt ? (
                      (() => {
                        const overdue = new Date(t.dueAt).getTime() < Date.now();
                        return (
                          <p
                            className={`text-sm font-medium mt-2 ${
                              overdue ? 'text-red-600' : 'text-amber-900/90'
                            }`}
                          >
                            Határidő: {format(new Date(t.dueAt), 'yyyy.MM.dd HH:mm', { locale: hu })}
                            {overdue ? ' — lejárt' : ''}
                          </p>
                        );
                      })()
                    ) : null}
                    <p className="text-xs text-gray-400 mt-2">
                      {format(new Date(t.createdAt), 'yyyy.MM.dd HH:mm', { locale: hu })}
                    </p>
                    {t.patientId && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                          href={`/patients/${t.patientId}/view#section-adminisztracio`}
                          className="text-sm text-medical-primary font-medium hover:underline"
                        >
                          Beteg karton — dokumentumok
                        </Link>
                        <Link
                          href={`/messages?patientId=${t.patientId}`}
                          className="text-sm text-gray-600 hover:underline"
                        >
                          Üzenetek
                        </Link>
                      </div>
                    )}
                    {t.taskType === 'meeting_action' &&
                      typeof t.metadata?.presentationPath === 'string' &&
                      t.metadata.presentationPath.length > 0 && (
                        <Link
                          href={t.metadata.presentationPath as string}
                          className="mt-3 inline-block text-sm text-medical-primary font-medium hover:underline"
                        >
                          Vetítés megnyitása
                        </Link>
                      )}
                    {t.taskType === 'meeting_action' &&
                      t.metadata?.source === 'tooth_treatment' &&
                      typeof t.metadata?.patientChartPath === 'string' &&
                      (t.metadata.patientChartPath as string).length > 0 && (
                        <Link
                          href={t.metadata.patientChartPath as string}
                          className="mt-3 inline-block text-sm text-medical-primary font-medium hover:underline"
                        >
                          Beteg karton (fogkezelés)
                        </Link>
                      )}
                    {t.taskType === 'staff_registration_review' && (
                      <div className="mt-3">
                        <Link
                          href="/admin"
                          className="text-sm text-medical-primary font-medium hover:underline"
                        >
                          Jóváhagyás kezelése (Admin → Felhasználók)
                        </Link>
                      </div>
                    )}
                    {(t.taskType === 'document_upload' ||
                      t.taskType === 'meeting_action' ||
                      t.taskType === 'manual') && (
                      <div className="flex flex-wrap items-start">
                        <button
                          type="button"
                          className="mt-3 text-sm btn-secondary px-3 py-1"
                          onClick={async () => {
                            const res = await fetch(`/api/user-tasks/${t.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              credentials: 'include',
                              body: JSON.stringify({ status: 'done' }),
                            });
                            if (res.ok) {
                              setTasks((prev) => prev.filter((x) => x.id !== t.id));
                            }
                          }}
                        >
                          Késznek jelölés
                        </button>
                        <TaskDelegateButton
                          taskId={t.id}
                          onDelegated={() => setTasks((prev) => prev.filter((x) => x.id !== t.id))}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

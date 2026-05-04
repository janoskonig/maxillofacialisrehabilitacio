'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { MobileBottomNav } from '@/components/mobile/MobileBottomNav';
import { ClipboardList, Loader2, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';

type TaskItem = {
  id: string;
  taskType: string;
  title: string;
  description: string | null;
  patientId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  dueAt?: string | null;
};

export default function StaffTasksPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<TaskItem[]>([]);

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      try {
        const res = await fetch('/api/user-tasks', { credentials: 'include' });
        if (!res.ok) throw new Error('Betöltés sikertelen');
        const data = await res.json();
        setTasks(data.tasks || []);
        await fetch('/api/user-tasks/mark-viewed', { method: 'POST', credentials: 'include' }).catch(() => {});
      } catch {
        setTasks([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-50 pb-mobile-nav-staff md:pb-6">
      <header className="bg-white border-b sticky top-0 z-30 max-md:mobile-safe-top">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="btn-secondary p-2"
            aria-label="Vissza"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Logo width={32} height={37} />
          <h1 className="text-lg font-semibold text-gray-900">Feladataim</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500 gap-2">
            <Loader2 className="w-6 h-6 animate-spin" />
            Betöltés...
          </div>
        ) : tasks.length === 0 ? (
          <div className="card text-center py-12 text-gray-600">
            <ClipboardList className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>Nincs nyitott feladat.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {tasks.map((t) => (
              <li key={t.id} className="card p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start gap-3">
                  <ClipboardList className="w-5 h-5 text-medical-primary flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900">{t.title}</p>
                    {t.description && (
                      <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{t.description}</p>
                    )}
                    {t.dueAt ? (
                      <p className="text-sm font-medium text-amber-900/90 mt-2">
                        Határidő: {format(new Date(t.dueAt), 'yyyy.MM.dd HH:mm', { locale: hu })}
                      </p>
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
                    {(t.taskType === 'document_upload' || t.taskType === 'meeting_action') && (
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
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      <MobileBottomNav />
    </div>
  );
}

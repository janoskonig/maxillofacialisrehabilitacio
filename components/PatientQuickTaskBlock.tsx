'use client';

import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Loader2, UserRound } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { QuickTaskForm } from './QuickTaskForm';

export interface PatientQuickTaskBlockProps {
  patientId: string;
}

type PatientTask = {
  id: string;
  taskType: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  createdAt: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  creatorName: string | null;
  creatorEmail: string | null;
};

function assigneeLabel(t: PatientTask): string {
  return t.assigneeName?.trim() || t.assigneeEmail || 'ismeretlen';
}

/**
 * Beteg kartonjáról kézi Feladataim teendő létrehozása (magamnak vagy kollégának),
 * a beteghez kötve, valamint a beteghez tartozó nyitott feladatok listája a
 * felelős nevével. Az "Adminisztráció" fülön jelenik meg.
 */
export function PatientQuickTaskBlock({ patientId }: PatientQuickTaskBlockProps) {
  const [tasks, setTasks] = useState<PatientTask[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch(`/api/patients/${patientId}/tasks`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setTasks((data.tasks ?? []) as PatientTask[]);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  return (
    <div className="card p-4">
      <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2 mb-3">
        <ClipboardList className="w-5 h-5 text-medical-primary" />
        Feladatok
      </h3>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Betöltés…
        </div>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-gray-500 mb-4">Ehhez a beteghez nincs nyitott feladat.</p>
      ) : (
        <ul className="space-y-2 mb-4">
          {tasks.map((t) => {
            const overdue = t.dueAt ? new Date(t.dueAt).getTime() < Date.now() : false;
            const delegated =
              t.creatorEmail && t.assigneeEmail && t.creatorEmail !== t.assigneeEmail;
            return (
              <li key={t.id} className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-sm font-medium text-gray-900">{t.title}</p>
                {t.description && (
                  <p className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap">{t.description}</p>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="inline-flex items-center gap-1 font-medium text-medical-primary">
                    <UserRound className="w-3.5 h-3.5" />
                    Felelős: {assigneeLabel(t)}
                  </span>
                  {delegated && (
                    <span className="text-gray-500">
                      Kiosztotta: {t.creatorName?.trim() || t.creatorEmail}
                    </span>
                  )}
                  {t.dueAt && (
                    <span className={overdue ? 'font-medium text-red-600' : 'text-amber-900/90'}>
                      Határidő: {format(new Date(t.dueAt), 'yyyy.MM.dd HH:mm', { locale: hu })}
                      {overdue ? ' — lejárt' : ''}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h4 className="text-sm font-semibold text-gray-900 mb-2">Feladat hozzáadása</h4>
      <p className="text-sm text-gray-600 mb-3">
        A teendő ehhez a beteghez kötve jön létre, és a felelős Feladataim listáján jelenik meg.
      </p>
      <QuickTaskForm patientId={patientId} onCreated={() => void loadTasks()} />
    </div>
  );
}

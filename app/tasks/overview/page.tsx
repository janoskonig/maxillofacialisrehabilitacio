'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { MobileBottomNav } from '@/components/mobile/MobileBottomNav';
import {
  ArrowLeft,
  ClipboardList,
  Loader2,
  AlertTriangle,
  Clock,
  UserRound,
} from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';

type StatusFilter = 'open' | 'done' | 'all';

type OverviewTask = {
  id: string;
  taskType: string;
  title: string;
  description: string | null;
  status: string;
  dueAt: string | null;
  createdAt: string;
  completedAt: string | null;
  overdue: boolean;
  assigneeUserId: string;
  assigneeName: string | null;
  assigneeEmail: string;
  assigneeInstitution: string | null;
  creatorName: string | null;
  creatorEmail: string | null;
  patientId: string | null;
  patientName: string | null;
};

type AssigneeSummary = {
  userId: string;
  name: string | null;
  email: string;
  open: number;
  overdue: number;
};

type Overview = {
  tasks: OverviewTask[];
  summary: {
    totalOpen: number;
    overdue: number;
    dueSoon: number;
    byAssignee: AssigneeSummary[];
  };
};

const TASK_TYPE_LABELS: Record<string, string> = {
  manual: 'Kézi teendő',
  document_upload: 'Dokumentum feltöltés',
  meeting_action: 'Konzílium feladat',
  staff_registration_review: 'Regisztráció jóváhagyás',
  ohip14: 'OHIP-14',
};

function assigneeLabel(name: string | null, email: string): string {
  return name?.trim() || email;
}

export default function TaskOverviewPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [data, setData] = useState<Overview | null>(null);

  const [status, setStatus] = useState<StatusFilter>('open');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [search, setSearch] = useState('');

  const load = useCallback(async (s: StatusFilter) => {
    const res = await fetch(`/api/tasks/overview?status=${s}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Betöltés sikertelen');
    const json = (await res.json()) as Overview;
    setData(json);
  }, []);

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      if (user.role !== 'admin') {
        setAuthorized(false);
        setLoading(false);
        return;
      }
      setAuthorized(true);
      try {
        await load(status);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const changeStatus = async (s: StatusFilter) => {
    setStatus(s);
    setLoading(true);
    try {
      await load(s);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const filteredTasks = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.tasks.filter((t) => {
      if (assigneeFilter && t.assigneeUserId !== assigneeFilter) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.patientName ?? '').toLowerCase().includes(q) ||
        assigneeLabel(t.assigneeName, t.assigneeEmail).toLowerCase().includes(q)
      );
    });
  }, [data, assigneeFilter, search]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          Betöltés…
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="card max-w-md w-full text-center p-6">
          <p className="text-gray-700">Nincs jogosultságod a vezetői nézethez.</p>
          <button className="btn-secondary mt-4" onClick={() => router.push('/')}>
            Vissza a főoldalra
          </button>
        </div>
      </div>
    );
  }

  const summary = data?.summary;

  return (
    <div className="min-h-screen bg-gray-50 pb-mobile-nav-staff md:pb-6">
      <header className="bg-white border-b sticky top-0 z-30 max-md:mobile-safe-top">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={() => router.push('/')} className="btn-secondary p-2" aria-label="Vissza">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Logo width={32} height={37} />
          <h1 className="text-lg font-semibold text-gray-900">Vezetői nézet — feladatok</h1>
          <Link href="/tasks" className="ml-auto text-sm text-medical-primary hover:underline">
            Feladataim
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Összegző kártyák */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="card p-4 flex items-center gap-3">
            <ClipboardList className="w-8 h-8 text-medical-primary" />
            <div>
              <p className="text-2xl font-bold text-gray-900">{summary?.totalOpen ?? 0}</p>
              <p className="text-sm text-gray-500">Nyitott feladat</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-red-500" />
            <div>
              <p className="text-2xl font-bold text-red-600">{summary?.overdue ?? 0}</p>
              <p className="text-sm text-gray-500">Lejárt határidő</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <Clock className="w-8 h-8 text-amber-500" />
            <div>
              <p className="text-2xl font-bold text-amber-600">{summary?.dueSoon ?? 0}</p>
              <p className="text-sm text-gray-500">7 napon belül esedékes</p>
            </div>
          </div>
        </div>

        {/* Felelősök szerinti bontás */}
        {summary && summary.byAssignee.length > 0 && (
          <section className="card p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Felelősök szerint (nyitott)</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAssigneeFilter('')}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  assigneeFilter === ''
                    ? 'bg-medical-primary text-white border-medical-primary'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                Mind ({summary.totalOpen})
              </button>
              {summary.byAssignee.map((a) => (
                <button
                  key={a.userId}
                  type="button"
                  onClick={() => setAssigneeFilter(a.userId === assigneeFilter ? '' : a.userId)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors inline-flex items-center gap-1.5 ${
                    assigneeFilter === a.userId
                      ? 'bg-medical-primary text-white border-medical-primary'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <UserRound className="w-3.5 h-3.5" />
                  {assigneeLabel(a.name, a.email)}
                  <span className="font-semibold">{a.open}</span>
                  {a.overdue > 0 && (
                    <span
                      className={`text-xs font-semibold ${
                        assigneeFilter === a.userId ? 'text-red-100' : 'text-red-600'
                      }`}
                    >
                      ({a.overdue} lejárt)
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Szűrők */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(['open', 'done', 'all'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void changeStatus(s)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  status === s ? 'bg-medical-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {s === 'open' ? 'Nyitott' : s === 'done' ? 'Lezárt (30 nap)' : 'Mind'}
              </button>
            ))}
          </div>
          <input
            type="text"
            className="form-input flex-1 min-w-[200px] text-sm"
            placeholder="Keresés: feladat, beteg vagy felelős…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Lista */}
        {filteredTasks.length === 0 ? (
          <div className="card text-center py-12 text-gray-600">
            <ClipboardList className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>Nincs a szűrőnek megfelelő feladat.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filteredTasks.map((t) => (
              <li
                key={t.id}
                className={`card p-4 ${t.overdue ? 'border-l-4 border-red-400' : ''} ${
                  t.status === 'done' ? 'opacity-70' : ''
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">
                        {TASK_TYPE_LABELS[t.taskType] ?? t.taskType}
                      </span>
                      {t.status === 'done' && (
                        <span className="text-xs rounded-full bg-green-100 text-green-700 px-2 py-0.5">
                          Lezárva
                        </span>
                      )}
                    </div>
                    <p className="font-medium text-gray-900 mt-1">{t.title}</p>
                    {t.description && (
                      <p className="text-sm text-gray-600 mt-0.5 whitespace-pre-wrap line-clamp-2">
                        {t.description}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="inline-flex items-center gap-1 font-medium text-medical-primary">
                        <UserRound className="w-3.5 h-3.5" />
                        {assigneeLabel(t.assigneeName, t.assigneeEmail)}
                      </span>
                      {t.patientId && (
                        <Link
                          href={`/patients/${t.patientId}/view#section-adminisztracio`}
                          className="text-gray-600 hover:underline"
                        >
                          Beteg: {t.patientName || 'ismeretlen'}
                        </Link>
                      )}
                      {t.creatorName && (
                        <span className="text-gray-400">Kiosztotta: {t.creatorName}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-right shrink-0 space-y-0.5">
                    {t.dueAt ? (
                      <p className={t.overdue ? 'font-semibold text-red-600' : 'text-amber-900/90'}>
                        Határidő: {format(new Date(t.dueAt), 'yyyy.MM.dd HH:mm', { locale: hu })}
                        {t.overdue ? ' — lejárt' : ''}
                      </p>
                    ) : (
                      <p className="text-gray-400">Nincs határidő</p>
                    )}
                    <p className="text-gray-400">
                      Létrehozva: {format(new Date(t.createdAt), 'yyyy.MM.dd', { locale: hu })}
                    </p>
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

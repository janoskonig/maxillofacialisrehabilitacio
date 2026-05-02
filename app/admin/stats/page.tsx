'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import {
  Users,
  UserCheck,
  Calendar,
  Clock,
  Activity,
  MessageSquare,
  FileText,
  TrendingUp,
  TrendingDown,
  ArrowLeft,
  LayoutDashboard,
  Server,
  Stethoscope,
  RefreshCw,
  BarChart3,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Timer,
  CalendarClock,
} from 'lucide-react';
import { MedicalStatisticsSection } from '@/components/MedicalStatisticsSection';

// Lazy-loaded chart components — recharts is heavy.
const AppointmentOutcomeChart = dynamic(
  () => import('@/components/charts/AppointmentOutcomeChart').then((m) => ({ default: m.AppointmentOutcomeChart })),
  { ssr: false, loading: () => <ChartSkeleton height="h-72" /> },
);
const BookingHourChart = dynamic(
  () => import('@/components/charts/BookingHourChart').then((m) => ({ default: m.BookingHourChart })),
  { ssr: false, loading: () => <ChartSkeleton height="h-60" /> },
);
const BookingWeekdayChart = dynamic(
  () => import('@/components/charts/BookingWeekdayChart').then((m) => ({ default: m.BookingWeekdayChart })),
  { ssr: false, loading: () => <ChartSkeleton height="h-60" /> },
);
const ActivityTrendChart = dynamic(
  () => import('@/components/charts/ActivityTrendChart').then((m) => ({ default: m.ActivityTrendChart })),
  { ssr: false, loading: () => <ChartSkeleton height="h-60" /> },
);
const MonthlyPatientsChart = dynamic(
  () => import('@/components/charts/MonthlyPatientsChart').then((m) => ({ default: m.MonthlyPatientsChart })),
  { ssr: false, loading: () => <ChartSkeleton height="h-60" /> },
);

type Stats = {
  generaltAt: string;
  betegek: {
    osszes: number;
    ebbenAHonapban: number;
    multHonapban: number;
    nemSzerint: Array<{ nem: string; darab: number }>;
    etiologiaSzerint: Array<{ etiologia: string; darab: number }>;
    orvosSzerint: Array<{ orvos: string; darab: number }>;
    havitTrend: Array<{ honap: string; cimke: string; darab: number }>;
  };
  felhasznalok: {
    osszes: number;
    aktiv: number;
    inaktiv: number;
    utolso30Napban: number;
    szerepkorSzerint: Array<{ szerepkor: string; osszes: number; aktiv: number }>;
  };
  idopontfoglalasok: {
    osszes: number;
    jovobeli: number;
    multbeli: number;
    ebbenAHonapban: number;
    statusSzerint: Array<{ status: string; darab: number }>;
    kimenetSzerint: Array<{ kimenet: string; darab: number }>;
    kesesekSzama: number;
    noShowArany: number;
    lemondasiArany: number;
    befejezesiArany: number;
    csucsOrak: Array<{ ora: number; cimke: string; darab: number }>;
    napiEloszlas: Array<{ napIdx: number; napNev: string; darab: number }>;
  };
  idoslotok: {
    osszes: number;
    elerheto: number;
    lefoglalt: number;
  };
  aktivitas: {
    osszes: number;
    utolso7Nap: number;
    utolso30Nap: number;
    muveletSzerint: Array<{ muvelet: string; darab: number }>;
    felhasznaloSzerint: Array<{ felhasznalo: string; darab: number }>;
    napiTrend: Array<{ datum: string; cimke: string; darab: number }>;
  };
  visszajelzesek: {
    osszes: number;
    statusSzerint: Array<{ status: string; darab: number }>;
    tipusSzerint: Array<{ tipus: string; darab: number }>;
  };
  dokumentumok: {
    osszes: number;
    utolso30Napban: number;
  };
};

type StatsTab = 'overview' | 'system' | 'medical';

function ChartSkeleton({ height = 'h-60' }: { height?: string }) {
  return (
    <div
      className={`${height} animate-pulse rounded-xl bg-gradient-to-br from-gray-100 to-gray-50`}
      aria-hidden
    />
  );
}

function maxInSeries(items: { darab: number }[]): number {
  return items.reduce((m, x) => Math.max(m, x.darab), 0);
}

function DistributionBars({
  items,
  labelKey,
  formatLabel,
  barClass = 'bg-medical-primary/80',
}: {
  items: Array<Record<string, unknown> & { darab: number }>;
  labelKey: string;
  formatLabel?: (raw: string) => string;
  barClass?: string;
}) {
  const max = maxInSeries(items);
  if (items.length === 0) {
    return <p className="text-sm text-gray-500">Nincs megjeleníthető adat.</p>;
  }
  return (
    <ul className="space-y-3" role="list">
      {items.map((item, idx) => {
        const raw = String(item[labelKey] ?? '');
        const label = formatLabel ? formatLabel(raw) : raw;
        const pct = max > 0 ? Math.round((item.darab / max) * 100) : 0;
        return (
          <li key={idx}>
            <div className="flex justify-between gap-3 text-sm">
              <span className="truncate text-gray-700" title={label}>
                {label}
              </span>
              <span className="tabular-nums font-semibold text-gray-900 shrink-0">{item.darab}</span>
            </div>
            <div
              className="mt-1.5 h-2 rounded-full bg-gray-100 overflow-hidden"
              aria-hidden
            >
              <div
                className={`h-full rounded-full transition-[width] duration-500 ease-out ${barClass}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function KpiCard({
  title,
  value,
  icon,
  accent,
  subtitle,
  trendPct,
  trendInverted = false,
}: {
  title: string;
  value: number | string;
  icon: ReactNode;
  accent: 'sky' | 'emerald' | 'violet' | 'amber' | 'rose' | 'slate' | 'indigo' | 'teal';
  subtitle?: string;
  trendPct?: number;
  trendInverted?: boolean;
}) {
  const ring: Record<typeof accent, string> = {
    sky: 'from-sky-500/15 to-sky-400/5 ring-sky-500/20',
    emerald: 'from-emerald-500/15 to-emerald-400/5 ring-emerald-500/20',
    violet: 'from-violet-500/15 to-violet-400/5 ring-violet-500/20',
    amber: 'from-amber-500/15 to-amber-400/5 ring-amber-500/20',
    rose: 'from-rose-500/15 to-rose-400/5 ring-rose-500/20',
    slate: 'from-slate-500/12 to-slate-400/5 ring-slate-400/25',
    indigo: 'from-indigo-500/15 to-indigo-400/5 ring-indigo-500/20',
    teal: 'from-teal-500/15 to-teal-400/5 ring-teal-500/20',
  };
  const iconTint: Record<typeof accent, string> = {
    sky: 'text-sky-600 bg-sky-500/10',
    emerald: 'text-emerald-600 bg-emerald-500/10',
    violet: 'text-violet-600 bg-violet-500/10',
    amber: 'text-amber-600 bg-amber-500/10',
    rose: 'text-rose-600 bg-rose-500/10',
    slate: 'text-slate-600 bg-slate-500/10',
    indigo: 'text-indigo-600 bg-indigo-500/10',
    teal: 'text-teal-600 bg-teal-500/10',
  };
  // For inverted metrics (no-show / lemondás) lower is better.
  const isPositive = trendInverted ? (trendPct ?? 0) <= 0 : (trendPct ?? 0) >= 0;
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-gray-200/80 bg-gradient-to-br p-5 shadow-soft ring-1 transition-shadow duration-300 hover:shadow-soft-md ${ring[accent]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-gray-900 tabular-nums">
            {value}
          </p>
          {subtitle ? (
            <p className="mt-1 truncate text-xs text-gray-500" title={subtitle}>
              {subtitle}
            </p>
          ) : null}
          {typeof trendPct === 'number' ? (
            <div
              className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold ${
                isPositive ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {trendPct > 0 ? '+' : ''}
              {trendPct}%
            </div>
          ) : null}
        </div>
        <div className={`shrink-0 rounded-xl p-2.5 transition-transform duration-300 group-hover:scale-105 ${iconTint[accent]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${valueClassName ?? 'text-gray-900'}`}>
        {value}
      </p>
    </div>
  );
}

function SectionShell({
  id,
  icon,
  title,
  description,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="card scroll-mt-28 border-gray-200/80 shadow-soft-md"
      aria-labelledby={`${id}-heading`}
    >
      <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-medical-primary/10 p-2 text-medical-primary">{icon}</div>
          <div>
            <h2 id={`${id}-heading`} className="text-lg font-semibold text-gray-900">
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-sm text-gray-500">{description}</p> : null}
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}

function StatsLoadingSkeleton() {
  return (
    <div className="space-y-8 animate-pulse" aria-busy="true" aria-label="Statisztikák betöltése">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 rounded-2xl bg-gray-200/80" />
        ))}
      </div>
      <div className="h-48 rounded-xl bg-gray-200/70" />
      <div className="h-64 rounded-xl bg-gray-200/70" />
    </div>
  );
}

const TAB_CONFIG: { id: StatsTab; label: string; icon: ReactNode; anchor: string }[] = [
  { id: 'overview', label: 'Áttekintés', icon: <LayoutDashboard className="h-4 w-4" />, anchor: 'stats-overview' },
  { id: 'system', label: 'Rendszer', icon: <Server className="h-4 w-4" />, anchor: 'stats-system-patients' },
  { id: 'medical', label: 'Szakmai', icon: <Stethoscope className="h-4 w-4" />, anchor: 'stats-medical' },
];

function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '—';
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 5) return 'most';
  if (diffSec < 60) return `${diffSec} mp`;
  const m = Math.round(diffSec / 60);
  if (m < 60) return `${m} perce`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} órája`;
  const d = Math.round(h / 24);
  return `${d} napja`;
}

export default function StatsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<StatsTab>('overview');
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const checkAuth = async () => {
      const user = await getCurrentUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setCurrentUser(user);
      setAuthorized(user.role === 'admin');
      setLoading(false);
    };
    checkAuth();
  }, [router]);

  const loadStats = useCallback(async () => {
    if (!authorized) return;
    setStatsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/stats', {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        setNow(Date.now());
      } else {
        const errorData = await res.json();
        setError(errorData.error || 'Hiba történt az adatok betöltésekor');
      }
    } catch (e) {
      console.error('Error loading stats:', e);
      setError('Hiba történt az adatok betöltésekor');
    } finally {
      setStatsLoading(false);
    }
  }, [authorized]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Tick relative-timestamp every 30s without re-fetching.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const formatActionName = (action: string): string => {
    const actionMap: Record<string, string> = {
      login: 'Bejelentkezés',
      heartbeat: 'Oldal megtekintés',
      patient_created: 'Beteg létrehozása',
      patient_updated: 'Beteg módosítása',
      patient_deleted: 'Beteg törlése',
      patient_viewed: 'Beteg megtekintése',
      register: 'Regisztráció',
      password_change: 'Jelszó változtatás',
      patient_search: 'Beteg keresés',
      patients_list_viewed: 'Beteglista megtekintés',
    };
    return actionMap[action] || action;
  };

  const formatStatusName = (status: string): string => {
    const statusMap: Record<string, string> = {
      pending: 'Függőben',
      approved: 'Jóváhagyva',
      rejected: 'Elutasítva',
      normal: 'Normál időpont (nincs páciens jóváhagyás)',
      open: 'Nyitott',
      in_progress: 'Folyamatban',
      resolved: 'Megoldva',
      closed: 'Lezárva',
    };
    return statusMap[status] || status;
  };

  const formatTypeName = (type: string): string => {
    const typeMap: Record<string, string> = {
      bug: 'Hibajelentés',
      error: 'Hiba',
      crash: 'Összeomlás',
      suggestion: 'Javaslat',
      other: 'Egyéb',
    };
    return typeMap[type] || type;
  };

  const scrollToAnchor = (anchor: string) => {
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleTab = (tab: StatsTab, anchor: string) => {
    setActiveTab(tab);
    scrollToAnchor(anchor);
  };

  const patientMonthDeltaPct = useMemo(() => {
    if (!stats) return 0;
    const { ebbenAHonapban, multHonapban } = stats.betegek;
    if (multHonapban > 0) {
      return Math.round(((ebbenAHonapban - multHonapban) / multHonapban) * 100);
    }
    return ebbenAHonapban > 0 ? 100 : 0;
  }, [stats]);

  const slotUtilization = useMemo(() => {
    if (!stats || stats.idoslotok.osszes <= 0) return null;
    return Math.round((stats.idoslotok.lefoglalt / stats.idoslotok.osszes) * 100);
  }, [stats]);

  const lastUpdatedLabel = useMemo(() => {
    if (!stats?.generaltAt) return '—';
    // `now` is referenced so the relative label re-renders each tick.
    void now;
    return formatRelativeTime(stats.generaltAt);
  }, [stats?.generaltAt, now]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100/80 flex items-center justify-center">
        <p className="text-gray-600">Betöltés...</p>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100/80 flex items-center justify-center p-6">
        <div className="card max-w-md w-full text-center shadow-soft-md">
          <p className="text-gray-700">Nincs jogosultsága a statisztikák megtekintéséhez.</p>
          <button className="btn-secondary mt-4" onClick={() => router.push('/')}>
            Vissza a főoldalra
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-gray-50 to-gray-100/90">
      <header className="sticky top-0 z-20 border-b border-gray-200/80 bg-white/80 shadow-sm backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Logo width={56} height={64} />
              <div>
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-6 w-6 text-medical-primary" aria-hidden />
                  <h1 className="text-2xl font-bold tracking-tight text-gray-900">Statisztikák</h1>
                </div>
                <p className="mt-0.5 text-sm text-gray-500">
                  Rendszer- és szakmai mutatók egy helyen — csak adminisztrátorok számára.
                </p>
              </div>
            </div>
            {currentUser && (
              <p className="text-sm text-gray-500 sm:text-right">
                Bejelentkezve: <span className="font-medium text-gray-700">{currentUser.email}</span>
              </p>
            )}
          </div>

          <nav
            className="-mx-4 flex gap-1 overflow-x-auto border-t border-gray-100 px-4 pb-3 pt-3 sm:mx-0 sm:px-0"
            aria-label="Statisztika szakaszok"
          >
            {TAB_CONFIG.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleTab(t.id, t.anchor)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === t.id
                    ? 'bg-medical-primary text-white shadow-soft'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/admin"
            className="inline-flex w-fit items-center gap-2 text-sm font-medium text-gray-600 transition-colors hover:text-medical-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            Vissza az admin felületre
          </Link>
          <div className="flex items-center gap-3 self-start sm:self-auto">
            <span
              className="hidden text-xs text-gray-500 sm:inline-flex sm:items-center sm:gap-1"
              aria-live="polite"
              title={stats?.generaltAt ?? ''}
            >
              <Clock className="h-3.5 w-3.5" />
              Frissítve: <span className="font-medium text-gray-700">{lastUpdatedLabel}</span>
            </span>
            <button
              type="button"
              onClick={() => loadStats()}
              disabled={statsLoading}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-soft transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${statsLoading ? 'animate-spin' : ''}`} />
              Frissítés
            </button>
          </div>
        </div>

        {statsLoading && !stats ? (
          <StatsLoadingSkeleton />
        ) : error ? (
          <div className="card border-rose-200 bg-rose-50/80 text-center shadow-soft-md">
            <p className="font-medium text-rose-900">{error}</p>
            <button type="button" className="btn-secondary mt-4" onClick={() => loadStats()}>
              Újrapróbálás
            </button>
          </div>
        ) : stats ? (
          <div className="space-y-10">
            {/* ───────── Áttekintés ───────── */}
            <div id="stats-overview" className="scroll-mt-32 space-y-6">
              <h2 className="sr-only">Áttekintés</h2>

              {/* Primary KPIs */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  title="Betegek"
                  value={stats.betegek.osszes}
                  accent="sky"
                  subtitle={`${stats.betegek.ebbenAHonapban} új ebben a hónapban`}
                  trendPct={patientMonthDeltaPct}
                  icon={<Users className="h-6 w-6" />}
                />
                <KpiCard
                  title="Felhasználók"
                  value={stats.felhasznalok.osszes}
                  accent="emerald"
                  subtitle={`${stats.felhasznalok.aktiv} aktív · ${stats.felhasznalok.utolso30Napban} új (30 nap)`}
                  icon={<UserCheck className="h-6 w-6" />}
                />
                <KpiCard
                  title="Időpontfoglalások"
                  value={stats.idopontfoglalasok.osszes}
                  accent="violet"
                  subtitle={`${stats.idopontfoglalasok.jovobeli} jövőbeli`}
                  icon={<Calendar className="h-6 w-6" />}
                />
                <KpiCard
                  title="Aktivitás"
                  value={stats.aktivitas.osszes}
                  accent="amber"
                  subtitle={`Utolsó 7 nap: ${stats.aktivitas.utolso7Nap} · 30 nap: ${stats.aktivitas.utolso30Nap}`}
                  icon={<Activity className="h-6 w-6" />}
                />
              </div>

              {/* Operational KPIs (új) */}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <KpiCard
                  title="No-show arány"
                  value={`${stats.idopontfoglalasok.noShowArany}%`}
                  accent="rose"
                  subtitle="Nem jelent meg / megjelent + nem jelent meg"
                  icon={<XCircle className="h-6 w-6" />}
                />
                <KpiCard
                  title="Lemondási arány"
                  value={`${stats.idopontfoglalasok.lemondasiArany}%`}
                  accent="amber"
                  subtitle="Lemondott / összes lezárt"
                  icon={<AlertTriangle className="h-6 w-6" />}
                />
                <KpiCard
                  title="Befejezési arány"
                  value={`${stats.idopontfoglalasok.befejezesiArany}%`}
                  accent="emerald"
                  subtitle="Sikeresen teljesült"
                  icon={<CheckCircle2 className="h-6 w-6" />}
                />
                <KpiCard
                  title="Késések"
                  value={stats.idopontfoglalasok.kesesekSzama}
                  accent="indigo"
                  subtitle="Késve érkezett betegek száma"
                  icon={<Timer className="h-6 w-6" />}
                />
              </div>

              {/* Quick glance + slot utilisation */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="card border-gray-200/80 lg:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">Gyors pillantás</h3>
                      <p className="mt-0.5 text-xs text-gray-500">
                        Dokumentumok, visszajelzések és időslot-kihasználtság.
                      </p>
                    </div>
                    <CalendarClock className="h-5 w-5 text-gray-400" aria-hidden />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <MiniStat label="Dokumentumok" value={stats.dokumentumok.osszes} />
                    <MiniStat
                      label="Dok. (30 nap)"
                      value={stats.dokumentumok.utolso30Napban}
                    />
                    <MiniStat label="Visszajelzések" value={stats.visszajelzesek.osszes} />
                    <MiniStat
                      label="Slot kihasználtság"
                      value={slotUtilization != null ? `${slotUtilization}%` : '—'}
                      valueClassName="text-violet-700"
                    />
                  </dl>
                  {slotUtilization != null ? (
                    <div className="mt-4">
                      <div className="mb-1 flex justify-between text-xs font-medium text-gray-600">
                        <span>{stats.idoslotok.lefoglalt} lefoglalt / {stats.idoslotok.osszes} összes</span>
                        <span className="tabular-nums">{slotUtilization}%</span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-medical-primary transition-[width] duration-500"
                          style={{ width: `${slotUtilization}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="card flex flex-col justify-center border-gray-200/80 bg-gradient-to-br from-medical-primary/5 to-transparent">
                  <p className="text-sm font-medium text-gray-700">Betegek — havi trend</p>
                  <p className="mt-2 text-xs text-gray-500">
                    Ebben a hónapban vs. múlt hónap; százalék a múlt hónaphoz képest.
                  </p>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="text-3xl font-bold tabular-nums text-gray-900">
                      {stats.betegek.ebbenAHonapban}
                    </span>
                    <span className="text-sm text-gray-500">/ {stats.betegek.multHonapban} előző hónap</span>
                  </div>
                  <div
                    className={`mt-2 inline-flex items-center gap-1 text-sm font-semibold ${
                      patientMonthDeltaPct >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {patientMonthDeltaPct >= 0 ? (
                      <TrendingUp className="h-4 w-4" />
                    ) : (
                      <TrendingDown className="h-4 w-4" />
                    )}
                    {patientMonthDeltaPct >= 0 ? '+' : ''}
                    {patientMonthDeltaPct}%
                  </div>
                </div>
              </div>

              {/* Trend grafikonok */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="card border-gray-200/80">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">Új betegek (12 hónap)</h3>
                      <p className="text-xs text-gray-500">Havi felvett betegek görgetett ablakban.</p>
                    </div>
                    <Users className="h-5 w-5 text-sky-500" aria-hidden />
                  </div>
                  <MonthlyPatientsChart data={stats.betegek.havitTrend} />
                </div>
                <div className="card border-gray-200/80">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">Aktivitás (utolsó 30 nap)</h3>
                      <p className="text-xs text-gray-500">Napi aktivitás-események összesítése.</p>
                    </div>
                    <Activity className="h-5 w-5 text-amber-500" aria-hidden />
                  </div>
                  <ActivityTrendChart data={stats.aktivitas.napiTrend} />
                </div>
              </div>
            </div>

            {/* ───────── Rendszer ───────── */}
            <div className="space-y-8">
              <SectionShell
                id="stats-system-patients"
                icon={<Users className="h-5 w-5" />}
                title="Betegek"
                description="Demográfia, etiológia és kezelőorvos szerinti megoszlás."
              >
                <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <MiniStat label="Ebben a hónapban" value={stats.betegek.ebbenAHonapban} />
                  <MiniStat label="Múlt hónapban" value={stats.betegek.multHonapban} />
                  <MiniStat
                    label="Változás (%)"
                    value={
                      <span
                        className={
                          patientMonthDeltaPct >= 0 ? 'text-emerald-600' : 'text-rose-600'
                        }
                      >
                        {patientMonthDeltaPct >= 0 ? '+' : ''}
                        {patientMonthDeltaPct}%
                      </span>
                    }
                  />
                </div>
                <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-gray-800">Nem szerint</h3>
                    <DistributionBars
                      items={stats.betegek.nemSzerint}
                      labelKey="nem"
                      barClass="bg-sky-500/85"
                    />
                  </div>
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-gray-800">Etiológia szerint</h3>
                    <DistributionBars
                      items={stats.betegek.etiologiaSzerint}
                      labelKey="etiologia"
                      barClass="bg-teal-500/85"
                    />
                  </div>
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-gray-800">Orvos szerint (top 10)</h3>
                    <DistributionBars
                      items={stats.betegek.orvosSzerint}
                      labelKey="orvos"
                      barClass="bg-medical-primary/85"
                    />
                  </div>
                </div>
              </SectionShell>

              <SectionShell
                id="stats-system-users"
                icon={<UserCheck className="h-5 w-5" />}
                title="Felhasználók"
                description="Aktív és inaktív fiókok, új regisztrációk és szerepkörök."
              >
                <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <MiniStat
                    label="Aktív"
                    value={stats.felhasznalok.aktiv}
                    valueClassName="text-emerald-600"
                  />
                  <MiniStat
                    label="Inaktív"
                    value={stats.felhasznalok.inaktiv}
                    valueClassName="text-rose-600"
                  />
                  <MiniStat label="Új (30 nap)" value={stats.felhasznalok.utolso30Napban} />
                  <MiniStat label="Összes" value={stats.felhasznalok.osszes} />
                </div>
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50/90">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">Szerepkör</th>
                        <th className="px-4 py-3 text-right font-semibold text-gray-600">Összes</th>
                        <th className="px-4 py-3 text-right font-semibold text-gray-600">Aktív</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {stats.felhasznalok.szerepkorSzerint.map((item, idx) => (
                        <tr
                          key={idx}
                          className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}
                        >
                          <td className="px-4 py-2.5 text-gray-800">{item.szerepkor}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-900">
                            {item.osszes}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium text-emerald-600">
                            {item.aktiv}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionShell>

              <SectionShell
                id="stats-system-appointments"
                icon={<Calendar className="h-5 w-5" />}
                title="Időpontfoglalások"
                description="Időbeli bontás, kimenetelek és foglalási csúcsidők."
              >
                <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <MiniStat
                    label="Jövőbeli"
                    value={stats.idopontfoglalasok.jovobeli}
                    valueClassName="text-sky-600"
                  />
                  <MiniStat label="Múltbeli" value={stats.idopontfoglalasok.multbeli} />
                  <MiniStat label="Ebben a hónapban" value={stats.idopontfoglalasok.ebbenAHonapban} />
                  <MiniStat label="Összes" value={stats.idopontfoglalasok.osszes} />
                </div>

                <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-gray-800">Időpontok kimenete</h3>
                    <AppointmentOutcomeChart data={stats.idopontfoglalasok.kimenetSzerint} />
                  </div>
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-gray-800">Páciens-jóváhagyás státusza</h3>
                    <DistributionBars
                      items={stats.idopontfoglalasok.statusSzerint.map((x) => ({
                        ...x,
                        label: formatStatusName(x.status),
                      }))}
                      labelKey="label"
                      barClass="bg-violet-500/85"
                    />
                  </div>
                </div>

                <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-gray-800">Csúcsidők (óránként)</h3>
                    <BookingHourChart data={stats.idopontfoglalasok.csucsOrak} />
                  </div>
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-gray-800">Hét napjai szerint</h3>
                    <BookingWeekdayChart data={stats.idopontfoglalasok.napiEloszlas} />
                  </div>
                </div>
              </SectionShell>

              <SectionShell
                id="stats-system-slots"
                icon={<Clock className="h-5 w-5" />}
                title="Időslotok"
                description="Elérhető és lefoglalt idősávok összesítése."
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <MiniStat
                    label="Elérhető"
                    value={stats.idoslotok.elerheto}
                    valueClassName="text-emerald-600"
                  />
                  <MiniStat
                    label="Lefoglalt"
                    value={stats.idoslotok.lefoglalt}
                    valueClassName="text-sky-600"
                  />
                  <MiniStat label="Összes" value={stats.idoslotok.osszes} />
                </div>
                {slotUtilization != null && (
                  <div className="mt-5">
                    <div className="mb-1 flex justify-between text-xs font-medium text-gray-600">
                      <span>Kihasználtság</span>
                      <span className="tabular-nums">{slotUtilization}%</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-medical-primary transition-[width] duration-500"
                        style={{ width: `${slotUtilization}%` }}
                      />
                    </div>
                  </div>
                )}
              </SectionShell>

              <SectionShell
                id="stats-system-activity"
                icon={<Activity className="h-5 w-5" />}
                title="Aktivitás"
                description="Rendszeresemények és legaktívabb felhasználók (top 10)."
              >
                <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <MiniStat label="Utolsó 7 nap" value={stats.aktivitas.utolso7Nap} />
                  <MiniStat label="Utolsó 30 nap" value={stats.aktivitas.utolso30Nap} />
                  <MiniStat label="Összes esemény" value={stats.aktivitas.osszes} />
                </div>
                <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-gray-800">Művelet szerint</h3>
                    <DistributionBars
                      items={stats.aktivitas.muveletSzerint.map((x) => ({
                        ...x,
                        label: formatActionName(x.muvelet),
                      }))}
                      labelKey="label"
                      barClass="bg-amber-500/85"
                    />
                  </div>
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-gray-800">Felhasználó szerint</h3>
                    <DistributionBars
                      items={stats.aktivitas.felhasznaloSzerint}
                      labelKey="felhasznalo"
                      barClass="bg-orange-500/80"
                    />
                  </div>
                </div>
              </SectionShell>

              <SectionShell
                id="stats-system-feedback"
                icon={<MessageSquare className="h-5 w-5" />}
                title="Visszajelzések"
                description="Státusz és típus szerinti bontás."
              >
                <div className="mb-6">
                  <MiniStat label="Összes bejelentés" value={stats.visszajelzesek.osszes} />
                </div>
                <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-gray-800">Státusz szerint</h3>
                    <DistributionBars
                      items={stats.visszajelzesek.statusSzerint.map((x) => ({
                        ...x,
                        label: formatStatusName(x.status),
                      }))}
                      labelKey="label"
                      barClass="bg-rose-500/80"
                    />
                  </div>
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-gray-800">Típus szerint</h3>
                    <DistributionBars
                      items={stats.visszajelzesek.tipusSzerint.map((x) => ({
                        ...x,
                        label: formatTypeName(x.tipus),
                      }))}
                      labelKey="label"
                      barClass="bg-indigo-500/80"
                    />
                  </div>
                </div>
              </SectionShell>

              <SectionShell
                id="stats-system-docs"
                icon={<FileText className="h-5 w-5" />}
                title="Dokumentumok"
                description="Tárolt dokumentumok száma és friss aktivitás."
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <MiniStat label="Összes dokumentum" value={stats.dokumentumok.osszes} />
                  <MiniStat label="Utolsó 30 napban feltöltött" value={stats.dokumentumok.utolso30Napban} />
                </div>
              </SectionShell>
            </div>

            <div id="stats-medical" className="scroll-mt-32 space-y-4 border-t border-gray-200/80 pt-10">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-medical-primary/10 p-2 text-medical-primary">
                  <Stethoscope className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Szakmai statisztikák</h2>
                  <p className="text-sm text-gray-500">
                    OHIP-14, kiosztott kezelési tervek, BNO, DMF, fog- és implantátum-eloszlások, várakozási idők és
                    orvosok leterheltsége.
                  </p>
                </div>
              </div>
              <MedicalStatisticsSection />
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

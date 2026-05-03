'use client';

/**
 * UnsuccessfulAttemptsStats — admin statisztika komponens.
 *
 * Migration 029 + PR 3 / C + PR 4 finomítások:
 *   - Időszak-választó (7 / 30 / 90 / 365 / összes)
 *   - Orvos szűrő (PR 4)
 *   - CSV export gomb (PR 4)
 *   - Heti trend mini bar chart
 *   - Top orvosok / munkafázisok / indokok bontás
 *   - Kanonikus indok-template csoportosítás (PR 4)
 *   - Beteg-név link a patient view-ra (PR 4 drilldown)
 *
 * Adatforrás: `GET /api/admin/stats/unsuccessful-attempts?days=N&doctor=X`
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  RefreshCw,
  User as UserIcon,
  Layers,
  MessageSquare,
  Download,
} from 'lucide-react';
import { downloadCsv, toCsv } from '@/lib/csv-export';

interface DoctorBucket {
  doctor: string;
  count: number;
}
interface WorkPhaseBucket {
  workPhaseCode: string;
  label: string | null;
  count: number;
}
interface ReasonBucket {
  reason: string;
  count: number;
}
interface ReasonTemplateBucket {
  template: string;
  canonical: boolean;
  count: number;
  examples?: Array<{ text: string; count: number }>;
}
interface WeeklyBucket {
  weekStart: string;
  count: number;
}
interface RecentSample {
  appointmentId: string;
  patientId: string | null;
  patientName: string | null;
  workPhaseLabel: string | null;
  workPhaseCode: string | null;
  attemptNumber: number;
  appointmentStart: string | null;
  failedAt: string | null;
  failedBy: string | null;
  reason: string | null;
}

interface AttemptDistributionBucket {
  maxAttempts: number;
  parosSzam: number;
}

interface AttemptDistributionSummary {
  osszesStepInstance: number;
  egyProba: number;
  ketProba: number;
  haromVagyTobbProba: number;
  tobbszorPct: number;
}

interface ApiResponse {
  days: number;
  doctorFilter: string | null;
  summary: {
    period: number;
    allTime: number;
  };
  byDoctor: DoctorBucket[];
  availableDoctors: string[];
  byWorkPhase: WorkPhaseBucket[];
  topReasons: ReasonBucket[];
  reasonsByTemplate: ReasonTemplateBucket[];
  weeklyTrend: WeeklyBucket[];
  recent: RecentSample[];
  attemptDistribution: AttemptDistributionBucket[];
  attemptDistributionSummary: AttemptDistributionSummary;
}

const PERIOD_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 7, label: 'Utolsó 7 nap' },
  { days: 30, label: 'Utolsó 30 nap' },
  { days: 90, label: 'Utolsó 90 nap' },
  { days: 365, label: 'Utolsó 365 nap' },
  { days: 0, label: 'Összes' },
];

function formatDateTime(iso: string | null): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('hu-HU', {
    timeZone: 'Europe/Budapest',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function formatWeekStart(iso: string): string {
  return new Date(iso).toLocaleDateString('hu-HU', {
    timeZone: 'Europe/Budapest',
    month: 'short',
    day: 'numeric',
  });
}

function buildRecentCsv(rows: RecentSample[]): string {
  return toCsv(rows, [
    { header: 'Mikor jelölve', value: (r) => r.failedAt },
    { header: 'Beteg', value: (r) => r.patientName },
    { header: 'Beteg ID', value: (r) => r.patientId },
    { header: 'Munkafázis', value: (r) => r.workPhaseLabel },
    { header: 'Munkafázis kód', value: (r) => r.workPhaseCode },
    { header: 'Próba sorszám', value: (r) => r.attemptNumber },
    { header: 'Időpont', value: (r) => r.appointmentStart },
    { header: 'Indok', value: (r) => r.reason },
    { header: 'Jelölte', value: (r) => r.failedBy },
  ]);
}

export function UnsuccessfulAttemptsStats() {
  const [days, setDays] = useState<number>(30);
  const [doctor, setDoctor] = useState<string>('');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (doctor) params.set('doctor', doctor);
      const res = await fetch(`/api/admin/stats/unsuccessful-attempts?${params}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        setError(errBody?.error ?? `Hiba történt (HTTP ${res.status})`);
        setData(null);
        return;
      }
      const body: ApiResponse = await res.json();
      setData(body);
    } catch {
      setError('Hálózati hiba');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [days, doctor]);

  useEffect(() => {
    load();
  }, [load]);

  const maxWeekly = useMemo(() => {
    if (!data?.weeklyTrend?.length) return 0;
    return data.weeklyTrend.reduce((m, w) => Math.max(m, w.count), 0);
  }, [data]);

  const handleExportCsv = () => {
    if (!data || data.recent.length === 0) return;
    const periodLabel = days === 0 ? 'osszes' : `${days}d`;
    const doctorLabel = doctor ? `_${doctor.replace(/[^a-z0-9]/gi, '-')}` : '';
    const ts = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `sikertelen-probak_${periodLabel}${doctorLabel}_${ts}.csv`,
      buildRecentCsv(data.recent)
    );
  };

  return (
    <section
      id="stats-unsuccessful-attempts"
      className="card scroll-mt-28 border-orange-200/80 shadow-soft-md"
      aria-labelledby="unsuccessful-attempts-heading"
    >
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-orange-100 p-2 text-orange-700">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h2 id="unsuccessful-attempts-heading" className="text-lg font-semibold text-gray-900">
              Sikertelen próbák
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Munkafázis-próbák, amelyek sikertelennek lettek jelölve (vizit megvolt, klinikai cél nem teljesült). Migration 029.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-sm rounded border border-gray-300 bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-medical-primary/50"
            aria-label="Időszak"
          >
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.days} value={p.days}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={doctor}
            onChange={(e) => setDoctor(e.target.value)}
            className="text-sm rounded border border-gray-300 bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-medical-primary/50 max-w-[220px]"
            aria-label="Orvos szűrő"
            disabled={!data?.availableDoctors?.length}
          >
            <option value="">Összes orvos</option>
            {data?.availableDoctors?.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={loading || !data || data.recent.length === 0}
            className="text-sm inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1.5 hover:bg-gray-50 disabled:opacity-50"
            title="A friss minta-tábla lementése CSV-ként"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="text-sm inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1.5 hover:bg-gray-50 disabled:opacity-50"
            aria-label="Frissítés"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Frissítés
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="py-12 text-center text-sm text-gray-500">Betöltés…</div>
      )}

      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-orange-100 bg-orange-50/60 px-4 py-3">
              <p className="text-xs font-medium text-orange-700">
                {days > 0 ? `Sikertelen próbák — ${data.days} nap` : 'Sikertelen próbák — összes idejű'}
                {doctor && (
                  <span className="ml-1 text-orange-900">
                    · {doctor}
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-orange-900">
                {data.summary.period}
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3">
              <p className="text-xs font-medium text-gray-500">Összes idejű (összes orvos)</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900">
                {data.summary.allTime}
              </p>
            </div>
          </div>

          {data.weeklyTrend.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-700">Heti trend (utolsó 26 hét)</h3>
              <div className="flex items-end gap-1 h-24 border-b border-gray-200 pb-1">
                {data.weeklyTrend.map((w) => {
                  const heightPct = maxWeekly > 0 ? (w.count / maxWeekly) * 100 : 0;
                  return (
                    <div
                      key={w.weekStart}
                      className="flex-1 min-w-[6px] flex flex-col items-center justify-end"
                      title={`${formatWeekStart(w.weekStart)}: ${w.count} sikertelen`}
                    >
                      <div
                        className="w-full bg-orange-400/80 rounded-t"
                        style={{ height: `${Math.max(heightPct, 2)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-gray-500">
                <span>{formatWeekStart(data.weeklyTrend[0].weekStart)}</span>
                <span>{formatWeekStart(data.weeklyTrend[data.weeklyTrend.length - 1].weekStart)}</span>
              </div>
            </div>
          )}

          {data.reasonsByTemplate.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-700 flex items-center gap-1">
                <MessageSquare className="w-4 h-4" /> Indokok kanonikus sablon szerint
              </h3>
              <p className="text-xs text-gray-500 mb-2">
                A modal chip-sablonjai exact match-cseppel csoportosítva. „Egyéb" = szabad szöveg.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {(() => {
                  const max = data.reasonsByTemplate.reduce((m, b) => Math.max(m, b.count), 0);
                  return data.reasonsByTemplate.map((b) => {
                    const widthPct = max > 0 ? (b.count / max) * 100 : 0;
                    return (
                      <div
                        key={b.template}
                        className={`rounded-lg border p-2 ${
                          b.canonical ? 'border-orange-200 bg-orange-50/40' : 'border-gray-200 bg-gray-50/60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-xs font-medium text-gray-800 leading-tight">
                            {b.template}
                          </div>
                          <div className="text-sm font-semibold tabular-nums text-gray-900 shrink-0">
                            {b.count}
                          </div>
                        </div>
                        <div className="mt-1 h-1 bg-white rounded overflow-hidden">
                          <div
                            className={`h-full ${b.canonical ? 'bg-orange-400/80' : 'bg-gray-400/80'}`}
                            style={{ width: `${Math.max(widthPct, 2)}%` }}
                          />
                        </div>
                        {!b.canonical && b.examples && b.examples.length > 0 && (
                          <div className="mt-2 space-y-0.5 max-h-32 overflow-y-auto">
                            {b.examples.map((ex, i) => (
                              <div
                                key={`${ex.text}-${i}`}
                                className="text-[11px] text-gray-600 italic flex items-start justify-between gap-2"
                                title={ex.text}
                              >
                                <span className="truncate">„{ex.text}"</span>
                                <span className="shrink-0 tabular-nums text-gray-500">×{ex.count}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <BucketList
              icon={<UserIcon className="w-4 h-4" />}
              title="Top orvosok"
              emptyHint="Nincs adat erre az időszakra."
              rows={data.byDoctor.map((b) => ({ label: b.doctor, count: b.count }))}
              maxCount={data.byDoctor[0]?.count ?? 0}
              accent="orange"
            />
            <BucketList
              icon={<Layers className="w-4 h-4" />}
              title="Top munkafázisok"
              emptyHint="Nincs adat erre az időszakra."
              rows={data.byWorkPhase.map((b) => ({
                label: b.label ?? b.workPhaseCode,
                sublabel: b.label ? b.workPhaseCode : undefined,
                count: b.count,
              }))}
              maxCount={data.byWorkPhase[0]?.count ?? 0}
              accent="blue"
            />
            <BucketList
              icon={<MessageSquare className="w-4 h-4" />}
              title="Top egyedi indok-szövegek"
              emptyHint="Nincs adat erre az időszakra."
              rows={data.topReasons.map((b) => ({ label: b.reason, count: b.count }))}
              maxCount={data.topReasons[0]?.count ?? 0}
              accent="gray"
            />
          </div>

          {data.recent.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-700">Legfrissebb sikertelen próbák</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="px-2 py-1.5">Mikor jelölve</th>
                      <th className="px-2 py-1.5">Beteg</th>
                      <th className="px-2 py-1.5">Munkafázis</th>
                      <th className="px-2 py-1.5">Próba</th>
                      <th className="px-2 py-1.5">Időpont</th>
                      <th className="px-2 py-1.5">Indok</th>
                      <th className="px-2 py-1.5">Jelölte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((r) => (
                      <tr key={r.appointmentId} className="border-b">
                        <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">
                          {formatDateTime(r.failedAt)}
                        </td>
                        <td className="px-2 py-1.5 text-gray-700">
                          {r.patientId && r.patientName ? (
                            <Link
                              href={`/patients/${r.patientId}/view`}
                              className="text-medical-primary hover:underline"
                              title="Beteg profil megnyitása"
                            >
                              {r.patientName}
                            </Link>
                          ) : (
                            r.patientName ?? <span className="text-gray-400">–</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-gray-700">
                          {r.workPhaseLabel ?? r.workPhaseCode ?? <span className="text-gray-400">–</span>}
                          {r.workPhaseLabel && r.workPhaseCode && (
                            <span className="block text-xs text-gray-400">{r.workPhaseCode}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-gray-700 tabular-nums">{r.attemptNumber}.</td>
                        <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">
                          {formatDateTime(r.appointmentStart)}
                        </td>
                        <td className="px-2 py-1.5 text-gray-700 max-w-xs">
                          <span className="italic text-orange-800" title={r.reason ?? ''}>
                            {r.reason ?? <span className="text-gray-400">–</span>}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-gray-600 text-xs">{r.failedBy ?? '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.summary.period === 0 && (
            <div className="text-center py-6 text-sm text-gray-500">
              {doctor
                ? `Ebben az időszakban ${doctor} nem jelölt sikertelennek próbát.`
                : 'Ebben az időszakban nem volt sikertelennek jelölt próba.'}
            </div>
          )}

          {/* Attempt-number eloszlás (összes idejű, NEM csak unsuccessful) */}
          {data.attemptDistributionSummary.osszesStepInstance > 0 ? (
            <div className="rounded-xl border border-orange-200/80 bg-gradient-to-br from-orange-50/40 to-white p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900">
                  Hány próbát kívántak a step-instance-ek
                </h3>
                <p className="text-xs text-gray-500">
                  (episode_id, step_code) párok minden idejű attempt_number alapján
                </p>
              </div>
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-gray-500">Összes step-instance</p>
                  <p className="text-xl font-bold tabular-nums text-gray-900">
                    {data.attemptDistributionSummary.osszesStepInstance}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">1 próba</p>
                  <p className="text-xl font-bold tabular-nums text-emerald-700">
                    {data.attemptDistributionSummary.egyProba}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">2 próba</p>
                  <p className="text-xl font-bold tabular-nums text-amber-700">
                    {data.attemptDistributionSummary.ketProba}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">3+ próba</p>
                  <p className="text-xl font-bold tabular-nums text-rose-700">
                    {data.attemptDistributionSummary.haromVagyTobbProba}
                  </p>
                </div>
              </div>
              <p className="mb-3 text-xs text-gray-600">
                Többszörösen próbált step-instance-ek aránya:{' '}
                <span className="font-semibold tabular-nums">
                  {data.attemptDistributionSummary.tobbszorPct}%
                </span>
              </p>
              <ul className="space-y-1.5">
                {data.attemptDistribution.map((b) => {
                  const max = Math.max(...data.attemptDistribution.map((x) => x.parosSzam));
                  const pct = max > 0 ? Math.round((b.parosSzam / max) * 100) : 0;
                  const tone =
                    b.maxAttempts === 1
                      ? 'bg-emerald-500/80'
                      : b.maxAttempts === 2
                        ? 'bg-amber-500/80'
                        : 'bg-rose-500/80';
                  return (
                    <li key={b.maxAttempts}>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-700">{b.maxAttempts}. próba</span>
                        <span className="tabular-nums font-semibold text-gray-900">{b.parosSzam}</span>
                      </div>
                      <div className="mt-0.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-[width] duration-500 ${tone}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

interface BucketListRow {
  label: string;
  sublabel?: string;
  count: number;
}

function BucketList({
  icon,
  title,
  rows,
  maxCount,
  emptyHint,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  rows: BucketListRow[];
  maxCount: number;
  emptyHint: string;
  accent: 'orange' | 'blue' | 'gray';
}) {
  const barColor =
    accent === 'orange'
      ? 'bg-orange-400/80'
      : accent === 'blue'
        ? 'bg-blue-400/80'
        : 'bg-gray-400/80';
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-gray-700">
        {icon}
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500 py-3 text-center">{emptyHint}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row, i) => {
            const widthPct = maxCount > 0 ? (row.count / maxCount) * 100 : 0;
            return (
              <li key={`${row.label}-${i}`} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-gray-800 truncate" title={row.label}>
                    {row.label}
                  </span>
                  <span className="font-semibold tabular-nums text-gray-700">{row.count}</span>
                </div>
                {row.sublabel && (
                  <div className="text-[10px] text-gray-400 truncate" title={row.sublabel}>
                    {row.sublabel}
                  </div>
                )}
                <div className="mt-0.5 h-1 bg-gray-100 rounded overflow-hidden">
                  <div
                    className={`h-full ${barColor}`}
                    style={{ width: `${Math.max(widthPct, 2)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

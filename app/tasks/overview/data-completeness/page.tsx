'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { completenessEditHref } from '@/lib/completeness-deeplinks';
import { AppShell } from '@/components/layout/AppShell';
import {
  Loader2,
  Users,
  AlertTriangle,
  ClipboardCheck,
  FlaskConical,
  UserRound,
  CheckCircle,
  RefreshCw,
  ExternalLink,
  Gauge,
  BadgeCheck,
  TrendingUp,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

type Snapshot = {
  snapshotDate: string;
  total: number;
  avgScore: number;
  clinicalComplete: number;
  researchReady: number;
  withWarnings: number;
};

type CohortRow = {
  key: string;
  label: string;
  count: number;
  avgScore: number;
  researchReady: number;
  withWarnings: number;
};

type MissingItem = { key: string; label: string; group: 'clinical' | 'research' };

type CompletenessRow = {
  patientId: string;
  patientName: string | null;
  kezeleoorvos: string | null;
  etiologia: string | null;
  clinicalMissing: MissingItem[];
  researchMissing: MissingItem[];
  clinicalComplete: boolean;
  researchComplete: boolean;
  naMarked: MissingItem[];
  warnings: { code: string; field: string; message: string }[];
  applicableCount: number;
  completenessScore: number;
  researchReady: boolean;
};

type FieldGap = { key: string; label: string; group: 'clinical' | 'research'; count: number };

type Report = {
  patients: CompletenessRow[];
  summary: {
    total: number;
    clinicalComplete: number;
    clinicalIncomplete: number;
    researchComplete: number;
    researchReady: number;
    withWarnings: number;
    avgCompletenessScore: number;
    missingOhipT0: number;
    byField: FieldGap[];
  };
};

/** Teljességi pontszám → badge színosztály (zöld ≥90, sárga ≥70, piros alatta). */
function scoreColor(score: number): string {
  if (score >= 90) return 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800';
  if (score >= 70) return 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
  return 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
}

type GroupFilter = 'clinical' | 'research' | 'all';

const GROUP_LABELS: Record<GroupFilter, string> = {
  clinical: 'Klinikai minimum',
  research: 'Kutatási mezők',
  all: 'Mind',
};

const editHref = completenessEditHref;

export default function DataCompletenessPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [data, setData] = useState<Report | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  const [group, setGroup] = useState<GroupFilter>('clinical');
  const [search, setSearch] = useState('');
  const [fieldFilter, setFieldFilter] = useState<string>('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch('/api/patients/data-completeness', { credentials: 'include' });
    if (!res.ok) throw new Error('Betöltés sikertelen');
    setData((await res.json()) as Report);
    // Trend (best-effort: hiba esetén csak nem rajzolunk grafikont).
    try {
      const sres = await fetch('/api/patients/completeness-snapshot?days=90', {
        credentials: 'include',
      });
      if (sres.ok) {
        const sjson = (await sres.json()) as { snapshots?: Snapshot[] };
        setSnapshots(sjson.snapshots ?? []);
      }
    } catch {
      /* a trend nem kritikus */
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } catch {
      /* a meglévő adat marad */
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  /** Egy kutatási mező N/A ("nem értelmezhető / nem ismert") jelölése / visszavonása. */
  const [naBusy, setNaBusy] = useState<string | null>(null);
  const markNa = useCallback(
    async (patientId: string, fieldKey: string, na: boolean) => {
      const busyKey = `${patientId}:${fieldKey}`;
      setNaBusy(busyKey);
      try {
        const res = await fetch(`/api/patients/${patientId}/field-na`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fieldKey, na }),
        });
        if (!res.ok) throw new Error('N/A beállítás sikertelen');
        await load();
      } catch {
        /* hiba esetén a meglévő nézet marad */
      } finally {
        setNaBusy(null);
      }
    },
    [load],
  );

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
        await load();
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  /** Az adott csoportszűrő szerinti hiánylista egy beteghez. */
  const missingFor = useCallback(
    (p: CompletenessRow): MissingItem[] => {
      if (group === 'clinical') return p.clinicalMissing;
      if (group === 'research') return p.researchMissing;
      return [...p.clinicalMissing, ...p.researchMissing];
    },
    [group],
  );

  /** Kohorsz-bontás kezelőorvosonként (kliens oldali aggregáció). */
  const cohorts = useMemo<CohortRow[]>(() => {
    if (!data) return [];
    const map = new Map<
      string,
      { count: number; scoreSum: number; researchReady: number; withWarnings: number }
    >();
    for (const p of data.patients) {
      const key = p.kezeleoorvos?.trim() || '— nincs kezelőorvos —';
      const e = map.get(key) ?? { count: 0, scoreSum: 0, researchReady: 0, withWarnings: 0 };
      e.count += 1;
      e.scoreSum += p.completenessScore;
      if (p.researchReady) e.researchReady += 1;
      if (p.warnings.length > 0) e.withWarnings += 1;
      map.set(key, e);
    }
    return Array.from(map.entries())
      .map(([key, v]) => ({
        key,
        label: key,
        count: v.count,
        avgScore: Math.round(v.scoreSum / v.count),
        researchReady: v.researchReady,
        withWarnings: v.withWarnings,
      }))
      .sort((a, b) => a.avgScore - b.avgScore || b.count - a.count);
  }, [data]);

  const visibleFieldGaps = useMemo(() => {
    if (!data) return [];
    return data.summary.byField.filter((f) => (group === 'all' ? true : f.group === group));
  }, [data, group]);

  const filteredPatients = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.patients.filter((p) => {
      const missing = missingFor(p);
      if (onlyIncomplete && missing.length === 0) return false;
      if (fieldFilter && !missing.some((m) => m.key === fieldFilter)) return false;
      if (!q) return true;
      return (
        (p.patientName ?? '').toLowerCase().includes(q) ||
        (p.kezeleoorvos ?? '').toLowerCase().includes(q)
      );
    });
  }, [data, search, fieldFilter, onlyIncomplete, missingFor]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-800/60 flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin" />
          Betöltés…
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-800/60 flex items-center justify-center p-6">
        <div className="card max-w-md w-full text-center p-6">
          <p className="text-gray-700 dark:text-gray-300">Nincs jogosultságod a vezetői nézethez.</p>
          <button className="btn-secondary mt-4" onClick={() => router.push('/')}>
            Vissza a főoldalra
          </button>
        </div>
      </div>
    );
  }

  const summary = data?.summary;

  return (
    <AppShell
      title="Vezetői nézet — adathiány"
      backTo="/"
      maxWidth="xl"
    >
      <div className="space-y-6">
        {/* Aloldal-navigáció */}
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
          <Link
            href="/tasks/overview"
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border-b-2 border-transparent"
          >
            Feladatok
          </Link>
          <span className="px-4 py-2 text-sm font-medium text-medical-primary border-b-2 border-medical-primary">
            Adathiány
          </span>
        </div>

        {/* Összegző kártyák */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="card p-4 flex items-center gap-3">
            <Users className="w-8 h-8 text-medical-primary" />
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{summary?.total ?? 0}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Beteg összesen</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-red-500 dark:text-red-400" />
            <div>
              <p className="text-2xl font-bold text-red-600 dark:text-red-300">{summary?.clinicalIncomplete ?? 0}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Klinikailag hiányos</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <FlaskConical className="w-8 h-8 text-amber-500 dark:text-amber-400" />
            <div>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-300">{summary?.missingOhipT0 ?? 0}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">OHIP-14 T0 hiányzik</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <ClipboardCheck className="w-8 h-8 text-green-600 dark:text-green-300" />
            <div>
              <p className="text-2xl font-bold text-green-700 dark:text-green-300">{summary?.clinicalComplete ?? 0}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Klinikailag teljes</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <Gauge className="w-8 h-8 text-medical-primary" />
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{summary?.avgCompletenessScore ?? 0}%</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Átlagos teljesség</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <BadgeCheck className="w-8 h-8 text-emerald-600 dark:text-emerald-300" />
            <div>
              <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{summary?.researchReady ?? 0}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Elemzésre kész</p>
            </div>
          </div>
        </div>

        {/* Trend: átlagos teljesség az idő függvényében */}
        {snapshots.length >= 2 && (
          <section className="card p-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 inline-flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-medical-primary" />
              Átlagos adat-teljesség alakulása (utolsó 90 nap)
            </h2>
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <LineChart data={snapshots} margin={{ top: 5, right: 12, bottom: 5, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="snapshotDate"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(d: string) => d.slice(5)}
                  />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v) => [`${v}%`, 'Átlagos teljesség']}
                    labelFormatter={(d) => String(d)}
                  />
                  <Line
                    type="monotone"
                    dataKey="avgScore"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* Bontás kezelőorvosonként */}
        {cohorts.length > 0 && (
          <section className="card p-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Bontás kezelőorvosonként</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b">
                    <th className="py-1.5 pr-3 font-medium">Kezelőorvos</th>
                    <th className="py-1.5 px-3 font-medium text-right">Beteg</th>
                    <th className="py-1.5 px-3 font-medium text-right">Átlag %</th>
                    <th className="py-1.5 px-3 font-medium text-right">Elemzésre kész</th>
                    <th className="py-1.5 pl-3 font-medium text-right">Figyelmeztetés</th>
                  </tr>
                </thead>
                <tbody>
                  {cohorts.map((c) => (
                    <tr key={c.key} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 text-gray-900 dark:text-gray-100">{c.label}</td>
                      <td className="py-1.5 px-3 text-right text-gray-700 dark:text-gray-300">{c.count}</td>
                      <td className="py-1.5 px-3 text-right">
                        <span className={`font-semibold rounded-full border px-2 py-0.5 ${scoreColor(c.avgScore)}`}>
                          {c.avgScore}%
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-right text-gray-700 dark:text-gray-300">
                        {c.researchReady}/{c.count}
                      </td>
                      <td className="py-1.5 pl-3 text-right text-orange-700 dark:text-orange-300">
                        {c.withWarnings > 0 ? c.withWarnings : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Csoport-váltó */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
            {(['clinical', 'research', 'all'] as GroupFilter[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  setGroup(g);
                  setFieldFilter('');
                }}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  group === g ? 'bg-medical-primary text-white' : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }`}
              >
                {GROUP_LABELS[g]}
              </button>
            ))}
          </div>
          <input
            type="text"
            className="form-input flex-1 min-w-[200px] text-sm"
            placeholder="Keresés: beteg vagy kezelőorvos neve…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 select-none">
            <input
              type="checkbox"
              checked={onlyIncomplete}
              onChange={(e) => setOnlyIncomplete(e.target.checked)}
            />
            Csak hiányos
          </label>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="btn-secondary text-sm flex items-center gap-1.5 px-3 py-2 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Frissítés
          </button>
        </div>

        {/* Mezőnkénti hiány-összegzés (kattintható szűrő) */}
        {visibleFieldGaps.length > 0 && (
          <section className="card p-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
              Hiányzó mezők gyakorisága (kattints a szűréshez)
            </h2>
            <div className="flex flex-wrap gap-2">
              {visibleFieldGaps.map((f) => {
                const active = fieldFilter === f.key;
                const isClinical = f.group === 'clinical';
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFieldFilter(active ? '' : f.key)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors inline-flex items-center gap-1.5 ${
                      active
                        ? 'bg-medical-primary text-white border-medical-primary'
                        : isClinical
                          ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40'
                          : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/40'
                    }`}
                  >
                    {f.label}
                    <span className="font-semibold">{f.count}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Beteglista */}
        {filteredPatients.length === 0 ? (
          <div className="card text-center py-12 text-gray-600 dark:text-gray-400">
            <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500 dark:text-green-400" />
            <p>Nincs a szűrőnek megfelelő beteg.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filteredPatients.map((p) => {
              const missing = missingFor(p);
              return (
                <li
                  key={p.patientId}
                  className={`card p-4 ${missing.length > 0 ? 'border-l-4 border-red-400' : 'border-l-4 border-green-400'}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/patients/${p.patientId}/view`}
                        className="font-medium text-gray-900 dark:text-gray-100 hover:underline"
                      >
                        {p.patientName || 'Névtelen beteg'}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                        {p.kezeleoorvos && (
                          <span className="inline-flex items-center gap-1">
                            <UserRound className="w-3.5 h-3.5" />
                            {p.kezeleoorvos}
                          </span>
                        )}
                        {p.etiologia && <span>{p.etiologia}</span>}
                      </div>
                      {missing.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {missing.map((m) => (
                            <span key={m.key} className="inline-flex items-center">
                              <Link
                                href={editHref(p.patientId, m.key)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Pótlás a betegűrlapon (új lapon)"
                                className={`text-xs rounded-l-full px-2 py-0.5 border inline-flex items-center gap-1 transition-colors ${
                                  m.group === 'clinical'
                                    ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40'
                                    : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/40'
                                } ${m.group === 'research' ? '' : 'rounded-r-full'}`}
                              >
                                {m.label}
                                <ExternalLink className="w-3 h-3 opacity-60" />
                              </Link>
                              {/* Kutatási mező N/A-ként jelölhető (a klinikai minimum nem). */}
                              {m.group === 'research' && (
                                <button
                                  type="button"
                                  disabled={naBusy === `${p.patientId}:${m.key}`}
                                  onClick={() => void markNa(p.patientId, m.key, true)}
                                  title="Jelölés: nem értelmezhető / nem ismert (nem számít hiánynak)"
                                  className="text-xs rounded-r-full px-1.5 py-0.5 border border-l-0 border-amber-200 dark:border-amber-800 bg-white dark:bg-gray-900 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50"
                                >
                                  N/A
                                </button>
                              )}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-green-700 dark:text-green-300 inline-flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" />
                          {group === 'research'
                            ? 'Kutatási mezők rendben'
                            : group === 'all'
                              ? 'Minden mező rendben'
                              : 'Klinikai minimum teljes'}
                        </p>
                      )}

                      {/* Plauzibilitási figyelmeztetések (pl. hibás TAJ, lehetetlen dátum). */}
                      {p.warnings.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {p.warnings.map((w) => (
                            <span
                              key={w.code}
                              title={w.message}
                              className="text-xs rounded-full px-2 py-0.5 border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 inline-flex items-center gap-1"
                            >
                              <AlertTriangle className="w-3 h-3" />
                              {w.message}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* N/A-ként megjelölt mezők (visszavonható) — csak ha a kutatási
                          csoport látszik. */}
                      {group !== 'clinical' && p.naMarked.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {p.naMarked.map((m) => (
                            <button
                              key={`na-${m.key}`}
                              type="button"
                              disabled={naBusy === `${p.patientId}:${m.key}`}
                              onClick={() => void markNa(p.patientId, m.key, false)}
                              title="N/A visszavonása (újra hiányként számít)"
                              className="text-xs rounded-full px-2 py-0.5 border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 inline-flex items-center gap-1 disabled:opacity-50"
                            >
                              {m.label}: N/A
                              <span className="opacity-60">✕</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-right shrink-0 flex flex-col items-end gap-1">
                      <span
                        title="Adat-teljességi pontszám (meglévő / értelmezhető mezők)"
                        className={`font-semibold rounded-full border px-2 py-0.5 ${scoreColor(p.completenessScore)}`}
                      >
                        {p.completenessScore}%
                      </span>
                      {missing.length > 0 && (
                        <span className="font-semibold text-red-600 dark:text-red-300">{missing.length} hiány</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

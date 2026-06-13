'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { ArrowLeft, Loader2, Download, RefreshCw, FlaskConical, ShieldCheck } from 'lucide-react';

type ContinuousStats = {
  n: number;
  missing: number;
  mean: number | null;
  sd: number | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  min: number | null;
  max: number | null;
};
type CatLevel = {
  level: string;
  overall: { n: number; pct: number };
  byGroup?: Record<string, { n: number; pct: number }>;
};
type T1Row =
  | {
      variable: string;
      label: string;
      kind: 'categorical';
      levels: CatLevel[];
      missing: { overall: number; byGroup?: Record<string, number> };
    }
  | {
      variable: string;
      label: string;
      kind: 'continuous';
      overall: ContinuousStats;
      byGroup?: Record<string, ContinuousStats>;
    };
type TableOne = { n: number; groupBy: string | null; groups: string[]; rows: T1Row[] };
type CodebookVar = {
  variable: string;
  label: string;
  type: string;
  allowedValues?: string[];
  source: string;
  notes?: string;
};
type Codebook = { version: string; generatedAt: string; variables: CodebookVar[] };
type DatasetResp = {
  success: boolean;
  mode: string;
  note?: string;
  eligibleCount: number;
  excludedCount: number;
  rows: Record<string, unknown>[];
  tableOne: TableOne;
  codebook: Codebook;
};

const GROUP_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Nincs rétegzés' },
  { value: 'etiologia', label: 'Etiológia szerint' },
  { value: 'nem', label: 'Nem szerint' },
  { value: 'radioterapia', label: 'Radioterápia szerint' },
];

function contFmt(s: ContinuousStats): string {
  if (s.mean == null) return `— (hiányzó: ${s.missing})`;
  return `${s.mean} ± ${s.sd} · med ${s.median} [${s.q1}–${s.q3}] · n=${s.n}${s.missing ? ` · hiányzó ${s.missing}` : ''}`;
}
function catFmt(c: { n: number; pct: number } | undefined): string {
  if (!c) return '—';
  return `${c.n} (${c.pct}%)`;
}

export default function AnalysisDatasetPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [data, setData] = useState<DatasetResp | null>(null);
  const [groupBy, setGroupBy] = useState('');
  const [showCodebook, setShowCodebook] = useState(false);

  const load = useCallback(async (gb: string) => {
    const qs = gb ? `?groupBy=${encodeURIComponent(gb)}` : '';
    const res = await fetch(`/api/admin/research-registry/analysis-dataset${qs}`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Betöltés sikertelen');
    setData((await res.json()) as DatasetResp);
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
        await load('');
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const onGroupChange = useCallback(
    async (gb: string) => {
      setGroupBy(gb);
      setRefreshing(true);
      try {
        await load(gb);
      } catch {
        /* a meglévő nézet marad */
      } finally {
        setRefreshing(false);
      }
    },
    [load],
  );

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
          <p className="text-gray-700">Nincs jogosultságod ehhez a nézethez.</p>
          <button className="btn-secondary mt-4" onClick={() => router.push('/')}>
            Vissza a főoldalra
          </button>
        </div>
      </div>
    );
  }

  const t1 = data?.tableOne;
  const groups = t1?.groups ?? [];
  const cols = ['Összes', ...groups];

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <header className="bg-white border-b sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={() => router.push('/admin')} className="btn-secondary p-2" aria-label="Vissza">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Logo width={32} height={37} />
          <h1 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-medical-primary" />
            Elemzésre kész kutatási adatkészlet
          </h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Állapot + vezérlők */}
        <section className="card p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Mód: <strong>{data?.mode}</strong>
            </span>
            <span className="text-sm text-gray-700">
              Jogosult beteg: <strong>{data?.eligibleCount ?? 0}</strong>
            </span>
            <span className="text-sm text-gray-500">Kizárva: {data?.excludedCount ?? 0}</span>
            <div className="flex-1" />
            <label className="text-sm text-gray-700 inline-flex items-center gap-2">
              Rétegzés:
              <select
                className="form-input text-sm py-1"
                value={groupBy}
                onChange={(e) => void onGroupChange(e.target.value)}
              >
                {GROUP_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <a
              href={`/api/admin/research-registry/analysis-dataset?format=csv`}
              className="btn-primary text-sm inline-flex items-center gap-1.5 px-3 py-2"
            >
              <Download className="w-4 h-4" />
              CSV letöltés
            </a>
            <button
              type="button"
              onClick={() => void onGroupChange(groupBy)}
              disabled={refreshing}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 px-3 py-2 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Frissítés
            </button>
          </div>
          {data?.note && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              {data.note}
            </p>
          )}
        </section>

        {/* Table 1 */}
        {t1 && (
          <section className="card p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">
              Table 1 — baseline jellemzők (n = {t1.n})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-1.5 pr-3 font-medium">Változó</th>
                    {cols.map((c) => (
                      <th key={c} className="py-1.5 px-3 font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t1.rows.map((r) =>
                    r.kind === 'continuous' ? (
                      <tr key={r.variable} className="border-b last:border-0 align-top">
                        <td className="py-1.5 pr-3 text-gray-900">{r.label}</td>
                        <td className="py-1.5 px-3 text-gray-700">{contFmt(r.overall)}</td>
                        {groups.map((g) => (
                          <td key={g} className="py-1.5 px-3 text-gray-700">
                            {r.byGroup ? contFmt(r.byGroup[g]) : '—'}
                          </td>
                        ))}
                      </tr>
                    ) : (
                      <tr key={r.variable} className="border-b last:border-0 align-top">
                        <td className="py-1.5 pr-3 text-gray-900">
                          {r.label}
                          {r.missing.overall > 0 && (
                            <span className="text-xs text-gray-400"> · hiányzó {r.missing.overall}</span>
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-gray-700">
                          {r.levels.map((l) => (
                            <div key={l.level}>
                              <span className="text-gray-500">{l.level}:</span> {catFmt(l.overall)}
                            </div>
                          ))}
                        </td>
                        {groups.map((g) => (
                          <td key={g} className="py-1.5 px-3 text-gray-700">
                            {r.levels.map((l) => (
                              <div key={l.level}>{catFmt(l.byGroup?.[g])}</div>
                            ))}
                          </td>
                        ))}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Kódkönyv */}
        {data?.codebook && (
          <section className="card p-4">
            <button
              type="button"
              onClick={() => setShowCodebook((s) => !s)}
              className="text-sm font-semibold text-gray-900"
            >
              Kódkönyv ({data.codebook.variables.length} változó) {showCodebook ? '▾' : '▸'}
            </button>
            {showCodebook && (
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-1 pr-3 font-medium">Változó</th>
                      <th className="py-1 px-3 font-medium">Címke</th>
                      <th className="py-1 px-3 font-medium">Típus</th>
                      <th className="py-1 px-3 font-medium">Engedett értékek</th>
                      <th className="py-1 pl-3 font-medium">Forrás</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.codebook.variables.map((v) => (
                      <tr key={v.variable} className="border-b last:border-0">
                        <td className="py-1 pr-3 font-mono text-gray-800">{v.variable}</td>
                        <td className="py-1 px-3 text-gray-700">{v.label}</td>
                        <td className="py-1 px-3 text-gray-500">{v.type}</td>
                        <td className="py-1 px-3 text-gray-500">{v.allowedValues?.join(', ') ?? '—'}</td>
                        <td className="py-1 pl-3 text-gray-500">{v.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

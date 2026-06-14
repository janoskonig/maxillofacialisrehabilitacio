'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import {
  emptySite,
  PERIO_UPPER,
  PERIO_LOWER,
  type PerioChartData,
  type PerioToothData,
  type PerioSite,
  type PerioSurfaceKey,
} from '@/lib/perio';

interface PerioChartProps {
  patientId: string;
  isViewOnly: boolean;
}

type Metric = 'pd' | 'rec';
type Flag = 'bop' | 'plaque';

function getTooth(data: PerioChartData, fdi: string): PerioToothData {
  return data.teeth[fdi] ?? {};
}
function getSite(tooth: PerioToothData, surface: PerioSurfaceKey): PerioSite {
  return tooth[surface] ?? emptySite();
}

export function PerioChart({ patientId, isViewOnly }: PerioChartProps) {
  const [data, setData] = useState<PerioChartData>({ teeth: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/patients/${patientId}/perio`, { credentials: 'include' });
        if (!res.ok) throw new Error('Betöltési hiba');
        const json = await res.json();
        if (!cancelled) {
          setData(json.chart && json.chart.teeth ? json.chart : { teeth: {} });
          setSavedAt(json.updatedAt ?? null);
        }
      } catch {
        if (!cancelled) setError('Nem sikerült betölteni a parodontális adatokat.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const mutateSite = useCallback(
    (fdi: string, surface: PerioSurfaceKey, mutate: (s: PerioSite) => PerioSite) => {
      setData((prev) => {
        const tooth = { ...getTooth(prev, fdi) };
        tooth[surface] = mutate(getSite(tooth, surface));
        return { teeth: { ...prev.teeth, [fdi]: tooth } };
      });
      setDirty(true);
    },
    []
  );

  const setNum = (fdi: string, surface: PerioSurfaceKey, metric: Metric, idx: number, raw: string) => {
    const n = raw === '' ? 0 : parseInt(raw, 10);
    if (Number.isNaN(n)) return;
    mutateSite(fdi, surface, (s) => {
      const arr = [...s[metric]];
      arr[idx] = Math.max(metric === 'rec' ? -5 : 0, Math.min(20, n));
      return { ...s, [metric]: arr };
    });
  };

  const toggleFlag = (fdi: string, surface: PerioSurfaceKey, flag: Flag, idx: number) => {
    if (isViewOnly) return;
    mutateSite(fdi, surface, (s) => {
      const arr = [...s[flag]];
      arr[idx] = !arr[idx];
      return { ...s, [flag]: arr };
    });
  };

  const setToothField = (fdi: string, field: 'mobility' | 'furcation', value: number) => {
    setData((prev) => ({
      teeth: { ...prev.teeth, [fdi]: { ...getTooth(prev, fdi), [field]: value } },
    }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/patients/${patientId}/perio`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ chart: data }),
      });
      if (!res.ok) throw new Error('Mentési hiba');
      const json = await res.json();
      setSavedAt(json.updatedAt ?? null);
      setDirty(false);
    } catch {
      setError('Nem sikerült menteni a parodontális adatokat.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Parodontális adatok betöltése…
      </div>
    );
  }

  const numCellCls =
    'w-7 h-6 text-center text-[11px] tabular-nums border border-gray-200 rounded dark:border-gray-700 dark:bg-gray-900';

  const renderNumRow = (teeth: number[], surface: PerioSurfaceKey, metric: Metric, label: string) => (
    <div className="flex items-center">
      <div className="w-[78px] shrink-0 pr-2 text-right text-[11px] text-gray-500 dark:text-gray-400">{label}</div>
      {teeth.map((tooth) => {
        const site = getSite(getTooth(data, String(tooth)), surface);
        return (
          <div key={tooth} className="flex shrink-0 justify-center gap-0.5" style={{ width: 90 }}>
            {[0, 1, 2].map((i) =>
              isViewOnly ? (
                <span key={i} className={`${numCellCls} inline-flex items-center justify-center ${metric === 'pd' && site.pd[i] >= 4 ? 'text-red-700 font-semibold' : 'text-gray-700 dark:text-gray-300'}`}>
                  {site[metric][i]}
                </span>
              ) : (
                <input
                  key={i}
                  type="number"
                  value={site[metric][i] === 0 ? '' : site[metric][i]}
                  placeholder="0"
                  onChange={(e) => setNum(String(tooth), surface, metric, i, e.target.value)}
                  className={`${numCellCls} ${metric === 'pd' && site.pd[i] >= 4 ? 'text-red-700 font-semibold' : ''}`}
                />
              )
            )}
          </div>
        );
      })}
    </div>
  );

  const renderFlagRow = (teeth: number[], surface: PerioSurfaceKey, flag: Flag, label: string, color: string) => (
    <div className="flex items-center">
      <div className="w-[78px] shrink-0 pr-2 text-right text-[11px] text-gray-500 dark:text-gray-400">{label}</div>
      {teeth.map((tooth) => {
        const site = getSite(getTooth(data, String(tooth)), surface);
        return (
          <div key={tooth} className="flex shrink-0 justify-center gap-1.5 items-center" style={{ width: 90 }}>
            {[0, 1, 2].map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleFlag(String(tooth), surface, flag, i)}
                disabled={isViewOnly}
                aria-label={`${tooth} ${label} ${i + 1}`}
                className="w-2.5 h-2.5 rounded-sm border border-gray-300 dark:border-gray-600"
                style={{ background: site[flag][i] ? color : 'transparent' }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );

  const renderToothNumbers = (teeth: number[]) => (
    <div className="flex items-center">
      <div className="w-[78px] shrink-0" />
      {teeth.map((tooth) => (
        <div key={tooth} className="shrink-0 text-center text-[11px] font-medium text-gray-600 dark:text-gray-300" style={{ width: 90 }}>
          {tooth}
        </div>
      ))}
    </div>
  );

  const renderToothMeta = (teeth: number[]) => (
    <div className="flex items-center">
      <div className="w-[78px] shrink-0 pr-2 text-right text-[11px] text-gray-500 dark:text-gray-400">Mob. / Furk.</div>
      {teeth.map((tooth) => {
        const t = getTooth(data, String(tooth));
        return (
          <div key={tooth} className="flex shrink-0 justify-center gap-1 items-center" style={{ width: 90 }}>
            {isViewOnly ? (
              <span className="text-[11px] text-gray-600 dark:text-gray-400">
                {(t.mobility ?? 0) || '–'} / {(t.furcation ?? 0) || '–'}
              </span>
            ) : (
              <>
                <select
                  value={t.mobility ?? 0}
                  onChange={(e) => setToothField(String(tooth), 'mobility', parseInt(e.target.value, 10))}
                  className="h-6 text-[11px] border border-gray-200 rounded dark:border-gray-700 dark:bg-gray-900"
                  aria-label={`${tooth} mobilitás`}
                >
                  {[0, 1, 2, 3].map((m) => <option key={m} value={m}>{m === 0 ? 'M–' : `M${m}`}</option>)}
                </select>
                <select
                  value={t.furcation ?? 0}
                  onChange={(e) => setToothField(String(tooth), 'furcation', parseInt(e.target.value, 10))}
                  className="h-6 text-[11px] border border-gray-200 rounded dark:border-gray-700 dark:bg-gray-900"
                  aria-label={`${tooth} furkáció`}
                >
                  {[0, 1, 2, 3].map((m) => <option key={m} value={m}>{m === 0 ? 'F–' : `F${m}`}</option>)}
                </select>
              </>
            )}
          </div>
        );
      })}
    </div>
  );

  const renderArch = (teeth: number[], oralLabel: string) => (
    <div className="overflow-x-auto pb-2">
      <div className="min-w-max space-y-1">
        <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mt-1 mb-1">Bukkális</div>
        {renderFlagRow(teeth, 'buccal', 'plaque', 'Plakk', '#EF9F27')}
        {renderFlagRow(teeth, 'buccal', 'bop', 'Vérzés', '#E24B4A')}
        {renderNumRow(teeth, 'buccal', 'pd', 'Tasak')}
        {renderNumRow(teeth, 'buccal', 'rec', 'Ínyszél')}
        <div className="py-1 border-y border-gray-200 dark:border-gray-700">{renderToothNumbers(teeth)}</div>
        {renderNumRow(teeth, 'oral', 'rec', 'Ínyszél')}
        {renderNumRow(teeth, 'oral', 'pd', 'Tasak')}
        {renderFlagRow(teeth, 'oral', 'bop', 'Vérzés', '#E24B4A')}
        {renderFlagRow(teeth, 'oral', 'plaque', 'Plakk', '#EF9F27')}
        <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mt-1 mb-1">{oralLabel}</div>
        {renderToothMeta(teeth)}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 dark:border-red-800 rounded px-3 py-2 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      <div>
        <div className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Felső állcsont</div>
        {renderArch(PERIO_UPPER, 'Palatinális')}
      </div>
      <div>
        <div className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Alsó állcsont</div>
        {renderArch(PERIO_LOWER, 'Lingvális')}
      </div>

      <div className="flex items-center gap-3 flex-wrap text-xs text-gray-600 dark:text-gray-300">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#E24B4A' }} />Vérzés (BOP)</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#EF9F27' }} />Plakk</span>
        <span className="text-gray-500 dark:text-gray-400">Tasak ≥4 mm pirosan. Mob. = mobilitás, Furk. = furkáció (0–3).</span>
      </div>

      {!isViewOnly && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Parodontális státusz mentése
          </button>
          {dirty ? (
            <span className="text-xs text-amber-600 dark:text-amber-300">Nem mentett változások</span>
          ) : savedAt ? (
            <span className="text-xs text-gray-400 dark:text-gray-500">Mentve</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, Eye, Flag, History, Loader2, Target } from 'lucide-react';
import type { ToothStatus } from '@/hooks/usePatientAutoSave';
import { Odontogram } from './patient-form/odontogram/Odontogram';

interface Snapshot {
  id: string;
  kind: 'baseline' | 'status';
  effectiveDate: string;
  fogak: Record<string, ToothStatus>;
  note: string | null;
}

interface TimelineData {
  baseline: Snapshot | null;
  snapshots: Snapshot[];
  plan: Record<string, ToothStatus>;
  current: Record<string, ToothStatus>;
}

type EntryKind = 'baseline' | 'status' | 'current' | 'plan';

interface Timepoint {
  key: string;
  kind: EntryKind;
  label: string;
  /** Megjelenített dátum (YYYY-MM-DD), ha van. */
  date?: string;
  /** Dátum-alapú azonosító, pl. „2026-06-15/1” vagy „2026-06-15/terv”. */
  code?: string;
  /** Leíró megjegyzés. */
  note?: string;
  /** Igaz, ha ez vetített (nem rögzített) állapot. */
  projected?: boolean;
  fogak: Record<string, ToothStatus>;
}

const NOOP_SET_FOGAK = (() => {}) as unknown as React.Dispatch<
  React.SetStateAction<Record<string, ToothStatus>>
>;

function formatDate(d: string): string {
  // YYYY-MM-DD → YYYY. MM. DD. (magyar)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[1]}. ${m[2]}. ${m[3]}.` : d;
}

/** Vizuális jegyek típusonként (ikon + akcentus-szín). */
const KIND_META: Record<
  EntryKind,
  { Icon: typeof Flag; accent: string; selectedBg: string }
> = {
  baseline: {
    Icon: Flag,
    accent: 'text-emerald-600 dark:text-emerald-400',
    selectedBg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800',
  },
  status: {
    Icon: Camera,
    accent: 'text-sky-600 dark:text-sky-400',
    selectedBg: 'bg-sky-50 dark:bg-sky-950/40 border-sky-300 dark:border-sky-800',
  },
  current: {
    Icon: Eye,
    accent: 'text-medical-primary',
    selectedBg: 'bg-medical-primary/10 border-medical-primary',
  },
  plan: {
    Icon: Target,
    accent: 'text-amber-600 dark:text-amber-400',
    selectedBg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800',
  },
};

export function DentalStatusTimeline({ patientId }: { patientId: string }) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>('current');

  const load = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/patients/${patientId}/dental-status-timeline`, {
        credentials: 'include',
      });
      if (res.ok) setData(await res.json());
    } catch {
      /* csendben — a viewer nem kritikus */
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handler = () => load();
    window.addEventListener('tooth-treatments-changed', handler);
    return () => window.removeEventListener('tooth-treatments-changed', handler);
  }, [load]);

  const timepoints = useMemo<Timepoint[]>(() => {
    if (!data) return [];
    const points: Timepoint[] = [];

    // Napi sorszámozás: az azonos napra eső rögzített állapotok /1, /2, … kódot kapnak,
    // időrendben (a baseline jellemzően a legkorábbi → elöl).
    const perDay: Record<string, number> = {};
    const codeFor = (dateStr: string): string => {
      const day = dateStr.slice(0, 10);
      perDay[day] = (perDay[day] ?? 0) + 1;
      return `${day}/${perDay[day]}`;
    };

    if (data.baseline) {
      points.push({
        key: 'baseline',
        kind: 'baseline',
        label: 'Felvételi',
        date: data.baseline.effectiveDate,
        code: codeFor(data.baseline.effectiveDate),
        note: data.baseline.note ?? 'Felvételkori (kiindulási) állapot',
        fogak: data.baseline.fogak,
      });
    }
    for (const s of data.snapshots) {
      points.push({
        key: s.id,
        kind: 'status',
        label: 'Státusz',
        date: s.effectiveDate,
        code: codeFor(s.effectiveDate),
        note: s.note ?? undefined,
        fogak: s.fogak,
      });
    }
    points.push({
      key: 'current',
      kind: 'current',
      label: 'Jelenlegi',
      note: 'A mostani (élő) odontogram',
      fogak: data.current,
    });

    // Kezelési terv: élő vetítés, mai dátummal címkézve + szintetikus azonosítóval.
    const today = new Date().toISOString().slice(0, 10);
    points.push({
      key: 'plan',
      kind: 'plan',
      label: 'Kezelési terv',
      date: today,
      code: `${today}/terv`,
      note: 'A nyitott kezelési igények teljesülése utáni célállapot (vetítés)',
      projected: true,
      fogak: data.plan,
    });
    return points;
  }, [data]);

  const selected = useMemo(
    () =>
      timepoints.find((t) => t.key === selectedKey) ??
      timepoints.find((t) => t.key === 'current'),
    [timepoints, selectedKey],
  );

  const hasHistory = (data?.snapshots.length ?? 0) > 0 || !!data?.baseline;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-2">
        <History className="w-4 h-4 text-medical-primary" />
        Fogazati státusz idővonal
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Felvételkori állapot → datált státuszok → jelenlegi → kezelési terv. Minden
        bejegyzés dátummal és azonosítóval (pl. <code className="font-mono">2026-06-15/1</code>)
        hivatkozható. Egy kezelés „Kész”-re állításakor automatikusan új datált státusz keletkezik.
      </p>

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Betöltés…
        </div>
      ) : !data ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
          Nem sikerült betölteni az idővonalat.
        </p>
      ) : (
        <>
          {!hasHistory && (
            <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 rounded px-2 py-1.5 mb-3">
              Még nincs rögzített előzmény. A felvételkori állapot az első kezelés
              befejezésekor rögzül; addig a „Jelenlegi” és a „Kezelési terv” látható.
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
            {/* Idővonal-lista */}
            <ol className="relative space-y-1.5">
              {timepoints.map((tp) => {
                const isSel = tp.key === (selected?.key ?? 'current');
                const meta = KIND_META[tp.kind];
                const { Icon } = meta;
                return (
                  <li key={tp.key}>
                    <button
                      type="button"
                      onClick={() => setSelectedKey(tp.key)}
                      aria-pressed={isSel}
                      className={`w-full text-left rounded-lg border px-3 py-2 flex items-start gap-2.5 transition-colors ${
                        isSel
                          ? `${meta.selectedBg} ring-1 ring-inset ring-medical-primary/30`
                          : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${meta.accent}`} />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                            {tp.label}
                            {tp.projected && (
                              <span className="ml-1.5 align-middle text-[10px] font-normal uppercase tracking-wide text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/60 rounded px-1 py-0.5">
                                vetítés
                              </span>
                            )}
                          </span>
                          {tp.date && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                              {formatDate(tp.date)}
                            </span>
                          )}
                        </span>
                        {tp.code ? (
                          <span className="mt-0.5 inline-block font-mono text-[11px] text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5">
                            {tp.code}
                          </span>
                        ) : (
                          <span className="mt-0.5 inline-block text-[11px] text-gray-400 dark:text-gray-500">
                            élő állapot
                          </span>
                        )}
                        {tp.note && (
                          <span className="block text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                            {tp.note}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>

            {/* Kiválasztott állapot odontogramja */}
            <div className="min-w-0">
              {selected && (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {selected.label}
                  </span>
                  {selected.code && (
                    <span className="font-mono text-[11px] text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5">
                      {selected.code}
                    </span>
                  )}
                  {selected.date && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {formatDate(selected.date)}
                    </span>
                  )}
                  {selected.note && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 basis-full">
                      {selected.note}
                    </span>
                  )}
                </div>
              )}
              <Odontogram
                fogak={selected?.fogak ?? {}}
                setFogak={NOOP_SET_FOGAK}
                editing={false}
                isViewOnly
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
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

interface Timepoint {
  key: string;
  label: string;
  sublabel?: string;
  title?: string;
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
    if (data.baseline) {
      points.push({
        key: 'baseline',
        label: 'Kiindulási',
        sublabel: formatDate(data.baseline.effectiveDate),
        title: 'Felvételkori állapot',
        fogak: data.baseline.fogak,
      });
    }
    for (const s of data.snapshots) {
      points.push({
        key: s.id,
        label: 'Státusz',
        sublabel: formatDate(s.effectiveDate),
        title: s.note ?? undefined,
        fogak: s.fogak,
      });
    }
    points.push({
      key: 'current',
      label: 'Jelenlegi',
      title: 'A mostani odontogram',
      fogak: data.current,
    });
    points.push({
      key: 'plan',
      label: 'Kezelési terv',
      title: 'A nyitott kezelési igények teljesülése utáni célállapot',
      fogak: data.plan,
    });
    return points;
  }, [data]);

  const selected = useMemo(
    () => timepoints.find((t) => t.key === selectedKey) ?? timepoints.find((t) => t.key === 'current'),
    [timepoints, selectedKey],
  );

  const hasHistory = (data?.snapshots.length ?? 0) > 0 || !!data?.baseline;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
        <History className="w-4 h-4 text-medical-primary" />
        Fogazati státusz idővonal
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Kiindulási állapot → kezelési terv → datált státuszok. Egy kezelés „Kész”-re
        állításakor a fog állapota automatikusan frissül és új datált státusz keletkezik.
      </p>

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Betöltés…
        </div>
      ) : !data ? (
        <p className="text-sm text-gray-500 py-2">Nem sikerült betölteni az idővonalat.</p>
      ) : (
        <>
          {!hasHistory && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-3">
              Még nincs rögzített előzmény. A kiindulási állapot az első kezelés
              befejezésekor rögzül; addig a „Jelenlegi” és a „Kezelési terv” látható.
            </p>
          )}

          <div className="flex flex-wrap gap-1.5 mb-4">
            {timepoints.map((tp) => {
              const isSel = tp.key === (selected?.key ?? 'current');
              return (
                <button
                  key={tp.key}
                  type="button"
                  onClick={() => setSelectedKey(tp.key)}
                  title={tp.title}
                  className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
                    isSel
                      ? 'bg-medical-primary text-white border-medical-primary'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <span className="font-medium">{tp.label}</span>
                  {tp.sublabel && (
                    <span className={isSel ? 'ml-1 opacity-90' : 'ml-1 text-gray-400'}>
                      {tp.sublabel}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selected?.title && (
            <p className="text-xs text-gray-500 mb-2">{selected.title}</p>
          )}

          <Odontogram
            fogak={selected?.fogak ?? {}}
            setFogak={NOOP_SET_FOGAK}
            editing={false}
            isViewOnly
          />
        </>
      )}
    </div>
  );
}

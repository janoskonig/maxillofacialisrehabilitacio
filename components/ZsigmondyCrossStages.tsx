'use client';

import { useState, useContext, createContext, useCallback, useEffect } from 'react';
import { normalizeToothData, type ToothStatus } from '@/hooks/usePatientAutoSave';
import { ToothTreatmentProvider, ToothTreatmentInline } from './ToothTreatmentPanel';
import { OPInlinePreview } from './OPInlinePreview';
import type { ToothTreatment, ToothTreatmentCatalogItem } from '@/lib/types';

const UPPER_LEFT = [18, 17, 16, 15, 14, 13, 12, 11];
const UPPER_RIGHT = [21, 22, 23, 24, 25, 26, 27, 28];
const LOWER_LEFT = [48, 47, 46, 45, 44, 43, 42, 41];
const LOWER_RIGHT = [31, 32, 33, 34, 35, 36, 37, 38];

interface ZsigmondyCrossStagesProps {
  patientId: string;
  patientName?: string;
  meglevoFogak: Record<string, ToothStatus> | undefined;
}

interface TreatmentSummaryContextValue {
  treatments: ToothTreatment[];
  loading: boolean;
}

const TreatmentSummaryContext = createContext<TreatmentSummaryContextValue>({
  treatments: [],
  loading: false,
});

function TreatmentSummaryProvider({ patientId, children }: { patientId: string; children: React.ReactNode }) {
  const [treatments, setTreatments] = useState<ToothTreatment[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/patients/${patientId}/tooth-treatments`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTreatments(data.items ?? []);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = () => load();
    window.addEventListener('tooth-treatments-changed', handler);
    return () => window.removeEventListener('tooth-treatments-changed', handler);
  }, [load]);

  return (
    <TreatmentSummaryContext.Provider value={{ treatments, loading }}>
      {children}
    </TreatmentSummaryContext.Provider>
  );
}

function ToothCell({
  tooth,
  fogak,
  selectedTooth,
  onSelect,
}: {
  tooth: number;
  fogak: Record<string, ToothStatus> | undefined;
  selectedTooth: string | null;
  onSelect: (t: string) => void;
}) {
  const toothStr = tooth.toString();
  const value = fogak?.[toothStr];
  const normalized = normalizeToothData(value);

  const isMissing = normalized?.status === 'M';
  const isPresent = normalized && normalized.status !== 'M';
  const isD = normalized?.status === 'D';
  const isF = normalized?.status === 'F';
  const isSelected = selectedTooth === toothStr;

  const { treatments } = useContext(TreatmentSummaryContext);
  const toothTreatments = treatments.filter((t) => String(t.toothNumber) === toothStr);
  const activeTreatments = toothTreatments.filter((t) => t.status !== 'completed');

  let bgColor = 'bg-white';
  let borderColor = 'border-gray-300';
  let textColor = 'text-gray-700';

  if (isSelected) {
    borderColor = 'border-medical-primary ring-2 ring-medical-primary/30';
  }

  if (isMissing) {
    bgColor = 'bg-gray-100';
    textColor = 'text-gray-400';
    borderColor = isSelected ? 'border-medical-primary ring-2 ring-medical-primary/30' : 'border-gray-300';
  } else if (isD) {
    bgColor = 'bg-red-50';
    borderColor = isSelected ? 'border-medical-primary ring-2 ring-medical-primary/30' : 'border-red-300';
    textColor = 'text-red-700';
  } else if (isF) {
    bgColor = 'bg-blue-50';
    borderColor = isSelected ? 'border-medical-primary ring-2 ring-medical-primary/30' : 'border-blue-300';
    textColor = 'text-blue-700';
  } else if (isPresent) {
    bgColor = 'bg-green-50';
    borderColor = isSelected ? 'border-medical-primary ring-2 ring-medical-primary/30' : 'border-green-300';
    textColor = 'text-green-700';
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(toothStr)}
      className={`relative w-9 h-9 sm:w-8 sm:h-8 rounded border-2 flex items-center justify-center text-xs font-semibold transition-all ${bgColor} ${borderColor} ${textColor} hover:shadow-md`}
      title={`${toothStr}. fog${isMissing ? ' (hiányzik)' : isD ? ' (szuvas)' : isF ? ' (tömött)' : isPresent ? ' (jelen van)' : ''}`}
    >
      {isMissing ? (
        <span className="text-[10px]">×</span>
      ) : (
        <span className="text-[11px]">{toothStr}</span>
      )}
      {activeTreatments.length > 0 && (
        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
          {activeTreatments.length}
        </span>
      )}
    </button>
  );
}

function ToothGrid({
  fogak,
  selectedTooth,
  onSelect,
}: {
  fogak: Record<string, ToothStatus> | undefined;
  selectedTooth: string | null;
  onSelect: (t: string) => void;
}) {
  return (
    <div className="bg-gray-50 p-3 sm:p-4 rounded-lg overflow-x-auto">
      <div className="flex justify-between mb-1.5 min-w-[540px] sm:min-w-0">
        <div className="flex gap-0.5 sm:gap-1">
          {UPPER_LEFT.map((t) => (
            <ToothCell key={t} tooth={t} fogak={fogak} selectedTooth={selectedTooth} onSelect={onSelect} />
          ))}
        </div>
        <div className="w-px bg-gray-400 mx-1 self-stretch" />
        <div className="flex gap-0.5 sm:gap-1">
          {UPPER_RIGHT.map((t) => (
            <ToothCell key={t} tooth={t} fogak={fogak} selectedTooth={selectedTooth} onSelect={onSelect} />
          ))}
        </div>
      </div>
      <div className="border-t border-gray-400 my-1" />
      <div className="flex justify-between mt-1.5 min-w-[540px] sm:min-w-0">
        <div className="flex gap-0.5 sm:gap-1">
          {LOWER_LEFT.map((t) => (
            <ToothCell key={t} tooth={t} fogak={fogak} selectedTooth={selectedTooth} onSelect={onSelect} />
          ))}
        </div>
        <div className="w-px bg-gray-400 mx-1 self-stretch" />
        <div className="flex gap-0.5 sm:gap-1">
          {LOWER_RIGHT.map((t) => (
            <ToothCell key={t} tooth={t} fogak={fogak} selectedTooth={selectedTooth} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ZsigmondyCrossStages({ patientId, patientName, meglevoFogak }: ZsigmondyCrossStagesProps) {
  const [selectedTooth, setSelectedTooth] = useState<string | null>(null);

  const handleSelect = (toothStr: string) => {
    setSelectedTooth((prev) => (prev === toothStr ? null : toothStr));
  };

  const normalized = selectedTooth ? normalizeToothData(meglevoFogak?.[selectedTooth]) : null;
  const statusLabel = normalized?.status === 'D'
    ? 'Szuvas (D)'
    : normalized?.status === 'F'
      ? 'Tömött (F)'
      : normalized?.status === 'M'
        ? 'Hiányzik (M)'
        : normalized
          ? 'Jelen van'
          : 'Nincs adat';

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-base font-semibold text-gray-900 mb-3">
        Zsigmondy-kereszt — Foganként kezelési igények
      </h3>

      <OPInlinePreview patientId={patientId} patientName={patientName} />

      <div className="flex flex-wrap gap-3 mb-3 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-50 border border-green-300" /> Jelen van</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-50 border border-red-300" /> Szuvas (D)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-50 border border-blue-300" /> Tömött (F)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100 border border-gray-300" /> Hiányzik (M)</span>
        <span className="flex items-center gap-1"><span className="relative w-3 h-3 rounded bg-white border border-gray-300"><span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-500" /></span> Kezelési igény</span>
      </div>

      <TreatmentSummaryProvider patientId={patientId}>
        <ToothGrid fogak={meglevoFogak} selectedTooth={selectedTooth} onSelect={handleSelect} />
      </TreatmentSummaryProvider>

      {selectedTooth && (
        <div className="mt-4 border border-gray-200 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-gray-900">
              {selectedTooth}. fog — <span className="font-normal text-gray-600">{statusLabel}</span>
            </h4>
            <button
              type="button"
              onClick={() => setSelectedTooth(null)}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1"
            >
              Bezár
            </button>
          </div>
          {normalized?.description && (
            <p className="text-sm text-gray-600 mb-2">{normalized.description}</p>
          )}
          <ToothTreatmentProvider patientId={patientId}>
            <ToothTreatmentInline toothNumber={selectedTooth} />
          </ToothTreatmentProvider>
        </div>
      )}
    </div>
  );
}

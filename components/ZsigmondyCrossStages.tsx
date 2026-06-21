'use client';

import { useState, useContext, createContext, useCallback, useEffect, useRef } from 'react';
import type { ToothStatus, ToothBase } from '@/hooks/usePatientAutoSave';
import { isToothTreatmentPathwayDone } from '@/lib/tooth-treatment-pathway';
import { Tooth } from './patient-form/odontogram/Tooth';
import {
  readConditions,
  BASE_LABELS,
  UPPER_ROW,
  LOWER_ROW,
} from './patient-form/odontogram/tooth-conditions';
import { ToothTreatmentProvider, ToothTreatmentInline } from './ToothTreatmentPanel';
import { OPInlinePreview } from './OPInlinePreview';
import type { ToothTreatment } from '@/lib/types';

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
  numberPosition,
}: {
  tooth: number;
  fogak: Record<string, ToothStatus> | undefined;
  selectedTooth: string | null;
  onSelect: (t: string) => void;
  numberPosition: 'below' | 'above';
}) {
  const toothStr = tooth.toString();
  const conditions = readConditions(fogak?.[toothStr]);
  const isSelected = selectedTooth === toothStr;

  const { treatments } = useContext(TreatmentSummaryContext);
  const toothTreatments = treatments.filter((t) => String(t.toothNumber) === toothStr);
  const activeTreatments = toothTreatments.filter((t) => !isToothTreatmentPathwayDone(t));
  const completedTreatments = toothTreatments.filter((t) => isToothTreatmentPathwayDone(t));

  return (
    <div className="relative">
      <Tooth
        fdi={toothStr}
        conditions={conditions}
        numberPosition={numberPosition}
        selected={isSelected}
        onClick={() => onSelect(toothStr)}
        title={`${toothStr}. fog — ${BASE_LABELS[conditions.base]}${conditions.caries ? ' (szuvas)' : ''}`}
      />
      {activeTreatments.length > 0 ? (
        <span
          className="absolute -right-1 min-w-[1rem] h-4 px-0.5 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center leading-none pointer-events-none"
          style={{ top: numberPosition === 'above' ? 9 : -3 }}
          title={`${activeTreatments.length} nyitott kezelési igény`}
        >
          {activeTreatments.length}
        </span>
      ) : completedTreatments.length > 0 ? (
        <span
          className="absolute -right-1 w-4 h-4 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center leading-none pointer-events-none"
          style={{ top: numberPosition === 'above' ? 9 : -3 }}
          title={
            completedTreatments.length > 1
              ? `${completedTreatments.length} befejezett kezelés`
              : 'Befejezett kezelés'
          }
          aria-label="Befejezett kezelés"
        >
          ✓
        </span>
      ) : null}
    </div>
  );
}

function Arch({
  teeth,
  fogak,
  numberPosition,
  selectedTooth,
  onSelect,
}: {
  teeth: number[];
  fogak: Record<string, ToothStatus> | undefined;
  numberPosition: 'below' | 'above';
  selectedTooth: string | null;
  onSelect: (t: string) => void;
}) {
  return (
    <div className="flex justify-center gap-0.5 min-w-[560px] sm:min-w-0">
      {teeth.map((t, i) => (
        <div key={t} className="flex" style={{ marginRight: i === 7 ? 10 : 0 }}>
          <ToothCell
            tooth={t}
            fogak={fogak}
            selectedTooth={selectedTooth}
            onSelect={onSelect}
            numberPosition={numberPosition}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Az egész fogív-blokkot egységesen leskálázza, hogy beférjen a rendelkezésre álló
 * szélességbe (mobil). A skálázás a teljes részfát érinti, így a fogankénti, abszolút
 * pozicionált badge-ek pixelpontosan a helyükön maradnak. Desktopon (ha elfér) scale=1,
 * és a blokk vízszintesen középre kerül.
 */
function ScaleToFit({ children }: { children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [marginLeft, setMarginLeft] = useState(0);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const recompute = () => {
      const avail = outer.clientWidth;
      const natural = inner.scrollWidth;
      if (!avail || !natural) return;
      const s = Math.min(1, avail / natural);
      setScale(s);
      setMarginLeft(Math.max(0, (avail - natural * s) / 2));
      setHeight(inner.offsetHeight * s);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outerRef} className="overflow-hidden" style={{ height }}>
      <div
        ref={innerRef}
        style={{ width: 'max-content', marginLeft, transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
        {children}
      </div>
    </div>
  );
}

const LEGEND: Array<{ base: ToothBase; label: string }> = [
  { base: 'sound', label: 'Ép' },
  { base: 'missing', label: 'Hiányzó' },
  { base: 'filled', label: 'Tömött' },
  { base: 'crown', label: 'Korona' },
  { base: 'root_canal', label: 'Gyökértömött' },
  { base: 'implant', label: 'Implantátum' },
];

export function ZsigmondyCrossStages({ patientId, patientName, meglevoFogak }: ZsigmondyCrossStagesProps) {
  const [selectedTooth, setSelectedTooth] = useState<string | null>(null);

  const handleSelect = (toothStr: string) => {
    setSelectedTooth((prev) => (prev === toothStr ? null : toothStr));
  };

  const selectedConditions = selectedTooth ? readConditions(meglevoFogak?.[selectedTooth]) : null;
  const statusLabel = selectedConditions
    ? `${BASE_LABELS[selectedConditions.base]}${selectedConditions.caries ? ' · szuvas' : ''}`
    : 'Nincs adat';

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">
        Zsigmondy-kereszt — Foganként kezelési igények
      </h3>

      <OPInlinePreview patientId={patientId} patientName={patientName} />

      <TreatmentSummaryProvider patientId={patientId}>
        <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-3 sm:p-4 overflow-x-clip">
          <ScaleToFit>
            <Arch teeth={UPPER_ROW} fogak={meglevoFogak} numberPosition="below" selectedTooth={selectedTooth} onSelect={handleSelect} />
            <div className="flex items-center gap-2 my-2">
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              <span className="text-[10px] text-gray-400 dark:text-gray-500">jobb · bal</span>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            </div>
            <Arch teeth={LOWER_ROW} fogak={meglevoFogak} numberPosition="above" selectedTooth={selectedTooth} onSelect={handleSelect} />
          </ScaleToFit>
        </div>
      </TreatmentSummaryProvider>

      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-3 text-xs text-gray-600 dark:text-gray-300 max-w-full min-w-0">
        {LEGEND.map((l) => (
          <span key={l.base} className="inline-flex items-center gap-1.5">
            <Tooth fdi={11} conditions={{ base: l.base, caries: false, periapical: false, mobility: 0 }} size={16} showNumber={false} />
            {l.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center">1</span>
          Nyitott kezelési igény
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center">✓</span>
          Befejezett kezelés
        </span>
      </div>

      {selectedTooth && (
        <div className="mt-4 border border-gray-200 dark:border-gray-800 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-gray-900 dark:text-gray-100">
              {selectedTooth}. fog — <span className="font-normal text-gray-600 dark:text-gray-400">{statusLabel}</span>
            </h4>
            <button
              type="button"
              onClick={() => setSelectedTooth(null)}
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1"
            >
              Bezár
            </button>
          </div>
          {selectedConditions?.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{selectedConditions.description}</p>
          )}
          <ToothTreatmentProvider patientId={patientId}>
            <ToothTreatmentInline toothNumber={selectedTooth} />
          </ToothTreatmentProvider>
        </div>
      )}
    </div>
  );
}

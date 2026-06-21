'use client';

import { Dispatch, SetStateAction, useState } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import type { ToothStatus, ToothBase } from '@/hooks/usePatientAutoSave';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { MobileBottomSheet } from '@/components/mobile/MobileBottomSheet';
import { Tooth } from './Tooth';
import { ToothShape } from './ToothShape';
import { ToothEditor, BaseChips } from './ToothEditor';
import { PinchPan } from './PinchPan';
import {
  readConditions,
  writeConditions,
  archSummary,
  BASE_LABELS,
  UPPER_ROW,
  LOWER_ROW,
  UPPER_TEETH,
  LOWER_TEETH,
  type ToothConditions,
} from './tooth-conditions';

interface OdontogramProps {
  fogak: Record<string, ToothStatus>;
  setFogak: Dispatch<SetStateAction<Record<string, ToothStatus>>>;
  editing: boolean;
  isViewOnly: boolean;
  /** Fábián–Fejérdy protetikai osztály mezők — az ívek köré renderelve, ha megadva. */
  fabianFelsoField?: UseFormRegisterReturn;
  fabianAlsoField?: UseFormRegisterReturn;
  fabianOptions?: readonly string[];
}

function FabianFejerdyControl({
  jaw,
  field,
  options,
  isViewOnly,
}: {
  jaw: 'felso' | 'also';
  field?: UseFormRegisterReturn;
  options?: readonly string[];
  isViewOnly: boolean;
}) {
  if (!field || !options) return null;
  return (
    <div className={`flex items-center justify-end gap-2 ${jaw === 'felso' ? 'mb-2' : 'mt-2'}`}>
      <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
        Fábián–Fejérdy · {jaw === 'felso' ? 'felső' : 'alsó'}
      </span>
      <select
        {...field}
        disabled={isViewOnly}
        className="text-xs rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 py-1 pl-2 pr-6 focus:ring-medical-primary focus:border-medical-primary disabled:opacity-100 disabled:cursor-default"
        aria-label={`Fábián–Fejérdy protetikai osztály – ${jaw === 'felso' ? 'felső' : 'alsó'} állcsont`}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

function applyTooth(
  setFogak: Dispatch<SetStateAction<Record<string, ToothStatus>>>,
  tooth: string,
  patch: Partial<ToothConditions>
) {
  setFogak((prev) => {
    const current = readConditions(prev[tooth]);
    const next: ToothConditions = { ...current, ...patch };
    const stored = writeConditions(next);
    const ns = { ...prev };
    if (stored === undefined) delete ns[tooth];
    else ns[tooth] = stored;
    return ns;
  });
}

/** Egy alapállapotot alkalmaz több fogra egyszerre (batch). */
function applyBaseToMany(
  setFogak: Dispatch<SetStateAction<Record<string, ToothStatus>>>,
  teeth: string[],
  base: ToothBase
) {
  setFogak((prev) => {
    const ns = { ...prev };
    for (const t of teeth) {
      const next: ToothConditions = { ...readConditions(prev[t]), base };
      const stored = writeConditions(next);
      if (stored === undefined) delete ns[t];
      else ns[t] = stored;
    }
    return ns;
  });
}

function setArchMissing(
  setFogak: Dispatch<SetStateAction<Record<string, ToothStatus>>>,
  teeth: string[]
) {
  setFogak((prev) => {
    const allMissing = teeth.every((t) => readConditions(prev[t]).base === 'missing');
    const ns = { ...prev };
    for (const t of teeth) {
      if (allMissing) {
        delete ns[t];
      } else {
        ns[t] = { base: 'missing' };
      }
    }
    return ns;
  });
}

const LEGEND: Array<{ base: ToothBase; label: string }> = [
  { base: 'sound', label: 'Ép' },
  { base: 'missing', label: 'Hiányzó' },
  { base: 'filled', label: 'Tömött' },
  { base: 'crown', label: 'Korona' },
  { base: 'root_canal', label: 'Gyökértömött' },
  { base: 'implant', label: 'Implantátum' },
];

// Ív-elrendezés (egyetlen, fit-to-width SVG koordinátái).
const TW = 28; // egy fog dobozszélessége
const GAP = 2; // fogak közti rés
const MID = 10; // extra rés a középvonalban (8. fog után)
const VH = 52; // viewBox magasság

function toothX(i: number): number {
  return i * (TW + GAP) + (i > 7 ? MID : 0);
}

function Arch({
  teeth,
  fogak,
  numberPosition,
  focus,
  batch,
  dim,
  onSelect,
}: {
  teeth: number[];
  fogak: Record<string, ToothStatus>;
  numberPosition: 'below' | 'above';
  focus: string | null;
  batch?: Set<string>;
  dim: boolean;
  onSelect?: (t: string) => void;
}) {
  const toothY = numberPosition === 'above' ? 11 : 0;
  const numY = numberPosition === 'above' ? 8 : 48;
  const cx = 14;
  const cy = 20;
  const W = toothX(teeth.length - 1) + TW;

  return (
    <svg
      viewBox={`0 0 ${W} ${VH}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {teeth.map((tooth, i) => {
        const t = String(tooth);
        const x = toothX(i);
        const isFocus = focus === t;
        const isBatch = batch?.has(t) ?? false;
        const op = dim && !isFocus && !isBatch ? 0.28 : 1;
        const s = isFocus ? 1.4 : 1;
        return (
          <g key={t}>
            {(isFocus || isBatch) && (
              <rect
                x={x + 1}
                y={toothY + 0.5}
                width={26}
                height={39}
                rx={6}
                fill={isBatch ? '#6366f1' : '#2563eb'}
                opacity={isBatch ? 0.18 : 0.16}
                stroke={isBatch ? '#6366f1' : '#2563eb'}
                strokeWidth={1.4}
              />
            )}
            <g
              opacity={op}
              transform={`translate(${x}, ${toothY}) translate(${cx}, ${cy}) scale(${s}) translate(${-cx}, ${-cy})`}
              style={{ transition: 'opacity .15s' }}
            >
              <ToothShape fdi={tooth} conditions={readConditions(fogak[t])} />
            </g>
            <text
              x={x + 14}
              y={numY}
              textAnchor="middle"
              fontSize="7.5"
              fill={isFocus ? '#1e40af' : '#9ca3af'}
              fontWeight={isFocus ? 700 : 400}
            >
              {tooth}
            </text>
            {onSelect && (
              <rect
                x={x}
                y={0}
                width={TW}
                height={VH}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect(t)}
              >
                <title>{t} fog</title>
              </rect>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function Odontogram({
  fogak,
  setFogak,
  editing,
  isViewOnly,
  fabianFelsoField,
  fabianAlsoField,
  fabianOptions,
}: OdontogramProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [batch, setBatch] = useState<Set<string>>(new Set());
  const [mobileWarningDismissed, setMobileWarningDismissed] = useState(false);
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const canEdit = editing && !isViewOnly;

  const upper = archSummary(fogak, UPPER_TEETH);
  const lower = archSummary(fogak, LOWER_TEETH);
  const sel = selected ? readConditions(fogak[selected]) : null;

  function handleSelect(t: string) {
    if (batchMode) {
      setBatch((prev) => {
        const ns = new Set(prev);
        if (ns.has(t)) ns.delete(t);
        else ns.add(t);
        return ns;
      });
    } else {
      setSelected((prev) => (prev === t ? null : t));
    }
  }

  function exitBatch() {
    setBatchMode(false);
    setBatch(new Set());
  }

  function applyBatch(base: ToothBase) {
    applyBaseToMany(setFogak, Array.from(batch), base);
    exitBatch();
  }

  const focusForArch = canEdit && !batchMode ? selected : null;
  const dim = canEdit && (!!selected || batch.size > 0);

  const archBlock = (
    <>
      <Arch
        teeth={UPPER_ROW}
        fogak={fogak}
        numberPosition="below"
        focus={focusForArch}
        batch={batchMode ? batch : undefined}
        dim={dim}
        onSelect={canEdit ? handleSelect : undefined}
      />
      <div className="flex items-center gap-2 my-2">
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        <span className="text-[10px] text-gray-400 dark:text-gray-500">jobb · bal</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      </div>
      <Arch
        teeth={LOWER_ROW}
        fogak={fogak}
        numberPosition="above"
        focus={focusForArch}
        batch={batchMode ? batch : undefined}
        dim={dim}
        onSelect={canEdit ? handleSelect : undefined}
      />
    </>
  );

  // A mobil szerkesztő sheet csak akkor nyíljon, ha egy fog ki van választva (nem batch).
  const sheetOpen = isMobile && canEdit && !batchMode && !!selected;
  const batchSheetOpen = isMobile && canEdit && batchMode && batch.size > 0;

  return (
    <div>
      <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-3 sm:p-4 overflow-x-clip">
        <div className="max-w-xl mx-auto min-w-0">
          <FabianFejerdyControl jaw="felso" field={fabianFelsoField} options={fabianOptions} isViewOnly={isViewOnly} />
          {isMobile ? <PinchPan>{archBlock}</PinchPan> : archBlock}
          <FabianFejerdyControl jaw="also" field={fabianAlsoField} options={fabianOptions} isViewOnly={isViewOnly} />
        </div>
      </div>

      {/* Jelmagyarázat + összegzés */}
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-3 text-xs text-gray-600 dark:text-gray-300 max-w-full min-w-0">
        {LEGEND.map((l) => (
          <span key={l.base} className="inline-flex items-center gap-1.5">
            <Tooth fdi={11} conditions={{ base: l.base, caries: false, periapical: false, mobility: 0 }} size={16} showNumber={false} />
            {l.label}
          </span>
        ))}
        <span className="basis-full sm:basis-auto sm:ml-auto min-w-0 text-gray-500 dark:text-gray-400">
          Felső: {upper.present} megvan · {upper.missing} hiányzó · Alsó: {lower.present} megvan · {lower.missing} hiányzó
        </span>
      </div>

      {canEdit && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">
          {batchMode
            ? 'Koppintson a fogakra a kijelöléshez, majd válasszon egy közös státuszt.'
            : isMobile
              ? 'Koppintson egy fogra a szerkesztéshez · két ujjal nagyíthat a pontos célzáshoz.'
              : 'Kattintson egy fogra a státusza beállításához.'}
        </p>
      )}

      {/* Szerkesztő eszköztár */}
      {canEdit && (
        <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              type="button"
              onClick={() => setArchMissing(setFogak, UPPER_TEETH)}
              className="px-3 py-1.5 text-xs rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-800/50"
            >
              Felső teljes fogatlanság
            </button>
            <button
              type="button"
              onClick={() => setArchMissing(setFogak, LOWER_TEETH)}
              className="px-3 py-1.5 text-xs rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-800/50"
            >
              Alsó teljes fogatlanság
            </button>
            <button
              type="button"
              onClick={() => {
                if (batchMode) exitBatch();
                else {
                  setBatchMode(true);
                  setSelected(null);
                }
              }}
              className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                batchMode
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-800/50'
              }`}
            >
              {batchMode ? `Több fog mód kész (${batch.size})` : 'Több fog egyszerre'}
            </button>
          </div>

          {/* Batch panel (desktop/tablet inline) */}
          {batchMode && !isMobile && (
            <div className="rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/60 dark:bg-indigo-950/30 p-3">
              {batch.size === 0 ? (
                <p className="text-sm text-indigo-700 dark:text-indigo-300">
                  Jelöljön ki fogakat az íven, majd válasszon egy közös státuszt.
                </p>
              ) : (
                <>
                  <div className="text-xs text-indigo-700 dark:text-indigo-300 mb-2 font-medium">
                    {batch.size} fog kijelölve — válasszon közös státuszt:
                  </div>
                  <BaseChips value={null} onPick={applyBatch} />
                </>
              )}
            </div>
          )}

          {/* Egy fog szerkesztője (desktop/tablet inline) */}
          {!batchMode && !isMobile && selected && sel && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <div className="flex items-center gap-2 mb-3">
                <Tooth fdi={selected} conditions={sel} size={22} showNumber={false} />
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{selected}. fog</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">({BASE_LABELS[sel.base]})</span>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="ml-auto text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  Bezárás
                </button>
              </div>
              <ToothEditor conditions={sel} onChange={(patch) => applyTooth(setFogak, selected, patch)} />
            </div>
          )}

          {!batchMode && !isMobile && !selected && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Kattintson egy fogra a státusza beállításához.
            </p>
          )}
        </div>
      )}

      {/* Mobil: egy fog szerkesztője bottom sheetben */}
      <MobileBottomSheet
        open={sheetOpen}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
        title={selected ? `${selected}. fog` : undefined}
        description={sel ? BASE_LABELS[sel.base] : undefined}
      >
        {sel && selected && (
          <div>
            {!mobileWarningDismissed && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
                <span aria-hidden>⚠️</span>
                <span className="flex-1">
                  Mobilon a pontos fogstátusz-szerkesztés nehézkes — gyors módosításra jó,
                  részletes felvételhez asztali gép ajánlott.
                </span>
                <button
                  type="button"
                  onClick={() => setMobileWarningDismissed(true)}
                  className="text-amber-600 dark:text-amber-400"
                  aria-label="Figyelmeztetés elrejtése"
                >
                  ✕
                </button>
              </div>
            )}
            <ToothEditor conditions={sel} onChange={(patch) => applyTooth(setFogak, selected, patch)} touch />
          </div>
        )}
      </MobileBottomSheet>

      {/* Mobil: batch közös státusz bottom sheetben */}
      <MobileBottomSheet
        open={batchSheetOpen}
        onOpenChange={(o) => { if (!o) setBatch(new Set()); }}
        title={`${batch.size} fog közös státusza`}
        description="Válasszon egy állapotot, amit minden kijelölt fogra alkalmazunk."
      >
        <BaseChips value={null} onPick={applyBatch} touch />
      </MobileBottomSheet>
    </div>
  );
}

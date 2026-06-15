'use client';

import { Dispatch, SetStateAction, useState } from 'react';
import type { ToothStatus, ToothBase } from '@/hooks/usePatientAutoSave';
import { Tooth } from './Tooth';
import {
  readConditions,
  writeConditions,
  archSummary,
  BASE_OPTIONS,
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

function Arch({
  teeth,
  fogak,
  numberPosition,
  selected,
  onSelect,
}: {
  teeth: number[];
  fogak: Record<string, ToothStatus>;
  numberPosition: 'below' | 'above';
  selected: string | null;
  onSelect?: (t: string) => void;
}) {
  return (
    <div className="flex justify-center gap-0.5 min-w-[560px] sm:min-w-0">
      {teeth.map((tooth, i) => {
        const t = String(tooth);
        return (
          <div key={t} className="flex" style={{ marginRight: i === 7 ? 10 : 0 }}>
            <Tooth
              fdi={t}
              conditions={readConditions(fogak[t])}
              numberPosition={numberPosition}
              selected={selected === t}
              onClick={onSelect ? () => onSelect(t) : undefined}
              title={`${t} fog`}
            />
          </div>
        );
      })}
    </div>
  );
}

export function Odontogram({ fogak, setFogak, editing, isViewOnly }: OdontogramProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const canEdit = editing && !isViewOnly;

  const upper = archSummary(fogak, UPPER_TEETH);
  const lower = archSummary(fogak, LOWER_TEETH);

  const sel = selected ? readConditions(fogak[selected]) : null;

  return (
    <div>
      <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-3 sm:p-4 overflow-x-auto">
        <Arch
          teeth={UPPER_ROW}
          fogak={fogak}
          numberPosition="below"
          selected={canEdit ? selected : null}
          onSelect={canEdit ? setSelected : undefined}
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
          selected={canEdit ? selected : null}
          onSelect={canEdit ? setSelected : undefined}
        />
      </div>

      {/* Jelmagyarázat + összegzés */}
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-3 text-xs text-gray-600 dark:text-gray-300">
        {LEGEND.map((l) => (
          <span key={l.base} className="inline-flex items-center gap-1.5">
            <Tooth fdi={11} conditions={{ base: l.base, caries: false, periapical: false, mobility: 0 }} size={16} showNumber={false} />
            {l.label}
          </span>
        ))}
        <span className="ml-auto text-gray-500 dark:text-gray-400">
          Felső: {upper.present} megvan · {upper.missing} hiányzó · Alsó: {lower.present} megvan · {lower.missing} hiányzó
        </span>
      </div>

      {/* Szerkesztő */}
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
          </div>

          {selected && sel ? (
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

              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Állapot</div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {BASE_OPTIONS.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => applyTooth(setFogak, selected, { base: b })}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                      sel.base === b
                        ? 'bg-medical-primary text-white border-medical-primary'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-800/50'
                    }`}
                  >
                    {BASE_LABELS[b]}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={sel.caries}
                    onChange={(e) => applyTooth(setFogak, selected, { caries: e.target.checked })}
                    className="rounded border-gray-300 dark:border-gray-700 text-medical-primary focus:ring-medical-primary"
                  />
                  Szuvas
                </label>
                <label className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={sel.periapical}
                    onChange={(e) => applyTooth(setFogak, selected, { periapical: e.target.checked })}
                    className="rounded border-gray-300 dark:border-gray-700 text-medical-primary focus:ring-medical-primary"
                  />
                  Gyökércsúcsi gyulladás
                </label>
                <div className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200">
                  <span>Mobilitás</span>
                  {[0, 1, 2, 3].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => applyTooth(setFogak, selected, { mobility: m })}
                      className={`w-7 h-7 text-xs rounded border ${
                        sel.mobility === m
                          ? 'bg-medical-primary text-white border-medical-primary'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-800/50'
                      }`}
                    >
                      {m === 0 ? '–' : ['', 'I', 'II', 'III'][m]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3">
                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Megjegyzés (típus, gyári szám, stb.)</label>
                <input
                  type="text"
                  value={sel.description ?? ''}
                  onChange={(e) => applyTooth(setFogak, selected, { description: e.target.value })}
                  className="form-input text-sm"
                  placeholder="Opcionális megjegyzés a foghoz"
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Kattintson egy fogra a státusza beállításához.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

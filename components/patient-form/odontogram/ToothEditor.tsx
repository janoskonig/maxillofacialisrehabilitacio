'use client';

import { NATURAL_TOOTH_BASE_OPTIONS, BASE_LABELS, supportsSurfaces, type ToothConditions } from './tooth-conditions';
import { ProsthesisComponentPicker } from '@/components/ProsthesisComponentPicker';
import { positionLabel } from '@/lib/prosthesis-components';
import { ToothSurfacePicker } from './ToothSurfacePicker';
import type { ToothBase } from '@/hooks/usePatientAutoSave';

/** Állapot-chipek (a teljes szerkesztő és a batch-mód is ezt használja). */
export function BaseChips({
  value,
  onPick,
  touch = false,
}: {
  value: ToothBase | null;
  onPick: (b: ToothBase) => void;
  touch?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {NATURAL_TOOTH_BASE_OPTIONS.map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => onPick(b)}
          className={`rounded-full border transition-colors ${
            touch ? 'px-3.5 py-2 text-sm min-h-[44px]' : 'px-2.5 py-1 text-xs'
          } ${
            value === b
              ? 'bg-medical-primary text-white border-medical-primary'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-800/50'
          }`}
        >
          {BASE_LABELS[b]}
        </button>
      ))}
    </div>
  );
}

/**
 * Egy fog teljes szerkesztője (fejléc nélkül) — inline (desktop) és
 * bottom sheet (mobil) környezetben is használható. A `touch` nagyobb
 * érintőfelületeket ad mobilra.
 */
export function ToothEditor({
  fdi,
  conditions,
  onChange,
  touch = false,
  showBase = true,
  disabled = false,
}: {
  fdi: number | string;
  conditions: ToothConditions;
  onChange: (patch: Partial<ToothConditions>) => void;
  touch?: boolean;
  showBase?: boolean;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-4">
      {showBase&&<div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Saját fog állapota</div>
      <div className="mb-3">
        <BaseChips value={conditions.base} onPick={(b) => onChange({ base: b })} touch={touch} />
        {!NATURAL_TOOTH_BASE_OPTIONS.includes(conditions.base)&&<p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Korábbi összetett jelölés: {BASE_LABELS[conditions.base]}. Ez megmarad; a részletes elemeket külön adhatod meg.</p>}
      </div>
      </div>}

      <div className="min-w-0 rounded-xl border border-blue-200 p-3 dark:border-blue-900">
        <h5 className="mb-1 text-sm font-semibold">Megfigyelt fogpótlási elemek</h5>
        <p className="mb-3 text-xs text-slate-500">Ugyanaz a választék, mint a fogpótlás rögzítésénél. Egy foghelyhez több elem is megadható.</p>
        <ProsthesisComponentPicker value={conditions.components??[]} onToggle={role=>onChange({components:conditions.components?.includes(role)?conditions.components.filter(value=>value!==role):[...(conditions.components??[]),role]})} disabled={disabled}/>
        {!!conditions.components?.length&&<ul className="mt-3 space-y-1 border-t pt-2 text-xs" aria-label="Rögzített fogpótlási elemek">{conditions.components.map(role=><li key={role}>{positionLabel(role,true)}</li>)}</ul>}
      </div>

      {supportsSurfaces(conditions.base) && (
        <div className="mb-3 border-t border-gray-100 dark:border-gray-800 pt-3">
          <ToothSurfacePicker
            fdi={fdi}
            conditions={conditions}
            onChange={(surfaces) => onChange({ surfaces })}
            touch={touch}
          />
        </div>
      )}

      <div className={`flex flex-wrap items-center ${touch ? 'gap-3' : 'gap-4'}`}>
        <label
          className={`inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200 ${
            touch ? 'min-h-[44px]' : ''
          }`}
        >
          <input
            type="checkbox"
            checked={conditions.caries}
            onChange={(e) => onChange({ caries: e.target.checked })}
            className="rounded border-gray-300 dark:border-gray-700 text-medical-primary focus:ring-medical-primary"
          />
          Szuvas
        </label>
        <label
          className={`inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200 ${
            touch ? 'min-h-[44px]' : ''
          }`}
        >
          <input
            type="checkbox"
            checked={conditions.periapical}
            onChange={(e) => onChange({ periapical: e.target.checked })}
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
              onClick={() => onChange({ mobility: m })}
              className={`text-xs rounded border ${touch ? 'w-11 h-11' : 'w-7 h-7'} ${
                conditions.mobility === m
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
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
          Megjegyzés (típus, gyári szám, stb.)
        </label>
        <input
          type="text"
          value={conditions.description ?? ''}
          onChange={(e) => onChange({ description: e.target.value })}
          className="form-input text-sm"
          placeholder="Opcionális megjegyzés a foghoz"
        />
      </div>
    </fieldset>
  );
}

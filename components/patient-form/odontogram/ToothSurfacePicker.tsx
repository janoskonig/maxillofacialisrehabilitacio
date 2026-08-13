'use client';

import { ToothShapeChart } from './ToothShapeChart';
import { surfacesOf, type ToothConditions } from './tooth-conditions';
import {
  SURFACE_KEYS,
  SURFACE_MARK_COLORS,
  SURFACE_MARK_LABELS,
  cycleSurfaceMark,
  setSurface,
  countSurfaceMarks,
  surfaceLabel,
  type SurfaceKey,
  type SurfaceMap,
} from './tooth-surfaces';

/**
 * Felszín-szintű jelölő: a fog nagyított koronarajzán a mezők közvetlenül
 * kattinthatók (ép → szuvas → tömött → ép), mellette ugyanez a ciklus
 * billentyűzettel is elérhető, felszín-nevekkel felcímkézett gombokon.
 */
export function ToothSurfacePicker({
  fdi,
  conditions,
  onChange,
  touch = false,
}: {
  fdi: number | string;
  conditions: ToothConditions;
  onChange: (surfaces: SurfaceMap) => void;
  touch?: boolean;
}) {
  const surfaces = surfacesOf(conditions);
  const marked = countSurfaceMarks(surfaces);

  function toggle(key: SurfaceKey) {
    onChange(setSurface(surfaces, key, cycleSurfaceMark(surfaces[key])));
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs text-gray-500 dark:text-gray-400">Fogfelszínek</span>
        {marked > 0 && (
          <button
            type="button"
            onClick={() => onChange({})}
            className="text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline underline-offset-2"
          >
            Felszínek törlése
          </button>
        )}
      </div>

      <div className="flex items-start gap-3 flex-wrap">
        <svg
          viewBox="0 0 28 40"
          width={touch ? 104 : 88}
          height={touch ? 148 : 126}
          role="group"
          aria-label={`${fdi} fog felszínei`}
          className="shrink-0"
        >
          <ToothShapeChart fdi={fdi} conditions={conditions} onSurfaceClick={toggle} />
        </svg>

        <div className="flex flex-col gap-1.5 min-w-0">
          {SURFACE_KEYS.map((key) => {
            const mark = surfaces[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggle(key)}
                aria-pressed={mark != null}
                className={`inline-flex items-center gap-2 rounded-full border text-left transition-colors ${
                  touch ? 'px-3 py-2 text-sm min-h-[44px]' : 'px-2.5 py-1 text-xs'
                } ${
                  mark
                    ? 'border-gray-400 dark:border-gray-500 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                    : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }`}
              >
                <span
                  aria-hidden
                  className="inline-block w-3 h-3 rounded-sm border border-gray-400 dark:border-gray-500"
                  style={{ backgroundColor: mark ? SURFACE_MARK_COLORS[mark] : 'transparent' }}
                />
                <span className="truncate">{surfaceLabel(fdi, key)}</span>
                <span className="ml-auto pl-1 text-[11px] text-gray-500 dark:text-gray-400">
                  {mark ? SURFACE_MARK_LABELS[mark] : 'ép'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5">
        {touch ? 'Koppintson' : 'Kattintson'} egy felszínre: ép → szuvas → tömött → ép.
      </p>
    </div>
  );
}

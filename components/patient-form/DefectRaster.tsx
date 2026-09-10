'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent as RKeyboardEvent, PointerEvent as RPointerEvent } from 'react';
import { Eraser } from 'lucide-react';
import {
  DEFECT_RASTER_LAYOUTS,
  cellKey,
  describeDefectCell,
  normalizeDefectRaster,
  setDefectCell,
  summarizeDefectRaster,
  zoneAt,
  type DefectJaw,
} from '@/lib/defect-raster';

/**
 * Raszterezett defektus-jelölő: sematikus állcsontkép (okkluzális nézet) egy
 * 6×8-as ráccsal. A klinikus kattintással / húzással jelöli be a defektus által
 * érintett mezőket; a tárolt érték a mezők kulcslistája (lib/defect-raster.ts).
 *
 * A rajz és a rács ugyanabban a rács-koordinátarendszerben él (0…320 × 0…240,
 * 40-es cellák), az ívek alakja y = apex + a·|x−160|^ARCH_P — a lib
 * zónatérképe (mely mező jelölhető) ebből a geometriából származik, ezért a
 * két helyet együtt kell módosítani.
 */

const CELL = 40;
const ROWS = 6;
const COLS = 8;
/** A rács bal felső sarka a viewBoxban (balra a sor-, fent az oszlop-címkék). */
const GX = 76;
const GY = 30;
const VW = GX + COLS * CELL + 6;
const VH = GY + ROWS * CELL + 6;
const ARCH_P = 2.6;
const MID_X = 160;

type Pt = [number, number];

function archFn(apexY: number, edgeX: number, edgeY: number): (x: number) => number {
  const a = (edgeY - apexY) / Math.pow(Math.abs(MID_X - edgeX), ARCH_P);
  return (x) => apexY + a * Math.pow(Math.abs(x - MID_X), ARCH_P);
}

function archPoints(fn: (x: number) => number, xFrom: number, xTo: number, steps = 64): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = xFrom + ((xTo - xFrom) * i) / steps;
    pts.push([x, fn(x)]);
  }
  return pts;
}

const f1 = (n: number) => Math.round(n * 10) / 10;

/** Töröttvonal-szakasz: az első pont M vagy L, a többi L. */
function segment(pts: Pt[], first: 'M' | 'L'): string {
  return pts.map(([x, y], i) => `${i === 0 ? first : 'L'}${f1(x)},${f1(y)}`).join(' ');
}

interface ToothPlacement {
  x: number;
  y: number;
  angle: number;
}

/** Egyenlő ívhossz-közönként elhelyezett pontok az íven + érintő-szög (fok). */
function alongArch(fn: (x: number) => number, xFrom: number, xTo: number, n: number): ToothPlacement[] {
  const pts = archPoints(fn, xFrom, xTo, 400);
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  const out: ToothPlacement[] = [];
  let j = 1;
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * total;
    while (j < cum.length - 1 && cum[j] < s) j++;
    const t = (s - cum[j - 1]) / Math.max(cum[j] - cum[j - 1], 1e-9);
    const [x0, y0] = pts[j - 1];
    const [x1, y1] = pts[j];
    out.push({
      x: x0 + (x1 - x0) * t,
      y: y0 + (y1 - y0) * t,
      angle: (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI,
    });
  }
  return out;
}

/** Fog-ellipszisek (rx az ív mentén, ry merőlegesen) a beteg jobb 8-asától a bal 8-asáig. */
const TOOTH_SIZES: ReadonlyArray<[number, number]> = [
  [8.5, 6.5], [9, 7], [9, 7], [7, 6], [7, 6], [6.5, 7], [5.5, 6.5], [6, 7],
  [6, 7], [5.5, 6.5], [6.5, 7], [7, 6], [7, 6], [9, 7], [9, 7], [8.5, 6.5],
];

const BONE_CLASS = 'fill-[#eee8da] dark:fill-gray-700 stroke-[#b5aa8e] dark:stroke-gray-500';
const PALATE_CLASS = 'fill-[#f7dad2] dark:fill-[#4a2a2c] stroke-[#d8a89b] dark:stroke-[#7a4a4c]';
const SOFT_PALATE_CLASS = 'fill-[#f0c4ba] dark:fill-[#5a3335] stroke-[#d8a89b] dark:stroke-[#7a4a4c]';
const MUCOSA_LINE_CLASS = 'stroke-[#d8a89b] dark:stroke-[#8a5a5c]';
const TOOTH_CLASS = 'fill-white dark:fill-gray-200 stroke-[#8b8472] dark:stroke-gray-500';

function Teeth({ teeth }: { teeth: ToothPlacement[] }) {
  return (
    <g>
      {teeth.map((t, i) => {
        const [rx, ry] = TOOTH_SIZES[i] ?? [6, 6];
        return (
          <ellipse
            key={i}
            cx={f1(t.x)}
            cy={f1(t.y)}
            rx={rx}
            ry={ry}
            transform={`rotate(${f1(t.angle)} ${f1(t.x)} ${f1(t.y)})`}
            className={TOOTH_CLASS}
            strokeWidth={0.8}
          />
        );
      })}
    </g>
  );
}

/** Felső állcsont okkluzális nézetben: alveolus-ív fogakkal, kemény + lágy szájpad. */
function MaxillaSchematic() {
  const geo = useMemo(() => {
    const outer = archFn(6, 4, 200);
    const inner = archFn(46, 36, 200);
    const ridge = archFn(26, 20, 200);
    const outerPts = archPoints(outer, 4, 316);
    const innerPts = archPoints(inner, 36, 284);
    return {
      ridgePath: `${segment(outerPts, 'M')} L284,200 ${segment([...innerPts].reverse(), 'L')} Z`,
      palatePath: `${segment(innerPts, 'M')} Q160,212 36,200 Z`,
      softPalatePath: 'M84,200 Q160,212 236,200 Q232,236 160,238 Q88,236 84,200 Z',
      teeth: alongArch(ridge, 20, 300, 16),
    };
  }, []);

  return (
    <g>
      <path d={geo.ridgePath} className={BONE_CLASS} strokeWidth={1} />
      <path d={geo.palatePath} className={PALATE_CLASS} strokeWidth={0.8} />
      <path d={geo.softPalatePath} className={SOFT_PALATE_CLASS} strokeWidth={0.8} />
      <ellipse cx={160} cy={240} rx={4} ry={5} className={SOFT_PALATE_CLASS} strokeWidth={0.8} />
      {/* sutura palatina mediana */}
      <line x1={160} y1={54} x2={160} y2={196} className={MUCOSA_LINE_CLASS} strokeWidth={0.8} strokeDasharray="3 3" />
      {/* rugae palatinae */}
      {[62, 74, 86].map((y) => (
        <g key={y} className={MUCOSA_LINE_CLASS} strokeWidth={0.8} fill="none">
          <path d={`M146,${y} Q134,${y - 4} 118,${y + 2}`} />
          <path d={`M174,${y} Q186,${y - 4} 202,${y + 2}`} />
        </g>
      ))}
      <Teeth teeth={geo.teeth} />
    </g>
  );
}

/** Alsó állcsont okkluzális nézetben: test fogakkal, hátul a felszálló ágak és a condylusok. */
function MandibulaSchematic() {
  const geo = useMemo(() => {
    const outer = archFn(6, 4, 200);
    const inner = archFn(46, 40, 200);
    const ridge = archFn(26, 22, 200);
    const outerPts = archPoints(outer, 4, 316);
    const innerPts = archPoints(inner, 40, 280);
    return {
      bonePath: `M4,236 ${segment(outerPts, 'L')} L316,236 L280,236 L280,200 ${segment([...innerPts].reverse(), 'L')} L40,236 Z`,
      teeth: alongArch(ridge, 22, 298, 16),
    };
  }, []);

  return (
    <g>
      <path d={geo.bonePath} className={BONE_CLASS} strokeWidth={1} />
      {/* condylusok */}
      <ellipse cx={22} cy={238} rx={14} ry={6} className={BONE_CLASS} strokeWidth={1} />
      <ellipse cx={298} cy={238} rx={14} ry={6} className={BONE_CLASS} strokeWidth={1} />
      {/* symphysis */}
      <line x1={160} y1={10} x2={160} y2={44} className={MUCOSA_LINE_CLASS} strokeWidth={0.8} strokeDasharray="3 3" />
      {/* foramen mentale */}
      <circle cx={48} cy={128} r={2} className="fill-[#b5aa8e] dark:fill-gray-500" />
      <circle cx={272} cy={128} r={2} className="fill-[#b5aa8e] dark:fill-gray-500" />
      <Teeth teeth={geo.teeth} />
    </g>
  );
}

interface DefectRasterProps {
  jaw: DefectJaw;
  /** A bejelölt mezők kulcsai (bármilyen tárolt alakban — normalizáljuk). */
  value: string[] | null | undefined;
  onChange?: (cells: string[]) => void;
  readOnly?: boolean;
  /** Az összegző sor + súgó elrejtése (ha a hívó maga jeleníti meg). */
  hideSummary?: boolean;
}

export function DefectRaster({ jaw, value, onChange, readOnly = false, hideSummary = false }: DefectRasterProps) {
  const layout = DEFECT_RASTER_LAYOUTS[jaw];
  const cells = useMemo(() => normalizeDefectRaster(jaw, value), [jaw, value]);
  const selected = useMemo(() => new Set(cells), [cells]);
  const summary = useMemo(() => summarizeDefectRaster(jaw, cells), [jaw, cells]);
  const editable = !readOnly && !!onChange;

  // A húzásos jelölés több mezőt módosít két render között — a legutóbbi
  // kommitált listát ref-ben követjük, hogy ne elavult állapotból dolgozzunk.
  const cellsRef = useRef<string[]>(cells);
  useEffect(() => {
    cellsRef.current = cells;
  }, [cells]);

  const paint = useRef<{ active: boolean; mode: boolean }>({ active: false, mode: true });
  useEffect(() => {
    const stop = () => {
      paint.current.active = false;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  const commit = useCallback(
    (key: string, on: boolean) => {
      if (!editable || !onChange) return;
      const next = setDefectCell(jaw, cellsRef.current, key, on);
      if (next.length === cellsRef.current.length) return; // nem változott
      cellsRef.current = next;
      onChange(next);
    },
    [editable, jaw, onChange]
  );

  const onCellPointerDown = (key: string) => (e: RPointerEvent<SVGRectElement>) => {
    if (!editable) return;
    e.preventDefault();
    // Érintésnél a böngésző a lenyomott elemhez köti a pointert — elengedjük,
    // hogy húzás közben a többi mező is kapjon pointerenter-t.
    try {
      const target = e.currentTarget as SVGRectElement & { releasePointerCapture?: (id: number) => void };
      target.releasePointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
    const on = !selected.has(key);
    paint.current = { active: true, mode: on };
    commit(key, on);
  };

  const onCellPointerEnter = (key: string) => () => {
    if (editable && paint.current.active) commit(key, paint.current.mode);
  };

  const onCellKeyDown = (key: string) => (e: RKeyboardEvent<SVGRectElement>) => {
    if (!editable) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      commit(key, !selected.has(key));
    }
  };

  const clearAll = () => {
    if (!editable || !onChange) return;
    cellsRef.current = [];
    onChange([]);
  };

  return (
    <div data-testid={`defect-raster-${jaw}`}>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        className="w-full h-auto max-w-[540px] select-none touch-none"
        role="group"
        aria-label={`${layout.title} defektus-raszter`}
      >
        {/* Oldal- és oszlopcímkék */}
        <text x={GX + 2} y={12} className="fill-gray-500 dark:fill-gray-400 text-[9px] font-semibold">
          JOBB
        </text>
        <text x={GX + COLS * CELL - 2} y={12} textAnchor="end" className="fill-gray-500 dark:fill-gray-400 text-[9px] font-semibold">
          BAL
        </text>
        <text x={GX + COLS * CELL / 2} y={12} textAnchor="middle" className="fill-gray-400 dark:fill-gray-500 text-[8px]">
          elöl
        </text>
        {layout.colLabels.map((label, c) => (
          <text
            key={label}
            x={GX + c * CELL + CELL / 2}
            y={GY - 6}
            textAnchor="middle"
            className="fill-gray-400 dark:fill-gray-500 text-[8px]"
          >
            {label}
          </text>
        ))}
        {layout.rowLabels.map((label, r) => (
          <text
            key={label}
            x={GX - 6}
            y={GY + r * CELL + CELL / 2 + 3}
            textAnchor="end"
            className="fill-gray-500 dark:fill-gray-400 text-[8.5px]"
          >
            {label}
          </text>
        ))}

        <g transform={`translate(${GX} ${GY})`}>
          {jaw === 'maxilla' ? <MaxillaSchematic /> : <MandibulaSchematic />}

          {/* Rács */}
          {Array.from({ length: ROWS }, (_, r) =>
            Array.from({ length: COLS }, (_, c) => {
              const key = cellKey(r, c);
              const zone = zoneAt(layout, r, c);
              if (!zone) {
                return (
                  <rect
                    key={key}
                    x={c * CELL}
                    y={r * CELL}
                    width={CELL}
                    height={CELL}
                    className="fill-none stroke-gray-200 dark:stroke-gray-800"
                    strokeWidth={0.5}
                    strokeDasharray="2 3"
                    pointerEvents="none"
                  />
                );
              }
              const isOn = selected.has(key);
              const label = describeDefectCell(jaw, key);
              return (
                <rect
                  key={key}
                  x={c * CELL}
                  y={r * CELL}
                  width={CELL}
                  height={CELL}
                  role="checkbox"
                  aria-checked={isOn}
                  aria-label={label}
                  aria-disabled={editable ? undefined : true}
                  tabIndex={editable ? 0 : -1}
                  fillOpacity={0.45}
                  strokeWidth={isOn ? 1.4 : 0.7}
                  className={[
                    isOn
                      ? 'fill-rose-500 stroke-rose-600 dark:fill-rose-400 dark:stroke-rose-300'
                      : 'fill-transparent stroke-gray-400/70 dark:stroke-gray-500/70',
                    editable
                      ? 'cursor-pointer hover:fill-gray-400 focus:outline-none focus-visible:stroke-medical-primary focus-visible:stroke-[1.6]'
                      : '',
                  ].join(' ')}
                  onPointerDown={onCellPointerDown(key)}
                  onPointerEnter={onCellPointerEnter(key)}
                  onKeyDown={onCellKeyDown(key)}
                >
                  <title>{label}</title>
                </rect>
              );
            })
          )}
        </g>
      </svg>

      {!hideSummary && (
        <>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <p
              className="text-xs text-gray-600 dark:text-gray-300 min-w-0"
              aria-live="polite"
              data-testid={`defect-raster-summary-${jaw}`}
            >
              {summary.text}
            </p>
            {editable && summary.count > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 shrink-0"
              >
                <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
                Jelölés törlése
              </button>
            )}
          </div>
          {editable && (
            <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
              Kattintással vagy húzással jelölje a defektus által érintett mezőket. A J oszlopok a beteg
              jobb, a B oszlopok a bal oldala; a sorok elölről hátrafelé haladnak.
            </p>
          )}
        </>
      )}
    </div>
  );
}

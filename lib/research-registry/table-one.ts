/**
 * "Table 1" — alap (baseline) jellemzők leíró statisztikája az elemzésre kész
 * sorokból, opcionálisan egy kategorikus változó szerint rétegezve. Tiszta,
 * determinisztikus függvény (publikációhoz / gyors áttekintéshez).
 *
 *  - kategorikus változó → szintenkénti darabszám és százalék (nem-hiányzó nevező),
 *    + külön hiányzó-szám,
 *  - folytonos változó → n, hiányzó, átlag, SD, medián, Q1, Q3, min, max.
 */

import { ANALYSIS_VARIABLES, type AnalysisRow, type AnalysisVariable } from './analysis-projection';

export interface ContinuousStats {
  n: number;
  missing: number;
  mean: number | null;
  sd: number | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  min: number | null;
  max: number | null;
}

export interface CategoricalLevel {
  level: string;
  overall: { n: number; pct: number };
  byGroup?: Record<string, { n: number; pct: number }>;
}

export interface TableOneCategoricalRow {
  variable: string;
  label: string;
  kind: 'categorical';
  levels: CategoricalLevel[];
  missing: { overall: number; byGroup?: Record<string, number> };
}

export interface TableOneContinuousRow {
  variable: string;
  label: string;
  kind: 'continuous';
  overall: ContinuousStats;
  byGroup?: Record<string, ContinuousStats>;
}

export type TableOneRow = TableOneCategoricalRow | TableOneContinuousRow;

export interface TableOneResult {
  n: number;
  groupBy: string | null;
  groups: string[];
  rows: TableOneRow[];
}

function isMissing(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

function levelString(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

function quantile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function continuousStats(values: unknown[]): ContinuousStats {
  const nums = values
    .filter((v) => !isMissing(v))
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  const missing = values.length - nums.length;
  if (nums.length === 0) {
    return { n: 0, missing, mean: null, sd: null, median: null, q1: null, q3: null, min: null, max: null };
  }
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const sd =
    nums.length > 1
      ? Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1))
      : 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const round = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100);
  return {
    n: nums.length,
    missing,
    mean: round(mean),
    sd: round(sd),
    median: round(quantile(sorted, 0.5)),
    q1: round(quantile(sorted, 0.25)),
    q3: round(quantile(sorted, 0.75)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function categoricalRow(
  variable: AnalysisVariable,
  rows: AnalysisRow[],
  groups: string[],
  groupBy: string | null,
): TableOneCategoricalRow {
  const present = (rs: AnalysisRow[]) => rs.filter((r) => !isMissing(r[variable.key]));

  // Szintkészlet: az engedett értékek sorrendje előre, majd a ténylegesen
  // előfordulók (pl. boolean 'true'/'false', vagy váratlan szintek).
  const seen = new Set<string>();
  for (const r of rows) if (!isMissing(r[variable.key])) seen.add(levelString(r[variable.key]));
  const ordered: string[] = [];
  for (const a of variable.allowedValues ?? []) if (seen.has(a)) ordered.push(a);
  for (const s of Array.from(seen).sort()) if (!ordered.includes(s)) ordered.push(s);
  if (variable.type === 'boolean') {
    for (const b of ['true', 'false']) if (seen.has(b) && !ordered.includes(b)) ordered.push(b);
  }

  const countLevel = (rs: AnalysisRow[], level: string) =>
    present(rs).filter((r) => levelString(r[variable.key]) === level).length;

  const denomOverall = present(rows).length;
  const groupRows: Record<string, AnalysisRow[]> = {};
  if (groupBy) for (const g of groups) groupRows[g] = rows.filter((r) => levelString(r[groupBy]) === g);

  const levels: CategoricalLevel[] = ordered.map((level) => {
    const oN = countLevel(rows, level);
    const lvl: CategoricalLevel = {
      level,
      overall: { n: oN, pct: denomOverall ? Math.round((oN / denomOverall) * 1000) / 10 : 0 },
    };
    if (groupBy) {
      lvl.byGroup = {};
      for (const g of groups) {
        const denom = present(groupRows[g]).length;
        const n = countLevel(groupRows[g], level);
        lvl.byGroup[g] = { n, pct: denom ? Math.round((n / denom) * 1000) / 10 : 0 };
      }
    }
    return lvl;
  });

  const missingOverall = rows.length - denomOverall;
  const missing: TableOneCategoricalRow['missing'] = { overall: missingOverall };
  if (groupBy) {
    missing.byGroup = {};
    for (const g of groups) missing.byGroup[g] = groupRows[g].length - present(groupRows[g]).length;
  }

  return { variable: variable.key, label: variable.label, kind: 'categorical', levels, missing };
}

function continuousRow(
  variable: AnalysisVariable,
  rows: AnalysisRow[],
  groups: string[],
  groupBy: string | null,
): TableOneContinuousRow {
  const out: TableOneContinuousRow = {
    variable: variable.key,
    label: variable.label,
    kind: 'continuous',
    overall: continuousStats(rows.map((r) => r[variable.key])),
  };
  if (groupBy) {
    out.byGroup = {};
    for (const g of groups) {
      out.byGroup[g] = continuousStats(
        rows.filter((r) => levelString(r[groupBy]) === g).map((r) => r[variable.key]),
      );
    }
  }
  return out;
}

/**
 * Table 1 az elemzésre kész sorokból. `groupBy` egy kategorikus elemzési változó
 * kulcsa (pl. `etiologia`); a hiányzó csoport-értékű sorok csak az "overall"
 * oszlopba számítanak.
 */
export function computeTableOne(
  rows: AnalysisRow[],
  options?: { groupBy?: string | null },
): TableOneResult {
  const groupBy = options?.groupBy ?? null;
  const groupByVar = groupBy ? ANALYSIS_VARIABLES.find((v) => v.key === groupBy) : undefined;
  const effectiveGroupBy = groupByVar && groupByVar.kind === 'categorical' ? groupBy : null;

  const groups = effectiveGroupBy
    ? Array.from(
        new Set(rows.filter((r) => !isMissing(r[effectiveGroupBy])).map((r) => levelString(r[effectiveGroupBy]))),
      ).sort()
    : [];

  const rowsOut: TableOneRow[] = ANALYSIS_VARIABLES
    .filter((v) => v.kind !== 'id' && v.key !== effectiveGroupBy)
    .map((v) =>
      v.kind === 'continuous'
        ? continuousRow(v, rows, groups, effectiveGroupBy)
        : categoricalRow(v, rows, groups, effectiveGroupBy),
    );

  return { n: rows.length, groupBy: effectiveGroupBy, groups, rows: rowsOut };
}

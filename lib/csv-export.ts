/**
 * Tiny RFC 4180 CSV helper used by the admin stats page to expose tabular
 * "dataframes" downloadable for downstream R / pandas analysis.
 *
 * Output format:
 *   - UTF-8 with optional BOM (Excel + R `read.csv(file, fileEncoding =
 *     "UTF-8-BOM")` happy; `readr::read_csv()` strips the BOM automatically).
 *   - Comma-separated, CRLF row terminator, double-quote escaping per RFC 4180.
 *   - Numbers are written with `.` as decimal separator (R-friendly).
 *   - Booleans rendered as `TRUE` / `FALSE` (R-friendly).
 *   - `null` / `undefined` rendered as the empty string (becomes `NA` after
 *     `read.csv(..., na.strings = "")`).
 */

export type CsvCell = string | number | boolean | null | undefined;

export interface CsvColumn<T> {
  /** Header text written in the first row of the CSV. */
  header: string;
  /** Either a key into the row, or a function returning the cell value. */
  value: keyof T | ((row: T) => CsvCell);
}

/** Escape a single cell per RFC 4180 (quote when needed, double inner quotes). */
export function csvEscape(value: CsvCell): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  const str = typeof value === 'number' ? String(value) : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Build a CSV string from typed rows + an explicit column spec. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const headerLine = columns.map((c) => csvEscape(c.header)).join(',');
  const dataLines = rows.map((row) =>
    columns
      .map((c) => {
        const raw =
          typeof c.value === 'function'
            ? c.value(row)
            : ((row as Record<string, unknown>)[c.value as string] as CsvCell);
        return csvEscape(raw);
      })
      .join(','),
  );
  return [headerLine, ...dataLines].join('\r\n');
}

/** Trigger a browser download for a CSV string; safe to call only client-side. */
export function downloadCsv(
  filename: string,
  csv: string,
  opts: { withBom?: boolean } = {},
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const withBom = opts.withBom !== false;
  const blob = new Blob([withBom ? '\uFEFF' + csv : csv], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Today's date as `YYYY-MM-DD`, useful for export filenames. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

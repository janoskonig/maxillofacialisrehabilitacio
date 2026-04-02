import * as XLSX from 'xlsx';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getCached, setCache, BNO_TTL } from '@/lib/catalog-cache';
import { logger } from '@/lib/logger';

export type BnoCodeRow = { kod: string; nev: string };

const CACHE_KEY = 'bno-codes';

function loadBnoCodesFromDisk(): BnoCodeRow[] {
  const filePath = join(process.cwd(), 'BNOTORZS_201807.xlsx');
  if (!existsSync(filePath)) {
    logger.error(`BNO Excel file not found at: ${filePath}`);
    return [];
  }
  const fileBuffer = readFileSync(filePath);
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  let data = XLSX.utils.sheet_to_json(worksheet, {
    defval: '',
    raw: false,
  }) as any[];

  if (!data || data.length === 0) {
    data = XLSX.utils.sheet_to_json(worksheet, {
      header: ['kod', 'nev'],
      defval: '',
      raw: false,
    }) as any[];
  }

  const bnoCodes: BnoCodeRow[] = data
    .map((row: any) => {
      let kod = '';
      if (row.KOD10) {
        kod = String(row.KOD10).trim().toUpperCase();
      } else if (row.kod || row.Kód || row.KOD || row.kód) {
        kod = String(row.kod || row.Kód || row.KOD || row.kód).trim().toUpperCase();
      }
      let nev = '';
      if (row.NEV) {
        nev = String(row.NEV).trim();
      } else if (row.nev || row.Név || row.név) {
        nev = String(row.nev || row.Név || row.név).trim();
      }
      return { kod, nev };
    })
    .filter((code: BnoCodeRow) => code.kod && code.nev && code.kod.length > 0 && code.nev.length > 0)
    .filter((code: BnoCodeRow, index: number, self: BnoCodeRow[]) => index === self.findIndex((c) => c.kod === code.kod));

  return bnoCodes;
}

/** BNO törzs (Excel), memóriában cache-elve — ugyanaz a forrás, mint az /api/bno-codes. */
export function getBnoCodesList(): BnoCodeRow[] {
  const cached = getCached<BnoCodeRow[]>(CACHE_KEY);
  if (cached) return cached;
  const bnoCodes = loadBnoCodesFromDisk();
  if (bnoCodes.length > 0) {
    logger.info(`Loaded ${bnoCodes.length} BNO codes from Excel file`);
    setCache(CACHE_KEY, bnoCodes, BNO_TTL);
  }
  return bnoCodes;
}

export function getBnoKodToNevMap(): Map<string, string> {
  const list = getBnoCodesList();
  const m = new Map<string, string>();
  for (const row of list) {
    m.set(row.kod.toUpperCase(), row.nev);
  }
  return m;
}

/**
 * A páciens űrlapon tárolt BNO mező (egy vagy több kód) → törzs alapú magyar megnevezés(ek).
 * Több kód: vessző/pontosvessző mentén. Ha nincs találat, üres string helyett visszaadhatunk nullt.
 */
export function resolveBnoFieldToHungarianLabels(raw: string | null | undefined, map: Map<string, string>): string | null {
  if (raw == null || !String(raw).trim()) return null;
  const tokens = String(raw)
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const labels: string[] = [];
  for (const t of tokens) {
    const key = t.toUpperCase().replace(/\s+/g, '');
    const nev = map.get(key) || map.get(t.toUpperCase());
    if (nev) labels.push(nev);
  }
  if (labels.length === 0) return null;
  return labels.join('; ');
}

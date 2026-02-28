import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { apiHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getCached, setCache, BNO_TTL } from '@/lib/catalog-cache';

interface BNOCode {
  kod: string;
  nev: string;
}

export const dynamic = 'force-dynamic';

const CACHE_KEY = 'bno-codes';

export const GET = apiHandler(async () => {
  const cacheHeaders = { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=7200' };
  const cached = getCached<BNOCode[]>(CACHE_KEY);
  if (cached) return NextResponse.json(cached, { headers: cacheHeaders });
  const filePath = join(process.cwd(), 'BNOTORZS_201807.xlsx');
  
  if (!existsSync(filePath)) {
    logger.error(`BNO Excel file not found at: ${filePath}`);
    return NextResponse.json(
      { error: 'BNO Excel file not found' },
      { status: 404 }
    );
  }
  
  const fileBuffer = readFileSync(filePath);
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  let data = XLSX.utils.sheet_to_json(worksheet, { 
    defval: '',
    raw: false
  }) as any[];
  
  if (!data || data.length === 0) {
    data = XLSX.utils.sheet_to_json(worksheet, { 
      header: ['kod', 'nev'],
      defval: '',
      raw: false
    }) as any[];
  }
  
  const bnoCodes: BNOCode[] = data
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
    .filter((code: BNOCode) => code.kod && code.nev && code.kod.length > 0 && code.nev.length > 0)
    .filter((code: BNOCode, index: number, self: BNOCode[]) => 
      index === self.findIndex((c) => c.kod === code.kod)
    );
  
  logger.info(`Loaded ${bnoCodes.length} BNO codes from Excel file`);
  setCache(CACHE_KEY, bnoCodes, BNO_TTL);
  
  return NextResponse.json(bnoCodes, { headers: cacheHeaders });
});

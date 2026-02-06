import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface BNOCode {
  kod: string;
  nev: string;
}

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Az Excel fájl elérési útja
    const filePath = join(process.cwd(), 'BNOTORZS_201807.xlsx');
    
    // Ellenőrizzük, hogy létezik-e a fájl
    if (!existsSync(filePath)) {
      console.error(`BNO Excel file not found at: ${filePath}`);
      return NextResponse.json(
        { error: 'BNO Excel file not found' },
        { status: 404 }
      );
    }
    
    // Excel fájl beolvasása
    const fileBuffer = readFileSync(filePath);
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    
    // Első munkalap kiválasztása
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Először próbáljuk meg fejléces formátumban olvasni
    let data = XLSX.utils.sheet_to_json(worksheet, { 
      defval: '', // Üres értékek helyett üres string
      raw: false // Szövegként olvassuk be az értékeket
    }) as any[];
    
    // Ha nincs adat, próbáljuk meg fejléc nélküli formátumban
    if (!data || data.length === 0) {
      data = XLSX.utils.sheet_to_json(worksheet, { 
        header: ['kod', 'nev'],
        defval: '',
        raw: false
      }) as any[];
    }
    
    // Adatok formázása és szűrése
    const bnoCodes: BNOCode[] = data
      .map((row: any) => {
        // Kód mező keresése - az Excel fájlban KOD10 az oszlop neve
        let kod = '';
        if (row.KOD10) {
          kod = String(row.KOD10).trim().toUpperCase();
        } else if (row.kod || row.Kód || row.KOD || row.kód) {
          kod = String(row.kod || row.Kód || row.KOD || row.kód).trim().toUpperCase();
        }
        
        // Név mező keresése - az Excel fájlban NEV az oszlop neve
        let nev = '';
        if (row.NEV) {
          nev = String(row.NEV).trim();
        } else if (row.nev || row.Név || row.név) {
          nev = String(row.nev || row.Név || row.név).trim();
        }
        
        return { kod, nev };
      })
      .filter((code: BNOCode) => code.kod && code.nev && code.kod.length > 0 && code.nev.length > 0) // Csak azokat, amelyeknek van kódja és neve
      .filter((code: BNOCode, index: number, self: BNOCode[]) => 
        // Duplikátumok eltávolítása
        index === self.findIndex((c) => c.kod === code.kod)
      );
    
    console.log(`Loaded ${bnoCodes.length} BNO codes from Excel file`);
    
    return NextResponse.json(bnoCodes);
  } catch (error) {
    console.error('Error reading BNO codes from Excel:', error);
    return NextResponse.json(
      { error: 'Failed to read BNO codes from Excel file', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}


import { PDFDocument } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { Patient } from '@/lib/types';
import { EQUITY_REQUEST_CONFIG } from '@/lib/equity-request-config';

/**
 * Méltányossági kérelem PDF generálása beteg adataiból
 */
export async function generateEquityRequestPDF(patient: Patient): Promise<Buffer> {
  // PDF template elérési útja
  const templatePath = path.join(process.cwd(), 'public', 'templates', 'FNMT.152.K.pdf');
  
  // Ellenőrizzük, hogy létezik-e a PDF fájl
  if (!fs.existsSync(templatePath)) {
    throw new Error(`PDF template nem található: ${templatePath}`);
  }

  // PDF betöltése
  const existingPdfBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(existingPdfBytes);
  
  // Form mezők lekérése
  const form = pdfDoc.getForm();
  const formFields = form.getFields();
  
  // Adatok előkészítése a template számára
  const tajNumber = (patient.taj || '').replace(/[^0-9]/g, ''); // Csak számok
  
  // Kezelési terv összeállítása
  const kezelesiTervParts: string[] = [];
  if (patient.kezelesiTervFelso && Array.isArray(patient.kezelesiTervFelso) && patient.kezelesiTervFelso.length > 0) {
    const felsoTipusok = patient.kezelesiTervFelso.map(t => t.tipus).join(', ');
    kezelesiTervParts.push(`Felső: ${felsoTipusok}`);
  }
  if (patient.kezelesiTervAlso && Array.isArray(patient.kezelesiTervAlso) && patient.kezelesiTervAlso.length > 0) {
    const alsoTipusok = patient.kezelesiTervAlso.map(t => t.tipus).join(', ');
    kezelesiTervParts.push(`Alsó: ${alsoTipusok}`);
  }
  const kezelesiTerv = kezelesiTervParts.length > 0 
    ? `${kezelesiTervParts.join('; ')} (lásd melléklet)`
    : '(lásd melléklet)';

  // Nyilatkozat generálása
  const nyilatkozat = patient.kezeleoorvos
    ? `Alulírott, ${patient.kezeleoorvos} a kezelési tervben foglaltak elvégzését vállalom.`
    : 'Alulírott, a kezelési tervben foglaltak elvégzését vállalom.';

  // Kórtörténeti összefoglaló összeállítása
  const kortortenetiParts: string[] = [];
  if (patient.diagnozis) kortortenetiParts.push(`Diagnózis: ${patient.diagnozis}`);
  if (patient.bno) kortortenetiParts.push(`BNO: ${patient.bno}`);
  if (patient.szovettaniDiagnozis) kortortenetiParts.push(`Szövettani diagnózis: ${patient.szovettaniDiagnozis}`);
  if (patient.tnmStaging) kortortenetiParts.push(`TNM staging: ${patient.tnmStaging}`);
  const kortortenetiOsszefoglalo = patient.kortortenetiOsszefoglalo 
    ? patient.kortortenetiOsszefoglalo
    : kortortenetiParts.join('\n');

  // Field mapping
  const fieldMapping: Record<string, string> = {
    // Alapadatok
    'Biztosított neve': patient.nev || '',
    'Születési helye és ideje': patient.szuletesiDatum 
      ? new Date(patient.szuletesiDatum).toLocaleDateString('hu-HU')
      : '',
    'Lakcíme levelezési címe': [
      patient.cim || '',
      patient.varos || '',
      patient.iranyitoszam || ''
    ].filter(Boolean).join(', '),
    
    // Diagnózis
    'Diagnózis': patient.diagnozis || '',
    'BNO kód': patient.bno || '',
    'Társbetegségek': patient.szovettaniDiagnozis || '',
    
    // Kórtörténeti összefoglaló
    'Kórtörténeti összefoglaló 3 hónapnál nem régebbi': kortortenetiOsszefoglalo,
    
    // Kezelési terv
    'Kezelési_terv': kezelesiTerv,
    
    // Szakorvosi vélemény
    'Szakorvosi vélemény': patient.szakorvosiVelemény || '',
    
    // Nyilatkozat
    'Nyilatkozat': nyilatkozat,
    
    // Szolgáltató információk
    'Fogorvos neve': patient.kezeleoorvos || '',
    'Szolgáltató neve': EQUITY_REQUEST_CONFIG.szolgaltatoNeve,
    'Szolgáltató címe': EQUITY_REQUEST_CONFIG.cim,
    'Vármegyekód': EQUITY_REQUEST_CONFIG.varmegyeKod,
    'NEAK kód': EQUITY_REQUEST_CONFIG.neakKod,
    
    // Dátum mezők (mai dátum)
    'kelt_helység': patient.varos || 'Budapest',
    'kelt_év': new Date().getFullYear().toString(),
    'kelt_hónap': (new Date().getMonth() + 1).toString().padStart(2, '0'),
    'kelt_nap': new Date().getDate().toString().padStart(2, '0'),
  };
  
  // TAJ szám karakterenkénti kitöltése
  for (let i = 1; i <= 9; i++) {
    fieldMapping[`TAJ száma ${i}`] = tajNumber[i - 1] || '';
  }
  
  // Form mezők kitöltése
  let filledFields = 0;
  const errors: Array<{ field: string; error: string }> = [];
  
  formFields.forEach(field => {
    const fieldName = field.getName();
    
    // Pontos mezőnév egyezés keresése
    if (fieldMapping.hasOwnProperty(fieldName)) {
      const value = fieldMapping[fieldName];
      try {
        if (field.constructor.name === 'PDFTextField') {
          field.setText(String(value));
          filledFields++;
        } else if (field.constructor.name === 'PDFCheckBox') {
          if (value === true || value === 'Igen' || value === 'igen') {
            field.check();
            filledFields++;
          }
        }
      } catch (err: any) {
        // Ha hiba van (pl. ékezetes karakterek miatt), próbáljuk meg közvetlenül beállítani
        if (err.message && err.message.includes('WinAnsi cannot encode')) {
          try {
            const acroField = (field as any).acroField;
            const fieldDict = acroField.dict;
            fieldDict.set('V', pdfDoc.context.obj(String(value)));
            filledFields++;
          } catch (directErr) {
            errors.push({ field: fieldName, error: (directErr as Error).message });
          }
        } else {
          errors.push({ field: fieldName, error: err.message });
        }
      }
    } else {
      // Ha nincs pontos egyezés, próbáljuk meg részleges egyezéssel
      const fieldNameLower = fieldName.toLowerCase();
      for (const [key, value] of Object.entries(fieldMapping)) {
        if (fieldNameLower.includes(key.toLowerCase()) || key.toLowerCase().includes(fieldNameLower)) {
          try {
            if (field.constructor.name === 'PDFTextField') {
              field.setText(String(value), { updateAppearances: false });
              filledFields++;
            }
            break;
          } catch (err) {
            // Folytatjuk a következő mezővel
          }
        }
      }
    }
  });
  
  // PDF mentése
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
  } catch (saveError) {
    try {
      pdfBytes = await pdfDoc.save();
    } catch (saveError2) {
      throw new Error(`PDF mentési hiba: ${(saveError2 as Error).message}`);
    }
  }
  
  return Buffer.from(pdfBytes);
}


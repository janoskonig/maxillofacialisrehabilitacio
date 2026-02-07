import { PDFDocument, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { Patient } from '@/lib/types';
import { EQUITY_REQUEST_CONFIG } from '@/lib/equity-request-config';
import bnoCodesData from '@/lib/bno-codes.json';
import { readFileFromCandidates, projectRootCandidates, resolveExistingPath } from '@/lib/pdf/fs';

interface BNOCode {
  kod: string;
  nev: string;
}

const bnoCodes = bnoCodesData as BNOCode[];

/** WinAnsi (Helvetica) nem kódolja ő/ű – cseréljük ö/ü-re, hogy az appearance és flatten ne hibázzon */
function toWinAnsiSafe(text: string): string {
  return String(text)
    .replace(/ő/g, 'ö')
    .replace(/Ő/g, 'Ö')
    .replace(/ű/g, 'ü')
    .replace(/Ű/g, 'Ü');
}

function getEquityTemplateBytes(): Buffer {
  const candidates = [
    ...projectRootCandidates('public', 'templates', 'FNMT.152.K.pdf'),
    path.join(process.cwd(), 'public', 'templates', 'FNMT.152.K.pdf'),
  ];
  return readFileFromCandidates(candidates);
}

/**
 * Méltányossági kérelem PDF generálása beteg adataiból
 */
export async function generateEquityRequestPDF(patient: Patient): Promise<Buffer> {
  const templateBytes = getEquityTemplateBytes();
  const pdfDoc = await PDFDocument.load(new Uint8Array(templateBytes), { ignoreEncryption: true });

  // Logo betöltése és hozzáadása az első oldalhoz (ha létezik PNG verzió) - logo_1 balra, logo_2 jobbra
  const pages = pdfDoc.getPages();
  if (pages.length > 0) {
    const firstPage = pages[0];
    const pageWidth = firstPage.getSize().width;
    const margin = 50;
    const logoWidth = 50;
    const topMargin = 30;

    const logo1Path = resolveExistingPath(projectRootCandidates('public', 'logo_1.png'));
    if (logo1Path) {
      try {
        const logoBytes = fs.readFileSync(logo1Path);
        const logoImage1 = await pdfDoc.embedPng(logoBytes);
        const logoHeight1 = (logoImage1.height / logoImage1.width) * logoWidth;
        firstPage.drawImage(logoImage1, {
          x: margin,
          y: firstPage.getSize().height - logoHeight1 - topMargin,
          width: logoWidth,
          height: logoHeight1,
        });
      } catch (error) {
        console.warn('Logo 1 betöltése sikertelen:', error);
      }
    }

    const logo2Path = resolveExistingPath(projectRootCandidates('public', 'logo_2.png'));
    if (logo2Path) {
      try {
        const logoBytes = fs.readFileSync(logo2Path);
        const logoImage2 = await pdfDoc.embedPng(logoBytes);
        const logoHeight2 = (logoImage2.height / logoImage2.width) * logoWidth;
        firstPage.drawImage(logoImage2, {
          x: pageWidth - logoWidth - margin,
          y: firstPage.getSize().height - logoHeight2 - topMargin,
          width: logoWidth,
          height: logoHeight2,
        });
      } catch (error) {
        console.warn('Logo 2 betöltése sikertelen:', error);
      }
    }
  }
  
  // Form mezők lekérése
  let form;
  let formFields;
  try {
    form = pdfDoc.getForm();
    formFields = form.getFields();
    console.log(`PDF form sikeresen betöltve. Mezők száma: ${formFields.length}`);
    
    // Debug: listázzuk az összes mezőnevet
    if (formFields.length > 0) {
      const allFieldNamesDebug = formFields.map(f => f.getName());
      console.log(`PDF mezőnevek (első 50): ${allFieldNamesDebug.slice(0, 50).join(', ')}${allFieldNamesDebug.length > 50 ? `... (összesen ${allFieldNamesDebug.length})` : ''}`);
    }
  } catch (formError) {
    console.error('Hiba a PDF form lekérésekor:', formError);
    throw new Error(`Nem sikerült betölteni a PDF form mezőket: ${(formError as Error).message}`);
  }
  
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
    ? `${EQUITY_REQUEST_CONFIG.megbizottNeve} megbízásából alulírott, ${patient.kezeleoorvos} a kezelési tervben foglaltak elvégzését vállalom.`
    : `${EQUITY_REQUEST_CONFIG.megbizottNeve} megbízásából alulírott, a kezelési tervben foglaltak elvégzését vállalom.`;

  // Kórtörténeti összefoglaló összeállítása
  const kortortenetiParts: string[] = [];
  if (patient.diagnozis) kortortenetiParts.push(`Diagnózis: ${patient.diagnozis}`);
  if (patient.bno) kortortenetiParts.push(`BNO: ${patient.bno}`);
  if (patient.szovettaniDiagnozis) kortortenetiParts.push(`Szövettani diagnózis: ${patient.szovettaniDiagnozis}`);
  if (patient.tnmStaging) kortortenetiParts.push(`TNM staging: ${patient.tnmStaging}`);
  const kortortenetiOsszefoglalo = patient.kortortenetiOsszefoglalo 
    ? patient.kortortenetiOsszefoglalo
    : kortortenetiParts.join('\n');

  // BNO kód szöveges leírásának lekérdezése a beteg BNO kódjából
  let bnoNev = '';
  if (patient.bno) {
    const bnoKod = patient.bno.trim().toUpperCase();
    // Először pontos egyezést keresünk
    let foundBnoCode = bnoCodes.find(code => code.kod.toUpperCase() === bnoKod);
    
    // Ha nem találunk pontos egyezést, próbáljuk meg prefix egyezést
    if (!foundBnoCode) {
      foundBnoCode = bnoCodes.find(code => 
        code.kod.toUpperCase().startsWith(bnoKod) || 
        bnoKod.startsWith(code.kod.toUpperCase())
      );
    }
    
    if (foundBnoCode) {
      bnoNev = foundBnoCode.nev;
    }
  }

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
    
    // Diagnózis - beteg BNO kódjához tartozó szöveges leírás
    'Diagnózis': bnoNev || '',
    // BNO kód - beteg BNO kódja
    'BNO kód': patient.bno || '',
    // Társbetegségek - mindig "K0000 Foghiány"
    'Társbetegségek': 'K0000 Foghiány',
    'Társbetegség': 'K0000 Foghiány',
    'társbetegségek': 'K0000 Foghiány',
    'társbetegség': 'K0000 Foghiány',
    
    // Kórtörténeti összefoglaló
    'Kórtörténeti összefoglaló 3 hónapnál nem régebbi': kortortenetiOsszefoglalo,
    
    // Kezelési terv
    'Kezelési_terv': kezelesiTerv,
    
    // Részletes árajánlat - mindig "Lásd melléklet"
    'Részletes árajánlat (kezelési tervnek megfelelő, fogorvosi munkadíjra vonatkozó, állcsontonként/foganként)': 'Lásd melléklet',
    'Részletes árajánlat': 'Lásd melléklet',
    'Részletes árajánlat kezelési tervnek megfelelő': 'Lásd melléklet',
    'Részletes árajánlat fogorvosi munkadíjra vonatkozó': 'Lásd melléklet',
    'árajánlat': 'Lásd melléklet',
    
    // Szakorvosi vélemény
    'Szakorvosi vélemény': patient.szakorvosiVelemény || '',
    
    // Nyilatkozat (sablon lehet rövid vagy hosszú mezőnévvel)
    'Nyilatkozat': nyilatkozat,
    'Nyilatkozat a kezelési tervben rögzített tervezett ellátás vállalásáról': nyilatkozat,

    // Szolgáltató információk (sablon mezőnevek: pontosan ahogy a PDF-ben)
    'Fogorvos neve': 'Schmidt Péter Dr.',
    'Fogorvos pecsét száma': EQUITY_REQUEST_CONFIG.pecsetszam,
    'Szolgáltató neve': EQUITY_REQUEST_CONFIG.szolgaltatoNeve,
    'Szolgáltató címe': EQUITY_REQUEST_CONFIG.cim,
    'Vármegyekód': EQUITY_REQUEST_CONFIG.varmegyeKod,
    'Szolgálttó vármegyekód': EQUITY_REQUEST_CONFIG.varmegyeKod, // sablon elírás: dupla t
    'NEAK kód': EQUITY_REQUEST_CONFIG.neakKod,
    'Szolgáltató NEAK kód': EQUITY_REQUEST_CONFIG.neakKod,
    'Pecsétszám': EQUITY_REQUEST_CONFIG.pecsetszam,
    'pecsétszám': EQUITY_REQUEST_CONFIG.pecsetszam,
    'Pecsét': EQUITY_REQUEST_CONFIG.pecsetszam,
    
    // Dátum mezők (mai dátum)
    'kelt_helység': 'Budapest',
    'kelt_év': new Date().getFullYear().toString(),
    'kelt_hónap': (new Date().getMonth() + 1).toString().padStart(2, '0'),
    'kelt_nap': new Date().getDate().toString().padStart(2, '0'),
  };
  
  // TAJ szám karakterenkénti kitöltése
  for (let i = 1; i <= 9; i++) {
    fieldMapping[`TAJ száma ${i}`] = tajNumber[i - 1] || '';
  }
  
  // Munkahely azonosító karakterenkénti kitöltése (9 karakter: 01H7213LV)
  const munkahelyAzonosito = EQUITY_REQUEST_CONFIG.munkahelyAzonosito;
  // Próbáljuk meg több variációval is - karakterenkénti kitöltés
  for (let i = 1; i <= 9; i++) {
    fieldMapping[`munkahely 9 jegyű azonosító ${i}`] = munkahelyAzonosito[i - 1] || '';
    fieldMapping[`munkahely 9jegyű azonosító ${i}`] = munkahelyAzonosito[i - 1] || '';
    fieldMapping[`Munkahely 9 jegyű azonosító ${i}`] = munkahelyAzonosito[i - 1] || '';
    fieldMapping[`Munkahely 9jegyű azonosító ${i}`] = munkahelyAzonosito[i - 1] || '';
    fieldMapping[`Munkahely azonosítója ${i}`] = munkahelyAzonosito[i - 1] || '';
    fieldMapping[`Munkahely 9jegyű azonosítója ${i}`] = munkahelyAzonosito[i - 1] || '';
    fieldMapping[`9jegyű azonosító ${i}`] = munkahelyAzonosito[i - 1] || '';
  }
  // Ha egyetlen mezőbe kell írni - több variáció
  fieldMapping['munkahely 9 jegyű azonosító'] = munkahelyAzonosito;
  fieldMapping['munkahely 9jegyű azonosító'] = munkahelyAzonosito;
  fieldMapping['Munkahely 9 jegyű azonosító'] = munkahelyAzonosito;
  fieldMapping['Munkahely 9jegyű azonosító'] = munkahelyAzonosito;
  fieldMapping['Munkahely 9jegyű azonosítója'] = munkahelyAzonosito;
  fieldMapping['Munkahely azonosítója'] = munkahelyAzonosito;
  fieldMapping['9jegyű azonosító'] = munkahelyAzonosito;
  fieldMapping['Szolgáltató munkahely 9 jegyű azonosító'] = munkahelyAzonosito;

  // Form mezők kitöltése
  let filledFields = 0;
  const errors: Array<{ field: string; error: string }> = [];
  const allFieldNames: string[] = [];
  const matchedFields: Array<{ fieldName: string; mappingKey: string; value: string }> = [];
  
  console.log(`PDF form mezők száma: ${formFields.length}`);
  
  // Segédfüggvény mező kitöltéséhez
  const fillField = (field: any, value: string, fieldName: string, mappingKey: string): boolean => {
    const safeValue = toWinAnsiSafe(value);
    try {
      // Type guard használata a típus ellenőrzéshez
      if (field.constructor.name === 'PDFTextField') {
        // WinAnsi-safe szöveg kell, különben updateFieldAppearances/flatten hibázik (ő, ű)
        try {
          (field as any).setText(safeValue, { updateAppearances: true });
        } catch {
          (field as any).setText(safeValue);
        }
        filledFields++;
        matchedFields.push({ fieldName, mappingKey, value });
        console.log(`Mező kitöltve: ${fieldName} (kulcs: ${mappingKey}) = ${value}`);
        return true;
      } else if (field.constructor.name === 'PDFCheckBox') {
        const stringValue = String(value);
        if (stringValue === 'Igen' || stringValue === 'igen' || stringValue.toLowerCase() === 'true') {
          (field as any).check();
          filledFields++;
          matchedFields.push({ fieldName, mappingKey, value });
          console.log(`Checkbox bejelölve: ${fieldName} (kulcs: ${mappingKey})`);
          return true;
        }
      }
    } catch (err: any) {
      // Ha hiba van (pl. ékezetes karakterek miatt), próbáljuk meg közvetlenül beállítani
      if (err.message && (err.message.includes('WinAnsi cannot encode') || err.message.includes('encoding'))) {
        try {
          const acroField = (field as any).acroField;
          const fieldDict = acroField.dict;
          fieldDict.set('V', pdfDoc.context.obj(safeValue));
          filledFields++;
          matchedFields.push({ fieldName, mappingKey, value });
          console.log(`Mező kitöltve (közvetlen): ${fieldName} (kulcs: ${mappingKey}) = ${value}`);
          return true;
        } catch (directErr) {
          const errorMsg = (directErr as Error).message;
          errors.push({ field: fieldName, error: errorMsg });
          console.error(`Hiba a mező kitöltésekor (közvetlen): ${fieldName} - ${errorMsg}`);
          return false;
        }
      } else {
        const errorMsg = err.message || 'Ismeretlen hiba';
        errors.push({ field: fieldName, error: errorMsg });
        console.error(`Hiba a mező kitöltésekor: ${fieldName} - ${errorMsg}`);
        return false;
      }
    }
    return false;
  };
  
  formFields.forEach(field => {
    const fieldName = field.getName();
    allFieldNames.push(fieldName);
    
    // Pontos mezőnév egyezés keresése
    if (fieldMapping.hasOwnProperty(fieldName)) {
      const value = fieldMapping[fieldName];
      if (value && String(value).trim() !== '') {
        fillField(field, value, fieldName, fieldName);
      }
    } else {
      // Ha nincs pontos egyezés, próbáljuk meg részleges egyezéssel
      const fieldNameLower = fieldName.toLowerCase().trim();
      let matched = false;
      
      // Először próbáljuk meg a teljes egyezést (kis/nagybetű és szóközök nélkül)
      for (const [key, value] of Object.entries(fieldMapping)) {
        const keyLower = key.toLowerCase().trim();
        if (fieldNameLower === keyLower) {
          if (value && String(value).trim() !== '') {
            matched = fillField(field, value, fieldName, key);
            if (matched) break;
          }
        }
      }
      
      // Ha még nem találtunk egyezést, próbáljuk meg a részleges egyezést
      if (!matched) {
        for (const [key, value] of Object.entries(fieldMapping)) {
          const keyLower = key.toLowerCase().trim();
          // Részleges egyezés: tartalmazza-e a mezőnév a kulcsot vagy fordítva
          if ((fieldNameLower.includes(keyLower) || keyLower.includes(fieldNameLower)) && 
              keyLower.length > 3 && fieldNameLower.length > 3) {
            if (value && String(value).trim() !== '') {
              matched = fillField(field, value, fieldName, key);
              if (matched) break;
            }
          }
        }
      }
      
      if (!matched) {
        console.log(`Mező nem található a mapping-ben: ${fieldName}`);
      }
    }
  });
  
  console.log(`Összesen ${filledFields} mező lett kitöltve a ${formFields.length} mezőből`);
  if (matchedFields.length > 0) {
    console.log(`Kitöltött mezők: ${matchedFields.map(m => `${m.fieldName} (${m.mappingKey})`).join(', ')}`);
  }
  console.log(`Elérhető mezőnevek: ${allFieldNames.slice(0, 30).join(', ')}${allFieldNames.length > 30 ? `... (összesen ${allFieldNames.length})` : ''}`);
  console.log(`Mapping kulcsok: ${Object.keys(fieldMapping).slice(0, 30).join(', ')}${Object.keys(fieldMapping).length > 30 ? `... (összesen ${Object.keys(fieldMapping).length})` : ''}`);
  
  if (errors.length > 0) {
    console.error(`Hibák a PDF kitöltésekor:`, errors);
  }
  
  if (filledFields === 0) {
    const err =
      formFields.length === 0
        ? new Error('A PDF template nem tartalmaz kitölthető form mezőket. Ellenőrizze, hogy a template fájl helyes-e.')
        : new Error('Equity template loaded but no field names matched mapping.');
    (err as Error & { details?: { foundFieldNames: string[]; mappingKeys: string[] } }).details = {
      foundFieldNames: allFieldNames,
      mappingKeys: Object.keys(fieldMapping),
    };
    console.warn('Equity PDF field mismatch:', (err as Error & { details?: unknown }).details);
    throw err;
  }
  
  // 1) Explicit appearance stream generálás – így a kitöltött szöveg minden nézegetőben látszik
  try {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    form.updateFieldAppearances(font);
    console.log('PDF form mezők megjelenése frissítve (updateFieldAppearances)');
  } catch (appearanceError) {
    console.warn('Hiba az appearance frissítésekor (folytatás flatten nélkül):', appearanceError);
  }

  // 2) Form flatten – mezők tartalma a lapokra kerül, nem maradnak szerkeszthető mezők, mindig látszik a szöveg
  try {
    form.flatten({ updateFieldAppearances: true });
    console.log('PDF form flatten sikeres – mezők tartalma beolvasztva a lapokba');
  } catch (flattenError) {
    console.warn('Flatten sikertelen, PDF mentése mezőkkel:', flattenError);
  }

  // PDF mentése
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await pdfDoc.save();
    console.log('PDF sikeresen mentve');
  } catch (saveError) {
    throw new Error(`PDF mentési hiba: ${(saveError as Error).message}`);
  }

  return Buffer.from(pdfBytes);
}


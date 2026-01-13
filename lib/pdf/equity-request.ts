import { PDFDocument } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { Patient } from '@/lib/types';
import { EQUITY_REQUEST_CONFIG } from '@/lib/equity-request-config';
import bnoCodesData from '@/lib/bno-codes.json';

interface BNOCode {
  kod: string;
  nev: string;
}

const bnoCodes = bnoCodesData as BNOCode[];

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
  
  // Logo betöltése és hozzáadása az első oldalhoz (ha létezik PNG verzió) - logo_1 balra, logo_2 jobbra
  const pages = pdfDoc.getPages();
  if (pages.length > 0) {
    const firstPage = pages[0];
    const pageWidth = firstPage.getSize().width;
    const margin = 50;
    const logoWidth = 50;
    const topMargin = 30;
    
    try {
      const logo1Path = path.join(process.cwd(), 'public', 'logo_1.png');
      if (fs.existsSync(logo1Path)) {
        const logoBytes = fs.readFileSync(logo1Path);
        const logoImage1 = await pdfDoc.embedPng(logoBytes);
        const logoHeight1 = (logoImage1.height / logoImage1.width) * logoWidth;
        // Logo 1 hozzáadása balra igazítva
        firstPage.drawImage(logoImage1, {
          x: margin,
          y: firstPage.getSize().height - logoHeight1 - topMargin,
          width: logoWidth,
          height: logoHeight1,
        });
      }
    } catch (error) {
      console.warn('Logo 1 betöltése sikertelen:', error);
    }
    
    try {
      const logo2Path = path.join(process.cwd(), 'public', 'logo_2.png');
      if (fs.existsSync(logo2Path)) {
        const logoBytes = fs.readFileSync(logo2Path);
        const logoImage2 = await pdfDoc.embedPng(logoBytes);
        const logoHeight2 = (logoImage2.height / logoImage2.width) * logoWidth;
        // Logo 2 hozzáadása jobbra igazítva
        firstPage.drawImage(logoImage2, {
          x: pageWidth - logoWidth - margin,
          y: firstPage.getSize().height - logoHeight2 - topMargin,
          width: logoWidth,
          height: logoHeight2,
        });
      }
    } catch (error) {
      console.warn('Logo 2 betöltése sikertelen:', error);
    }
  }
  
  // Form mezők lekérése
  let form;
  let formFields;
  try {
    form = pdfDoc.getForm();
    formFields = form.getFields();
    console.log(`PDF form sikeresen betöltve. Mezők száma: ${formFields.length}`);
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
    
    // Nyilatkozat
    'Nyilatkozat': nyilatkozat,
    
    // Szolgáltató információk
    'Fogorvos neve': 'Schmidt Péter Dr.',
    'Szolgáltató neve': EQUITY_REQUEST_CONFIG.szolgaltatoNeve,
    'Szolgáltató címe': EQUITY_REQUEST_CONFIG.cim,
    'Vármegyekód': EQUITY_REQUEST_CONFIG.varmegyeKod,
    'NEAK kód': EQUITY_REQUEST_CONFIG.neakKod,
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
  
  // Form mezők kitöltése
  let filledFields = 0;
  const errors: Array<{ field: string; error: string }> = [];
  const allFieldNames: string[] = [];
  
  console.log(`PDF form mezők száma: ${formFields.length}`);
  
  formFields.forEach(field => {
    const fieldName = field.getName();
    allFieldNames.push(fieldName);
    
    // Pontos mezőnév egyezés keresése
    if (fieldMapping.hasOwnProperty(fieldName)) {
      const value = fieldMapping[fieldName];
      try {
        // Type guard használata a típus ellenőrzéshez
        if (field.constructor.name === 'PDFTextField') {
          // Próbáljuk meg az updateAppearances opcióval is
          try {
            (field as any).setText(String(value), { updateAppearances: true });
          } catch {
            // Ha nem támogatja, próbáljuk meg anélkül
            (field as any).setText(String(value));
          }
          filledFields++;
          console.log(`Mező kitöltve: ${fieldName} = ${value}`);
        } else if (field.constructor.name === 'PDFCheckBox') {
          const stringValue = String(value);
          if (stringValue === 'Igen' || stringValue === 'igen' || stringValue.toLowerCase() === 'true') {
            (field as any).check();
            filledFields++;
            console.log(`Checkbox bejelölve: ${fieldName}`);
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
            console.log(`Mező kitöltve (közvetlen): ${fieldName} = ${value}`);
          } catch (directErr) {
            const errorMsg = (directErr as Error).message;
            errors.push({ field: fieldName, error: errorMsg });
            console.error(`Hiba a mező kitöltésekor (közvetlen): ${fieldName} - ${errorMsg}`);
          }
        } else {
          const errorMsg = err.message || 'Ismeretlen hiba';
          errors.push({ field: fieldName, error: errorMsg });
          console.error(`Hiba a mező kitöltésekor: ${fieldName} - ${errorMsg}`);
        }
      }
    } else {
      // Ha nincs pontos egyezés, próbáljuk meg részleges egyezéssel
      const fieldNameLower = fieldName.toLowerCase();
      let matched = false;
      for (const [key, value] of Object.entries(fieldMapping)) {
        if (fieldNameLower.includes(key.toLowerCase()) || key.toLowerCase().includes(fieldNameLower)) {
          try {
            if (field.constructor.name === 'PDFTextField') {
              // Próbáljuk meg az updateAppearances opcióval is
              try {
                (field as any).setText(String(value), { updateAppearances: true });
              } catch {
                // Ha nem támogatja, próbáljuk meg anélkül
                (field as any).setText(String(value));
              }
              filledFields++;
              matched = true;
              console.log(`Mező kitöltve (részleges egyezés): ${fieldName} (kulcs: ${key}) = ${value}`);
              break;
            }
          } catch (err) {
            // Folytatjuk a következő mezővel
          }
        }
      }
      if (!matched) {
        console.log(`Mező nem található a mapping-ben: ${fieldName}`);
      }
    }
  });
  
  console.log(`Összesen ${filledFields} mező lett kitöltve a ${formFields.length} mezőből`);
  console.log(`Elérhető mezőnevek: ${allFieldNames.join(', ')}`);
  console.log(`Mapping kulcsok: ${Object.keys(fieldMapping).join(', ')}`);
  
  if (errors.length > 0) {
    console.error(`Hibák a PDF kitöltésekor:`, errors);
  }
  
  // Ha egyetlen mező sem lett kitöltve, figyelmeztetés
  if (filledFields === 0) {
    if (formFields.length === 0) {
      console.warn('FIGYELEM: A PDF template-nek nincsenek form mezői! A PDF üres lesz.');
      throw new Error('A PDF template nem tartalmaz kitölthető form mezőket. Ellenőrizze, hogy a template fájl helyes-e.');
    } else {
      console.warn('FIGYELEM: Egyetlen mező sem lett kitöltve! A PDF üres lehet.');
      console.warn(`Talált mezők a PDF-ben: ${allFieldNames.slice(0, 20).join(', ')}${allFieldNames.length > 20 ? '...' : ''}`);
      console.warn(`Mapping kulcsok: ${Object.keys(fieldMapping).slice(0, 20).join(', ')}${Object.keys(fieldMapping).length > 20 ? '...' : ''}`);
      throw new Error(`Nem sikerült kitölteni a PDF mezőket. Talált mezők: ${allFieldNames.slice(0, 10).join(', ')}${allFieldNames.length > 10 ? '...' : ''}. Ellenőrizze, hogy a mezőnevek egyeznek-e a template-tel.`);
    }
  }
  
  // PDF mentése - fontos: updateFieldAppearances: true kell, hogy a kitöltött mezők láthatók legyenek
  let pdfBytes: Uint8Array;
  try {
    // Először próbáljuk meg az appearance frissítéssel (ez biztosítja, hogy a mezők láthatók legyenek)
    pdfBytes = await pdfDoc.save({ updateFieldAppearances: true });
    console.log('PDF sikeresen mentve appearance frissítéssel');
  } catch (saveError) {
    console.warn('Hiba az appearance frissítéssel, próbáljuk meg anélkül:', saveError);
    try {
      // Ha nem sikerül, próbáljuk meg anélkül
      pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
      console.warn('PDF mentve appearance frissítés nélkül - a mezők lehet, hogy nem láthatók');
    } catch (saveError2) {
      throw new Error(`PDF mentési hiba: ${(saveError2 as Error).message}`);
    }
  }
  
  return Buffer.from(pdfBytes);
}


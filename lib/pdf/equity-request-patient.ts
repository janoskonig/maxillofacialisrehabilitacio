/**
 * FNMT.150.K – páciens adatokkal kitöltött méltányossági PDF.
 * Csak meghatározott mezők: név, TAJ, szül. hely/idő, lakcím, anyja neve, elérhetőség.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import path from 'path';
import { Patient } from '@/lib/types';
import { readFileFromCandidates, projectRootCandidates } from '@/lib/pdf/fs';

/** HU dátum: YYYY.MM.DD */
function formatHuDate(d: string | Date | null | undefined): string {
  if (d == null) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

/** WinAnsi-safe (ő→ö, ű→ü) for PDF text fields */
function toWinAnsiSafe(text: string): string {
  return String(text)
    .replace(/ő/g, 'ö')
    .replace(/Ő/g, 'Ö')
    .replace(/ű/g, 'ü')
    .replace(/Ű/g, 'Ü');
}

function getFnmt150TemplateBytes(): Buffer {
  const candidates = [
    ...projectRootCandidates('public', 'templates', 'FNMT.150.K.pdf'),
    path.join(process.cwd(), 'public', 'templates', 'FNMT.150.K.pdf'),
  ];
  return readFileFromCandidates(candidates);
}

export interface PatientDataEquityResult {
  pdf: Buffer;
  missingFields: string[];
}

/**
 * FNMT.150.K kitöltése csak páciens adatokkal. TAJ csak ha pont 9 számjegy.
 * Hiányzó adatok (anyja neve, szül. hely, érvénytelen TAJ) → missingFields, README-be írjuk.
 */
export async function generatePatientDataEquityPDF(
  patient: Patient
): Promise<PatientDataEquityResult> {
  const missingFields: string[] = [];
  const templateBytes = getFnmt150TemplateBytes();
  const pdfDoc = await PDFDocument.load(new Uint8Array(templateBytes), { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const formFields = form.getFields();

  const digits = (patient.taj ?? '').replace(/\D/g, '');
  const tajValid = digits.length === 9;
  if (!tajValid && (patient.taj ?? '').trim() !== '') {
    missingFields.push('TAJ');
  }

  // Születési hely nincs a patients táblában
  missingFields.push('születési hely');
  // Anyja neve nincs a sémában
  missingFields.push('anyja neve');

  const lakcim = [patient.cim, patient.varos, patient.iranyitoszam].filter(Boolean).join(', ');
  const elerhetoseg = [patient.telefonszam, patient.email].filter(Boolean).join(', ');

  const fieldMapping: Record<string, string> = {
    'Biztosított neve': patient.nev ?? '',
    'Születési helye és ideje': formatHuDate(patient.szuletesiDatum ?? null),
    'Lakcíme levelezési címe': lakcim,
    'Anyja neve': '',
    'Elérhetősége (telefon/mobil/e-mail)': elerhetoseg,
    'Elérhetőség_telefon': elerhetoseg,
  };

  for (let i = 1; i <= 9; i++) {
    fieldMapping[`TAJ száma ${i}`] = tajValid ? digits[i - 1] ?? '' : '';
  }

  const fillField = (field: unknown, value: string): boolean => {
    const safeValue = toWinAnsiSafe(value);
    try {
      const f = field as { constructor: { name: string }; setText?: (v: string, o?: { updateAppearances?: boolean }) => void };
      if (f.constructor?.name === 'PDFTextField' && typeof f.setText === 'function') {
        f.setText(safeValue, { updateAppearances: true });
        return true;
      }
    } catch {
      /* skip */
    }
    return false;
  };

  formFields.forEach((field) => {
    const fieldName = field.getName();
    const value = fieldMapping[fieldName];
    if (value !== undefined && String(value).trim() !== '') {
      fillField(field, value);
    }
  });

  try {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    form.updateFieldAppearances(font);
  } catch {
    /* continue */
  }
  try {
    form.flatten({ updateFieldAppearances: true });
  } catch {
    /* continue */
  }

  const pdfBytes = await pdfDoc.save();
  return { pdf: Buffer.from(pdfBytes), missingFields };
}

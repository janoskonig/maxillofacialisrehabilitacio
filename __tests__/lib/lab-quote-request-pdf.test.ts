import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { generateLabQuoteRequestPDF } from '@/lib/pdf/lab-quote-request';
import { wrapTextLines } from '@/lib/pdf/layout';

const patient = {
  id: 'p1',
  nev: 'Minta Péterné',
  cim: 'Üllői út 26. 2/4.',
  varos: 'Budapest',
  iranyitoszam: '1085',
  kezeleoorvos: 'Dr. Kezelő Orvos',
} as any;

const shortQuote = {
  id: 'q1',
  patientId: 'p1',
  szoveg: 'Felső állcsont: 14-24 fémkerámia híd.\nAlsó állcsont: kombinált fogpótlás.',
  datuma: '2026-09-20',
} as any;

async function pageCount(buf: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buf);
  return doc.getPageCount();
}

describe('generateLabQuoteRequestPDF', () => {
  it('rövid kérésből egyoldalas, kis méretű PDF-et készít (részhalmazolt betűkészlet)', async () => {
    const buf = await generateLabQuoteRequestPDF(patient, shortQuote, 'Dr. Küldő Doktor');
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(await pageCount(buf)).toBe(1);
    // Részhalmazolás nélkül a két DejaVu betűkészlet önmagában ~1,2 MB-ot tett hozzá.
    expect(buf.length).toBeLessThan(700 * 1024);
  });

  it('hosszú szöveget több oldalra tördel', async () => {
    const paragraph =
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';
    const longQuote = { ...shortQuote, szoveg: Array.from({ length: 40 }, () => paragraph).join('\n\n') };
    const buf = await generateLabQuoteRequestPDF(patient, longQuote, 'Dr. Küldő Doktor');
    expect(await pageCount(buf)).toBeGreaterThan(1);
  });

  it('hiányzó mezők (cím, határidő, szöveg, orvos) mellett sem dob hibát', async () => {
    const minimalPatient = { id: 'p2', nev: 'Csak Név' } as any;
    const minimalQuote = { id: 'q2', patientId: 'p2', szoveg: '', datuma: null } as any;
    const buf = await generateLabQuoteRequestPDF(minimalPatient, minimalQuote, null);
    expect(await pageCount(buf)).toBe(1);
  });
});

describe('wrapTextLines', () => {
  it('szóhatáron tördel, és a túl hosszú szót karakterenként vágja', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = wrapTextLines('alma korte szilva barack dinnye', font, 12, 90);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('alma korte szilva barack dinnye');
    for (const l of lines) expect(font.widthOfTextAtSize(l, 12)).toBeLessThanOrEqual(90);

    const long = wrapTextLines('x'.repeat(200), font, 12, 60);
    expect(long.length).toBeGreaterThan(1);
    for (const l of long) expect(font.widthOfTextAtSize(l, 12)).toBeLessThanOrEqual(60);
    expect(long.join('')).toBe('x'.repeat(200));
  });

  it('üres szövegre egyetlen üres sort ad', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(wrapTextLines('   ', font, 12, 100)).toEqual(['']);
  });
});

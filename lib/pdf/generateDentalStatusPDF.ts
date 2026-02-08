import { PDFDocument, StandardFonts, rgb, PDFPage } from 'pdf-lib';
import fs from 'fs';
import { resolveExistingPath, projectRootCandidates } from '@/lib/pdf/fs';

interface Patient {
  id?: string;
  nev?: string | null;
  taj?: string | null;
  meglevoFogak?: Record<string, unknown>;
  felsoFogpotlasVan?: boolean;
  felsoFogpotlasMikor?: string | null;
  felsoFogpotlasKeszito?: string | null;
  felsoFogpotlasElegedett?: boolean;
  felsoFogpotlasProblema?: string | null;
  felsoFogpotlasTipus?: string | null;
  fabianFejerdyProtetikaiOsztalyFelso?: string | null;
  alsoFogpotlasVan?: boolean;
  alsoFogpotlasMikor?: string | null;
  alsoFogpotlasKeszito?: string | null;
  alsoFogpotlasElegedett?: boolean;
  alsoFogpotlasProblema?: string | null;
  alsoFogpotlasTipus?: string | null;
  fabianFejerdyProtetikaiOsztalyAlso?: string | null;
  meglevoImplantatumok?: Record<string, string>;
  nemIsmertPoziciokbanImplantatum?: boolean;
  nemIsmertPoziciokbanImplantatumRészletek?: string | null;
}

type ToothStatus = { status?: 'D' | 'F' | 'M'; description?: string } | string;

function normalizeToothData(value: ToothStatus | undefined): { status?: 'D' | 'F' | 'M'; description?: string } | null {
  if (!value) return null;
  if (typeof value === 'string') return { description: value };
  return value;
}

/** WinAnsi (Helvetica) nem kódolja ő/ű, ✓ (U+2713), ✗ (U+2717) – cseréljük ASCII-ra */
function toWinAnsiSafe(text: string): string {
  return String(text)
    .replace(/ő/g, 'ö')
    .replace(/Ő/g, 'Ö')
    .replace(/ű/g, 'ü')
    .replace(/Ű/g, 'Ü')
    .replace(/\u2713/g, '+') // ✓ → +
    .replace(/\u2717/g, 'X'); // ✗ → X
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 50;
const PAGE_END = MARGIN + 40;

function addPageIfNeeded(
  pdf: PDFDocument,
  state: { page: PDFPage; y: number },
  _font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  _fontBold: Awaited<ReturnType<PDFDocument['embedFont']>>
): void {
  if (state.y >= PAGE_END) return;
  state.page = pdf.addPage([A4.width, A4.height]);
  state.y = A4.height - MARGIN;
}

function drawToothStatus(
  page: PDFPage,
  x: number,
  y: number,
  cellWidth: number,
  cellHeight: number,
  status: 'M' | 'present' | null,
  description?: string
): void {
  const centerX = x + cellWidth / 2;
  const centerY = y + cellHeight / 2;
  const size = 7;

  if (status === 'M') {
    page.drawLine({
      start: { x: centerX - size, y: centerY - size },
      end: { x: centerX + size, y: centerY + size },
      thickness: 2,
      color: rgb(0.42, 0.45, 0.5),
    });
    page.drawLine({
      start: { x: centerX + size, y: centerY - size },
      end: { x: centerX - size, y: centerY + size },
      thickness: 2,
      color: rgb(0.42, 0.45, 0.5),
    });
  } else if (status === 'present') {
    const desc = (description || '').toLowerCase();
    const hasRemenytelen = desc.includes('reménytelen');
    const hasKerdeses = desc.includes('kérdéses');
    if (hasRemenytelen) {
      page.drawLine({
        start: { x: centerX, y: centerY - size },
        end: { x: centerX, y: centerY + size / 3 },
        thickness: 2.5,
        color: rgb(0.86, 0.15, 0.15),
      });
      page.drawCircle({ x: centerX, y: centerY + size * 0.8, size: 1.8, color: rgb(0.86, 0.15, 0.15) });
    } else if (hasKerdeses) {
      page.drawCircle({
        x: centerX,
        y: centerY - size / 2,
        size: size / 2.2,
        borderColor: rgb(0.92, 0.7, 0.03),
        borderWidth: 2,
      });
      page.drawCircle({ x: centerX, y: centerY + size * 0.75, size: 1.5, color: rgb(0.92, 0.7, 0.03) });
    } else {
      page.drawLine({
        start: { x: centerX - size, y: centerY },
        end: { x: centerX - size / 3, y: centerY + size },
        thickness: 2.5,
        color: rgb(0.06, 0.73, 0.51),
      });
      page.drawLine({
        start: { x: centerX - size / 3, y: centerY + size },
        end: { x: centerX + size, y: centerY - size },
        thickness: 2.5,
        color: rgb(0.06, 0.73, 0.51),
      });
    }
  }
}

export async function generateDentalStatusPDF(patient: Patient): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const state: { page: PDFPage; y: number } = {
    page: pdf.addPage([A4.width, A4.height]),
    y: A4.height - MARGIN,
  };

  const draw = (text: string, size: number, bold: boolean, options?: { align?: 'left' | 'center' }) => {
    addPageIfNeeded(pdf, state, font, fontBold);
    const safe = toWinAnsiSafe(text);
    const f = bold ? fontBold : font;
    const width = f.widthOfTextAtSize(safe, size);
    const x = options?.align === 'center' ? (A4.width - width) / 2 : MARGIN;
    state.page.drawText(safe, { x, y: state.y - size, size, font: f, color: rgb(0, 0, 0) });
    state.y -= size + 6;
  };

  // Logos
  const logo1Path = resolveExistingPath(projectRootCandidates('public', 'logo_1.png'));
  const logo2Path = resolveExistingPath(projectRootCandidates('public', 'logo_2.png'));
  const logoWidth = 60;
  const logoHeight = 60;
  let hasLogo = false;
  if (logo1Path) {
    try {
      const logoBytes = fs.readFileSync(logo1Path);
      const img = await pdf.embedPng(logoBytes);
      const h = (img.height / img.width) * logoWidth;
      state.page.drawImage(img, { x: MARGIN, y: state.y - h, width: logoWidth, height: h });
      hasLogo = true;
    } catch {
      /* ignore */
    }
  }
  if (logo2Path) {
    try {
      const logoBytes = fs.readFileSync(logo2Path);
      const img = await pdf.embedPng(logoBytes);
      const h = (img.height / img.width) * logoWidth;
      state.page.drawImage(img, { x: A4.width - MARGIN - logoWidth, y: state.y - h, width: logoWidth, height: h });
      hasLogo = true;
    } catch {
      /* ignore */
    }
  }
  if (hasLogo) state.y -= logoHeight + 8;

  draw('SEMMELWEIS EGYETEM', 18, true, { align: 'center' });
  draw('Fogorvostudományi Kar', 15, false, { align: 'center' });
  draw('Fogpótlástani Klinika', 14, false, { align: 'center' });
  draw('Igazgató: Prof. Dr. Hermann Péter', 11, false, { align: 'center' });
  state.y -= 12;

  const currentDate = new Date().toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
  const dateText = toWinAnsiSafe(`Dátum: ${currentDate}`);
  const dateW = font.widthOfTextAtSize(dateText, 9);
  state.page.drawText(dateText, { x: A4.width - MARGIN - dateW, y: state.y - 9, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
  state.y -= 24;

  state.page.drawLine({
    start: { x: MARGIN, y: state.y },
    end: { x: 545, y: state.y },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  state.y -= 20;

  draw('PÁCIENS ADATOK', 12, true);
  draw(`Beteg neve: ${patient.nev || 'Név nélküli beteg'}`, 11, false);
  if (patient.taj) draw(`TAJ szám: ${patient.taj}`, 11, false);
  state.y -= 16;

  draw('FOGAZATI STÁTUSZ', 12, true);
  state.y -= 10;

  const fogak = patient.meglevoFogak || {};
  const upperLeft = [18, 17, 16, 15, 14, 13, 12, 11];
  const upperRight = [21, 22, 23, 24, 25, 26, 27, 28];
  const lowerLeft = [48, 47, 46, 45, 44, 43, 42, 41];
  const lowerRight = [31, 32, 33, 34, 35, 36, 37, 38];

  const pageWidth = 545 - MARGIN;
  const numTeethPerRow = 8;
  const spacing = 2;
  const gapBetweenSides = 10;
  const cellWidth = Math.floor((pageWidth - numTeethPerRow * spacing - gapBetweenSides) / (numTeethPerRow * 2));
  const cellHeight = 18;
  const startX = MARGIN;

  const drawRow = (teeth: number[]) => {
    let xPos = startX;
    for (const tooth of teeth) {
      addPageIfNeeded(pdf, state, font, fontBold);
      state.page.drawRectangle({
        x: xPos,
        y: state.y - cellHeight,
        width: cellWidth,
        height: cellHeight,
        borderColor: rgb(0, 0, 0),
      });
      state.page.drawText(tooth.toString(), {
        x: xPos + 1,
        y: state.y - 10,
        size: 7,
        font: fontBold,
        color: rgb(0, 0, 0),
      });
      const value = fogak[tooth.toString()];
      const norm = normalizeToothData(value as ToothStatus | undefined);
      if (norm) {
        const st: 'M' | 'present' | null = norm.status === 'M' ? 'M' : 'present';
        drawToothStatus(state.page, xPos, state.y - cellHeight, cellWidth, cellHeight, st, norm.description);
      }
      xPos += cellWidth + spacing;
    }
  };

  drawRow(upperLeft);
  let xPos = startX + (cellWidth + spacing) * 8 + gapBetweenSides;
  for (const tooth of upperRight) {
    addPageIfNeeded(pdf, state, font, fontBold);
    state.page.drawRectangle({ x: xPos, y: state.y - cellHeight, width: cellWidth, height: cellHeight, borderColor: rgb(0, 0, 0) });
    state.page.drawText(tooth.toString(), { x: xPos + 1, y: state.y - 10, size: 7, font: fontBold, color: rgb(0, 0, 0) });
    const value = fogak[tooth.toString()];
    const norm = normalizeToothData(value as ToothStatus | undefined);
    if (norm) {
      const st: 'M' | 'present' | null = norm.status === 'M' ? 'M' : 'present';
      drawToothStatus(state.page, xPos, state.y - cellHeight, cellWidth, cellHeight, st, norm.description);
    }
    xPos += cellWidth + spacing;
  }
  state.y -= cellHeight + 10;

  drawRow(lowerLeft);
  xPos = startX + (cellWidth + spacing) * 8 + gapBetweenSides;
  for (const tooth of lowerRight) {
    addPageIfNeeded(pdf, state, font, fontBold);
    state.page.drawRectangle({ x: xPos, y: state.y - cellHeight, width: cellWidth, height: cellHeight, borderColor: rgb(0, 0, 0) });
    state.page.drawText(tooth.toString(), { x: xPos + 1, y: state.y - 10, size: 7, font: fontBold, color: rgb(0, 0, 0) });
    const value = fogak[tooth.toString()];
    const norm = normalizeToothData(value as ToothStatus | undefined);
    if (norm) {
      const st: 'M' | 'present' | null = norm.status === 'M' ? 'M' : 'present';
      drawToothStatus(state.page, xPos, state.y - cellHeight, cellWidth, cellHeight, st, norm.description);
    }
    xPos += cellWidth + spacing;
  }
  state.y -= cellHeight + 18;

  const legend = toWinAnsiSafe(
    'Jelentés: ✓ = Megvan (zöld), ? = Kérdéses (sárga), ! = Reménytelen (piros), X = Hiányzik (szürke)'
  );
  state.page.drawText(legend, { x: MARGIN, y: state.y - 8, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
  state.y -= 20;

  let dCount = 0,
    fCount = 0,
    mCount = 0;
  Object.values(fogak).forEach((value) => {
    const norm = normalizeToothData(value as ToothStatus | undefined);
    if (norm) {
      if (norm.status === 'D') dCount++;
      else if (norm.status === 'F') fCount++;
      else if (norm.status === 'M') mCount++;
    }
  });
  const dmft = dCount + fCount + mCount;

  addPageIfNeeded(pdf, state, font, fontBold);
  state.page.drawRectangle({
    x: MARGIN,
    y: state.y - 50,
    width: 495,
    height: 50,
    color: rgb(0.88, 0.95, 1),
    borderColor: rgb(0.58, 0.77, 0.99),
  });
  state.page.drawText('DMF-T INDEX', { x: 60, y: state.y - 18, size: 11, font: fontBold, color: rgb(0, 0, 0) });
  state.page.drawText(`D (szuvas): ${dCount}`, { x: 60, y: state.y - 35, size: 10, font, color: rgb(0.86, 0.15, 0.15) });
  state.page.drawText(`F (tömött): ${fCount}`, { x: 200, y: state.y - 35, size: 10, font, color: rgb(0.15, 0.39, 0.92) });
  state.page.drawText(`M (hiányzik): ${mCount}`, { x: 340, y: state.y - 35, size: 10, font, color: rgb(0.42, 0.45, 0.5) });
  state.page.drawText(toWinAnsiSafe(`DMF-T összesen: ${dmft} / 32`), {
    x: 450,
    y: state.y - 35,
    size: 10,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  state.y -= 60;

  const formatToothDetail = (
    toothNumber: string,
    norm: { status?: 'D' | 'F' | 'M'; description?: string } | null
  ): string => {
    if (!norm) return '';
    let desc = norm.description || '';
    if (!desc && norm.status) {
      if (norm.status === 'D') desc = 'Szuvas';
      else if (norm.status === 'F') desc = 'Tömött';
      else if (norm.status === 'M') desc = 'Hiányzik';
    }
    const st = norm.status === 'D' ? ' (D)' : norm.status === 'F' ? ' (F)' : norm.status === 'M' ? ' (M)' : '';
    return `${toothNumber}: ${desc}${st}`;
  };

  const upperTeeth = [11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28];
  const upperTeethWithData = upperTeeth
    .map((t) => t.toString())
    .filter((num) => {
      const v = fogak[num];
      const n = normalizeToothData(v as ToothStatus | undefined);
      return n && (n.description || n.status);
    })
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  if (upperTeethWithData.length > 0) {
    state.y -= 8;
    draw('FELSÖ FOGAK', 11, true);
    for (const num of upperTeethWithData) {
      const n = normalizeToothData(fogak[num] as ToothStatus | undefined);
      const line = formatToothDetail(num, n);
      if (line) {
        addPageIfNeeded(pdf, state, font, fontBold);
        state.page.drawText(toWinAnsiSafe(line), { x: MARGIN, y: state.y - 10, size: 10, font, color: rgb(0, 0, 0) });
        state.y -= 14;
      }
    }
    draw('Fábián- és Fejérdy-féle protetikai foghiányosztályozás:', 10, true);
    if (patient.fabianFejerdyProtetikaiOsztalyFelso) {
      state.page.drawText(toWinAnsiSafe(patient.fabianFejerdyProtetikaiOsztalyFelso), {
        x: MARGIN,
        y: state.y - 10,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
      state.y -= 14;
    }
    state.y -= 8;
  }

  const lowerTeeth = [31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48];
  const lowerTeethWithData = lowerTeeth
    .map((t) => t.toString())
    .filter((num) => {
      const v = fogak[num];
      const n = normalizeToothData(v as ToothStatus | undefined);
      return n && (n.description || n.status);
    })
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  if (lowerTeethWithData.length > 0) {
    draw('ALSÓ FOGAK', 11, true);
    for (const num of lowerTeethWithData) {
      const n = normalizeToothData(fogak[num] as ToothStatus | undefined);
      const line = formatToothDetail(num, n);
      if (line) {
        addPageIfNeeded(pdf, state, font, fontBold);
        state.page.drawText(toWinAnsiSafe(line), { x: MARGIN, y: state.y - 10, size: 10, font, color: rgb(0, 0, 0) });
        state.y -= 14;
      }
    }
    draw('Fábián- és Fejérdy-féle protetikai foghiányosztályozás:', 10, true);
    if (patient.fabianFejerdyProtetikaiOsztalyAlso) {
      state.page.drawText(toWinAnsiSafe(patient.fabianFejerdyProtetikaiOsztalyAlso), {
        x: MARGIN,
        y: state.y - 10,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
      state.y -= 14;
    }
    state.y -= 8;
  }

  if (
    (patient.meglevoImplantatumok && Object.keys(patient.meglevoImplantatumok).length > 0) ||
    patient.nemIsmertPoziciokbanImplantatum
  ) {
    state.y -= 12;
    draw('IMPLANTATUMOK', 11, true);
    if (patient.meglevoImplantatumok && Object.keys(patient.meglevoImplantatumok).length > 0) {
      for (const num of Object.keys(patient.meglevoImplantatumok).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))) {
        addPageIfNeeded(pdf, state, font, fontBold);
        state.page.drawText(toWinAnsiSafe(`${num}. fog: ${patient.meglevoImplantatumok[num]}`), {
          x: MARGIN,
          y: state.y - 10,
          size: 10,
          font,
          color: rgb(0, 0, 0),
        });
        state.y -= 14;
      }
    }
    if (patient.nemIsmertPoziciokbanImplantatum) {
      draw('Nem ismert pozíciókban implantátum', 10, true);
      if (patient.nemIsmertPoziciokbanImplantatumRészletek) {
        state.page.drawText(toWinAnsiSafe(patient.nemIsmertPoziciokbanImplantatumRészletek), {
          x: 60,
          y: state.y - 9,
          size: 9,
          font,
          color: rgb(0.29, 0.34, 0.39),
        });
        state.y -= 16;
      }
    }
  }

  const footerY = Math.max(state.y - 20, 80);
  state.page.drawLine({
    start: { x: MARGIN, y: footerY },
    end: { x: 545, y: footerY },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  state.page.drawText('Cím: 1088 Budapest, Szentkirályi utca 47.', { x: MARGIN, y: footerY - 8, size: 7, font, color: rgb(0, 0, 0) });
  state.page.drawText('Postacím: 1085 Budapest, Üllői út 26.; 1428 Budapest Pf. 2.', {
    x: MARGIN,
    y: footerY - 16,
    size: 7,
    font,
    color: rgb(0, 0, 0),
  });
  state.page.drawText('E-mail: fogpotlastan@dent.semmelweis-univ.hu', {
    x: MARGIN,
    y: footerY - 24,
    size: 7,
    font,
    color: rgb(0, 0, 0),
  });
  const telText = 'Tel: 06-1 338-4380, 06-1 459-1500/59326';
  const telW = font.widthOfTextAtSize(telText, 7);
  state.page.drawText(telText, { x: 545 - telW, y: footerY - 8, size: 7, font, color: rgb(0, 0, 0) });
  const faxText = 'Fax: (06-1) 317-5270';
  const faxW = font.widthOfTextAtSize(faxText, 7);
  state.page.drawText(faxText, { x: 545 - faxW, y: footerY - 16, size: 7, font, color: rgb(0, 0, 0) });
  const webText = 'web: http://semmelweis-hu/fogpotlastan';
  const webW = font.widthOfTextAtSize(webText, 7);
  state.page.drawText(webText, { x: 545 - webW, y: footerY - 24, size: 7, font, color: rgb(0, 0, 0) });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

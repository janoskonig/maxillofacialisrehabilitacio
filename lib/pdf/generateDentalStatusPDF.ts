import { PDFDocument, rgb, PDFPage } from 'pdf-lib';
import { getDejaVuFont, getDejaVuBoldFont } from './fonts';
import {
  LAYOUT,
  TYPOGRAPHY,
  PDFState,
  moveDown,
  addPageIfNeeded,
  drawCenteredText,
  drawRightAlignedText,
  drawLeftAlignedText,
  drawHorizontalLine,
  drawFooter,
  HeaderConfig,
  FooterConfig,
  drawHeader,
} from './layout';

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

// Note: With DejaVu fonts, we no longer need toWinAnsiSafe for ő/ű characters
// However, we still need to handle special characters like ✓/✗ and normalize line breaks
function normalizeText(text: string): string {
  return String(text)
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\u2713/g, '+') // ✓ → +
    .replace(/\u2717/g, 'X'); // ✗ → X
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
  const font = await getDejaVuFont(pdf);
  const fontBold = await getDejaVuBoldFont(pdf);
  const state: PDFState = {
    page: pdf.addPage([LAYOUT.pageWidth, LAYOUT.pageHeight]),
    y: LAYOUT.pageHeight - LAYOUT.margin,
  };

  // Helper function for drawing text
  const draw = (text: string, size: number, bold: boolean, options?: { align?: 'left' | 'center' }) => {
    addPageIfNeeded(pdf, state);
    const normalized = normalizeText(text);
    const f = bold ? fontBold : font;
    
    if (options?.align === 'center') {
      drawCenteredText(state.page, normalized, state.y, size, f);
    } else {
      drawLeftAlignedText(state.page, normalized, state.y, size, f);
    }
    moveDown(state, size + TYPOGRAPHY.spacing.sm);
  };

  // Header with logos
  await drawHeader(pdf, state.page, state, {
    institutionName: ['SEMMELWEIS EGYETEM', 'Fogorvostudományi Kar', 'Fogpótlástani Klinika'],
    director: 'Igazgató: Prof. Dr. Hermann Péter',
    logo1Path: 'logo_1.png',
    logo2Path: 'logo_2.png',
    logoWidth: 60,
  }, font, fontBold);

  // Date (right-aligned)
  const currentDate = new Date().toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
  addPageIfNeeded(pdf, state);
  drawRightAlignedText(state.page, `Dátum: ${currentDate}`, state.y, TYPOGRAPHY.scale.small, font, LAYOUT.margin, rgb(0.4, 0.4, 0.4));
  moveDown(state, TYPOGRAPHY.scale.small + TYPOGRAPHY.spacing.lg);

  // Separator line
  addPageIfNeeded(pdf, state);
  drawHorizontalLine(state.page, state.y, LAYOUT.margin, LAYOUT.pageWidth - LAYOUT.margin);
  moveDown(state, TYPOGRAPHY.spacing.lg);

  // Patient data
  draw('PÁCIENS ADATOK', TYPOGRAPHY.scale.h3, true);
  draw(`Beteg neve: ${patient.nev || 'Név nélküli beteg'}`, TYPOGRAPHY.scale.body, false);
  if (patient.taj) draw(`TAJ szám: ${patient.taj}`, TYPOGRAPHY.scale.body, false);
  moveDown(state, TYPOGRAPHY.spacing.md);

  draw('FOGAZATI STÁTUSZ', TYPOGRAPHY.scale.h3, true);
  moveDown(state, TYPOGRAPHY.spacing.sm);

  const fogak = patient.meglevoFogak || {};
  const upperLeft = [18, 17, 16, 15, 14, 13, 12, 11];
  const upperRight = [21, 22, 23, 24, 25, 26, 27, 28];
  const lowerLeft = [48, 47, 46, 45, 44, 43, 42, 41];
  const lowerRight = [31, 32, 33, 34, 35, 36, 37, 38];

  const pageWidth = LAYOUT.pageWidth - 2 * LAYOUT.margin;
  const numTeethPerRow = 8;
  const spacing = 2;
  const gapBetweenSides = 10;
  const cellWidth = Math.floor((pageWidth - numTeethPerRow * spacing - gapBetweenSides) / (numTeethPerRow * 2));
  const cellHeight = 18;
  const startX = LAYOUT.margin;

  const drawRow = (teeth: number[]) => {
    let xPos = startX;
    for (const tooth of teeth) {
      addPageIfNeeded(pdf, state);
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
    addPageIfNeeded(pdf, state);
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
  moveDown(state, cellHeight + TYPOGRAPHY.spacing.sm);

  drawRow(lowerLeft);
  xPos = startX + (cellWidth + spacing) * 8 + gapBetweenSides;
  for (const tooth of lowerRight) {
    addPageIfNeeded(pdf, state);
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
  moveDown(state, cellHeight + TYPOGRAPHY.spacing.md);

  const legend = normalizeText(
    'Jelentés: + = Megvan (zöld), ? = Kérdéses (sárga), ! = Reménytelen (piros), X = Hiányzik (szürke)'
  );
  addPageIfNeeded(pdf, state);
  drawLeftAlignedText(state.page, legend, state.y, 8, font, LAYOUT.margin, rgb(0.4, 0.4, 0.4));
  moveDown(state, TYPOGRAPHY.spacing.lg);

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

  addPageIfNeeded(pdf, state);
  const dmftBoxHeight = 50;
  state.page.drawRectangle({
    x: LAYOUT.margin,
    y: state.y - dmftBoxHeight,
    width: LAYOUT.contentWidth,
    height: dmftBoxHeight,
    color: rgb(0.88, 0.95, 1),
    borderColor: rgb(0.58, 0.77, 0.99),
  });
  
  // Calculate positions using grid-based approach
  const col1X = LAYOUT.margin + 10;
  const col2X = LAYOUT.margin + 150;
  const col3X = LAYOUT.margin + 290;
  const col4X = LAYOUT.margin + 400;
  
  state.page.drawText('DMF-T INDEX', { x: col1X, y: state.y - 18, size: 11, font: fontBold, color: rgb(0, 0, 0) });
  state.page.drawText(`D (szuvas): ${dCount}`, { x: col1X, y: state.y - 35, size: 10, font, color: rgb(0.86, 0.15, 0.15) });
  state.page.drawText(`F (tömött): ${fCount}`, { x: col2X, y: state.y - 35, size: 10, font, color: rgb(0.15, 0.39, 0.92) });
  state.page.drawText(`M (hiányzik): ${mCount}`, { x: col3X, y: state.y - 35, size: 10, font, color: rgb(0.42, 0.45, 0.5) });
  state.page.drawText(`DMF-T összesen: ${dmft} / 32`, {
    x: col4X,
    y: state.y - 35,
    size: 10,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  moveDown(state, dmftBoxHeight + TYPOGRAPHY.spacing.sm);

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
    moveDown(state, TYPOGRAPHY.spacing.sm);
    draw('FELSÖ FOGAK', 11, true);
    for (const num of upperTeethWithData) {
      const n = normalizeToothData(fogak[num] as ToothStatus | undefined);
      const line = formatToothDetail(num, n);
      if (line) {
        addPageIfNeeded(pdf, state);
        drawLeftAlignedText(state.page, line, state.y, 10, font);
        moveDown(state, 10 + TYPOGRAPHY.spacing.xs);
      }
    }
    draw('Fábián- és Fejérdy-féle protetikai foghiányosztályozás:', 10, true);
    if (patient.fabianFejerdyProtetikaiOsztalyFelso) {
      addPageIfNeeded(pdf, state);
      drawLeftAlignedText(state.page, patient.fabianFejerdyProtetikaiOsztalyFelso, state.y, 10, font);
      moveDown(state, 10 + TYPOGRAPHY.spacing.xs);
    }
    moveDown(state, TYPOGRAPHY.spacing.sm);
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
        addPageIfNeeded(pdf, state);
        drawLeftAlignedText(state.page, line, state.y, 10, font);
        moveDown(state, 10 + TYPOGRAPHY.spacing.xs);
      }
    }
    draw('Fábián- és Fejérdy-féle protetikai foghiányosztályozás:', 10, true);
    if (patient.fabianFejerdyProtetikaiOsztalyAlso) {
      addPageIfNeeded(pdf, state);
      drawLeftAlignedText(state.page, patient.fabianFejerdyProtetikaiOsztalyAlso, state.y, 10, font);
      moveDown(state, 10 + TYPOGRAPHY.spacing.xs);
    }
    moveDown(state, TYPOGRAPHY.spacing.sm);
  }

  if (
    (patient.meglevoImplantatumok && Object.keys(patient.meglevoImplantatumok).length > 0) ||
    patient.nemIsmertPoziciokbanImplantatum
  ) {
    moveDown(state, TYPOGRAPHY.spacing.md);
    draw('IMPLANTATUMOK', 11, true);
    if (patient.meglevoImplantatumok && Object.keys(patient.meglevoImplantatumok).length > 0) {
      for (const num of Object.keys(patient.meglevoImplantatumok).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))) {
        addPageIfNeeded(pdf, state);
        drawLeftAlignedText(state.page, `${num}. fog: ${patient.meglevoImplantatumok[num]}`, state.y, 10, font);
        moveDown(state, 10 + TYPOGRAPHY.spacing.xs);
      }
    }
    if (patient.nemIsmertPoziciokbanImplantatum) {
      draw('Nem ismert pozíciókban implantátum', 10, true);
      if (patient.nemIsmertPoziciokbanImplantatumRészletek) {
        addPageIfNeeded(pdf, state);
        drawLeftAlignedText(state.page, patient.nemIsmertPoziciokbanImplantatumRészletek, state.y, 9, font, LAYOUT.margin + 10, rgb(0.29, 0.34, 0.39));
        moveDown(state, 9 + TYPOGRAPHY.spacing.sm);
      }
    }
  }

  // Footer
  const footerY = Math.max(state.y - 20, LAYOUT.margin + 40);
  drawFooter(state.page, footerY, {
    address: 'Cím: 1088 Budapest, Szentkirályi utca 47.',
    postalAddress: 'Postacím: 1085 Budapest, Üllői út 26.; 1428 Budapest Pf. 2.',
    email: 'E-mail: fogpotlastan@dent.semmelweis-univ.hu',
    phone: 'Tel: 06-1 338-4380, 06-1 459-1500/59326',
    fax: 'Fax: (06-1) 317-5270',
    website: 'web: http://semmelweis-hu/fogpotlastan',
  }, TYPOGRAPHY.scale.tiny, font);

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

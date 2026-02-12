import { PDFDocument, rgb } from 'pdf-lib';
import { Patient, LabQuoteRequest } from '@/lib/types';
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
  drawMultilineText,
  drawHeader,
  HeaderConfig,
} from './layout';

// Note: With DejaVu fonts, we no longer need character replacement for ő/ű
// But we still normalize line breaks
function normalizeText(text: string): string {
  return String(text)
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ');
}

/**
 * Árajánlatkérő PDF generálása beteg adataiból
 */
export async function generateLabQuoteRequestPDF(
  patient: Patient,
  quoteRequest: LabQuoteRequest
): Promise<Buffer> {
  // Új PDF dokumentum létrehozása
  const pdfDoc = await PDFDocument.create();
  const font = await getDejaVuFont(pdfDoc);
  const boldFont = await getDejaVuBoldFont(pdfDoc);
  
  const state: PDFState = {
    page: pdfDoc.addPage([LAYOUT.pageWidth, LAYOUT.pageHeight]),
    y: LAYOUT.pageHeight - LAYOUT.margin,
  };

  // Header with logos
  await drawHeader(pdfDoc, state.page, state, {
    institutionName: ['SEMMELWEIS EGYETEM', 'Fogorvostudományi Kar', 'Fogpótlástani Klinika'],
    director: 'Igazgató: Prof. Dr. Hermann Péter',
    logo1Path: 'logo_1.png',
    logo2Path: 'logo_2.png',
    logoWidth: 60,
  }, font, boldFont);

  // Date (right-aligned)
  const currentDate = new Date().toLocaleDateString('hu-HU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  addPageIfNeeded(pdfDoc, state);
  drawRightAlignedText(
    state.page,
    `Dátum: ${currentDate}`,
    state.y,
    TYPOGRAPHY.scale.small,
    font,
    LAYOUT.margin,
    rgb(0.4, 0.4, 0.4)
  );
  moveDown(state, TYPOGRAPHY.scale.small + TYPOGRAPHY.spacing.md);

  // Title
  addPageIfNeeded(pdfDoc, state);
  drawCenteredText(state.page, 'Árajánlatkérő', state.y, 20, boldFont);
  moveDown(state, 20 + TYPOGRAPHY.spacing.lg);

  // Patient data
  addPageIfNeeded(pdfDoc, state);
  drawLeftAlignedText(state.page, patient.nev || '', state.y, TYPOGRAPHY.scale.h3, boldFont);
  moveDown(state, TYPOGRAPHY.scale.h3 + TYPOGRAPHY.spacing.xs);

  // Address formatting: Street, City, Postal code on separate lines
  if (patient.cim) {
    addPageIfNeeded(pdfDoc, state);
    drawLeftAlignedText(state.page, patient.cim, state.y, TYPOGRAPHY.scale.h3, font);
    moveDown(state, TYPOGRAPHY.scale.h3 + TYPOGRAPHY.spacing.xs);
  }
  if (patient.varos) {
    addPageIfNeeded(pdfDoc, state);
    drawLeftAlignedText(state.page, patient.varos, state.y, TYPOGRAPHY.scale.h3, font);
    moveDown(state, TYPOGRAPHY.scale.h3 + TYPOGRAPHY.spacing.xs);
  }
  if (patient.iranyitoszam) {
    addPageIfNeeded(pdfDoc, state);
    drawLeftAlignedText(state.page, patient.iranyitoszam, state.y, TYPOGRAPHY.scale.h3, font);
    moveDown(state, TYPOGRAPHY.scale.h3 + TYPOGRAPHY.spacing.xs);
  }

  moveDown(state, TYPOGRAPHY.spacing.sm);
  addPageIfNeeded(pdfDoc, state);
  drawLeftAlignedText(state.page, 'részére', state.y, TYPOGRAPHY.scale.h3, font);
  moveDown(state, TYPOGRAPHY.spacing.lg);

  // Greeting
  addPageIfNeeded(pdfDoc, state);
  drawLeftAlignedText(state.page, 'Tisztelt Laboratórium!', state.y, TYPOGRAPHY.scale.h3, font);
  moveDown(state, TYPOGRAPHY.spacing.lg);

  // Text
  addPageIfNeeded(pdfDoc, state);
  drawLeftAlignedText(
    state.page,
    'Fent nevezett részére szeretnénk kérni árajánlatot a következőkre:',
    state.y,
    TYPOGRAPHY.scale.h3,
    font
  );
  moveDown(state, TYPOGRAPHY.spacing.lg);

  // Quote request text
  if (quoteRequest.szoveg) {
    addPageIfNeeded(pdfDoc, state);
    const normalizedText = normalizeText(quoteRequest.szoveg);
    state.y = drawMultilineText(
      state.page,
      normalizedText,
      state.y,
      TYPOGRAPHY.scale.h3,
      font,
      LAYOUT.contentWidth
    );
    moveDown(state, TYPOGRAPHY.spacing.sm);
  }

  // Quote request date
  if (quoteRequest.datuma) {
    const date = new Date(quoteRequest.datuma);
    const formattedDate = date.toLocaleDateString('hu-HU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    addPageIfNeeded(pdfDoc, state);
    drawLeftAlignedText(state.page, `Határidő: ${formattedDate}`, state.y, TYPOGRAPHY.scale.h3, font);
    moveDown(state, TYPOGRAPHY.spacing.lg);
  }

  // Closing
  addPageIfNeeded(pdfDoc, state);
  drawLeftAlignedText(state.page, 'Üdvözlettel:', state.y, TYPOGRAPHY.scale.h3, font);
  moveDown(state, TYPOGRAPHY.spacing.sm);
  addPageIfNeeded(pdfDoc, state);
  drawLeftAlignedText(state.page, patient.kezeleoorvos || '', state.y, TYPOGRAPHY.scale.h3, boldFont);
  moveDown(state, TYPOGRAPHY.spacing.xl);

  // Signature line (right-aligned)
  const budapestDate = 'Budapest, ' + new Date().toLocaleDateString('hu-HU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  addPageIfNeeded(pdfDoc, state);
  drawRightAlignedText(state.page, budapestDate, state.y, TYPOGRAPHY.scale.h3, font);

  // PDF generálása
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

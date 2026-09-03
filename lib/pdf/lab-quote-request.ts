import { PDFDocument, PDFFont, Color, rgb } from 'pdf-lib';
import { Patient, LabQuoteRequest } from '@/lib/types';
import { getDejaVuFont, getDejaVuBoldFont } from './fonts';
import { CLINIC_FOOTER } from './clinic-contact';
import {
  LAYOUT,
  TYPOGRAPHY,
  PDFState,
  drawText,
  drawCenteredText,
  drawRightAlignedText,
  drawHeader,
  drawHorizontalLine,
  drawFooter,
  getRightAlignedX,
  wrapTextLines,
} from './layout';

/**
 * Árajánlatkérő PDF — hivatalos levél a fogtechnikai laboratórium felé.
 *
 * Felépítés: intézményi fejléc → kelt + cím → adatblokk (beteg, lakcím,
 * kezelőorvos, határidő) → megszólítás és bevezető → a kért munkák szövege
 * (a beírt sortörések és bekezdések megtartva, oldaltöréssel) → határidő-mondat
 * → aláírásblokk → a klinika elérhetőségei a láblécben minden oldalon
 * (több oldalnál oldalszámmal).
 */

const COLORS = {
  text: rgb(0.12, 0.12, 0.14),
  muted: rgb(0.42, 0.45, 0.5),
  rule: rgb(0.78, 0.8, 0.83),
  boxFill: rgb(0.965, 0.968, 0.975),
  boxBorder: rgb(0.85, 0.86, 0.88),
} as const;

const BODY_SIZE = TYPOGRAPHY.scale.body; // 11 pt
const BODY_LINE = 16; // ~1.45-ös sorköz
const PARAGRAPH_GAP = 6;
const LABEL_SIZE = 9.5;
const TITLE_SIZE = 20;
const SIGNATURE_GAP = 40; // hely a kézi aláírásnak
const FOOTER_RULE_Y = LAYOUT.margin + 44;
/** Eddig érhet le a törzs; alatta a lábléc és egy kis levegő. */
const BOTTOM_LIMIT = FOOTER_RULE_Y + 28;

interface Writer {
  doc: PDFDocument;
  state: PDFState;
  font: PDFFont;
  bold: PDFFont;
  continuationTitle: string;
}

interface InfoRow {
  label: string;
  value: string;
  bold?: boolean;
}

// Keep user-entered line breaks, only normalize CRLF/CR variants.
function normalizeText(text: string): string {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function formatHuDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** „2026. szeptember 20." → „2026. szeptember 20-ig" */
function untilSuffix(formatted: string): string {
  return `${formatted.replace(/\.$/, '')}-ig`;
}

/** „1085 Budapest, Üllői út 26." — a hiányzó részeket kihagyja. */
function formatAddress(patient: Patient): string | null {
  const cityLine = [patient.iranyitoszam, patient.varos]
    .map((part) => (part ?? '').toString().trim())
    .filter(Boolean)
    .join(' ');
  const street = (patient.cim ?? '').toString().trim();
  const parts = [cityLine, street].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

function newPage(w: Writer): void {
  w.state.page = w.doc.addPage([LAYOUT.pageWidth, LAYOUT.pageHeight]);
  w.state.y = LAYOUT.pageHeight - LAYOUT.margin;

  // Folytatólagos oldal: halvány futófejléc, hogy a lap önmagában is azonosítható legyen.
  drawText(w.state.page, w.continuationTitle, {
    x: LAYOUT.margin,
    y: w.state.y,
    fontSize: TYPOGRAPHY.scale.small,
    font: w.font,
    color: COLORS.muted,
  });
  w.state.y -= TYPOGRAPHY.scale.small + 6;
  drawHorizontalLine(w.state.page, w.state.y, LAYOUT.margin, LAYOUT.pageWidth - LAYOUT.margin, 0.5, COLORS.rule);
  w.state.y -= TYPOGRAPHY.spacing.lg;
}

function ensureSpace(w: Writer, needed: number): void {
  if (w.state.y - needed >= BOTTOM_LIMIT) return;
  newPage(w);
}

function line(
  w: Writer,
  text: string,
  opts: { size?: number; bold?: boolean; color?: Color; x?: number; advance?: number } = {}
): void {
  const size = opts.size ?? BODY_SIZE;
  ensureSpace(w, size);
  drawText(w.state.page, text, {
    x: opts.x ?? LAYOUT.margin,
    y: w.state.y,
    fontSize: size,
    font: opts.bold ? w.bold : w.font,
    color: opts.color ?? COLORS.text,
  });
  w.state.y -= opts.advance ?? BODY_LINE;
}

/**
 * Bekezdések rajzolása: a beírt sortörések megmaradnak, az üres sor bekezdésköz,
 * a hosszú sorok a margóra tördelődnek, és a szöveg oldaltörésnél folytatódik.
 */
function paragraphs(w: Writer, text: string): void {
  let hasContent = false;
  let pendingGap = false;

  for (const raw of normalizeText(text).split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) {
      pendingGap = hasContent;
      continue;
    }
    if (pendingGap) {
      w.state.y -= PARAGRAPH_GAP;
      pendingGap = false;
    }
    for (const wrapped of wrapTextLines(trimmed, w.font, BODY_SIZE, LAYOUT.contentWidth)) {
      line(w, wrapped);
    }
    hasContent = true;
  }
}

/** Halvány keretes adatblokk: címke (szürke) + érték, az értékek tördelve. */
function infoBox(w: Writer, rows: InfoRow[]): void {
  const pad = 11;
  const labelWidth = 150;
  const rowLine = 15;
  const rowGap = 3;
  const valueWidth = LAYOUT.contentWidth - pad * 2 - labelWidth;

  const measured = rows.map((row) => ({
    ...row,
    lines: wrapTextLines(row.value, row.bold ? w.bold : w.font, BODY_SIZE, valueWidth),
  }));
  const rowsHeight =
    measured.reduce((sum, row) => sum + row.lines.length * rowLine, 0) +
    rowGap * Math.max(0, measured.length - 1);
  const boxHeight = pad * 2 + rowsHeight;

  ensureSpace(w, boxHeight);
  const top = w.state.y;
  w.state.page.drawRectangle({
    x: LAYOUT.margin,
    y: top - boxHeight,
    width: LAYOUT.contentWidth,
    height: boxHeight,
    color: COLORS.boxFill,
    borderColor: COLORS.boxBorder,
    borderWidth: 0.75,
  });

  let y = top - pad;
  for (const row of measured) {
    // A kisebb címke alapvonala essen egybe az érték alapvonalával.
    drawText(w.state.page, row.label, {
      x: LAYOUT.margin + pad,
      y: y - (BODY_SIZE - LABEL_SIZE),
      fontSize: LABEL_SIZE,
      font: w.font,
      color: COLORS.muted,
    });
    row.lines.forEach((valueLine, index) => {
      drawText(w.state.page, valueLine, {
        x: LAYOUT.margin + pad + labelWidth,
        y: y - index * rowLine,
        fontSize: BODY_SIZE,
        font: row.bold ? w.bold : w.font,
        color: COLORS.text,
      });
    });
    y -= row.lines.length * rowLine + rowGap;
  }

  w.state.y = top - boxHeight;
}

/** Aláírásblokk a jobb oldalon, egyben tartva (nem törik két oldalra). */
function signatureBlock(w: Writer, doctorName: string): void {
  const blockWidth = 230;
  const x = LAYOUT.pageWidth - LAYOUT.margin - blockWidth;
  const blockHeight = BODY_SIZE + SIGNATURE_GAP + BODY_SIZE + 4 + TYPOGRAPHY.scale.small;

  ensureSpace(w, blockHeight);
  line(w, 'Üdvözlettel:', { x, advance: BODY_SIZE + SIGNATURE_GAP });
  line(w, doctorName, { x, bold: true, advance: BODY_SIZE + 4 });
  line(w, 'Semmelweis Egyetem, Fogpótlástani Klinika', {
    x,
    size: TYPOGRAPHY.scale.small,
    color: COLORS.muted,
    advance: TYPOGRAPHY.scale.small,
  });
}

/** Lábléc minden oldalra: elérhetőségek + oldalszám (ha több oldal van). */
function drawFooters(doc: PDFDocument, font: PDFFont): void {
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    drawFooter(page, FOOTER_RULE_Y, CLINIC_FOOTER, TYPOGRAPHY.scale.tiny, font);
    if (pages.length > 1) {
      const label = `${index + 1}. oldal / ${pages.length}`;
      const size = TYPOGRAPHY.scale.small;
      drawText(page, label, {
        x: getRightAlignedX(label, size, font),
        y: FOOTER_RULE_Y + size + 4,
        fontSize: size,
        font,
        color: COLORS.muted,
      });
    }
  });
}

/**
 * Árajánlatkérő PDF generálása beteg adataiból
 */
export async function generateLabQuoteRequestPDF(
  patient: Patient,
  quoteRequest: LabQuoteRequest,
  senderDoctorName?: string | null
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await getDejaVuFont(doc);
  const bold = await getDejaVuBoldFont(doc);

  const patientName = (patient.nev ?? '').toString().trim() || '—';
  const doctorName = (senderDoctorName || patient.kezeleoorvos || '').toString().trim() || 'König János';
  const address = formatAddress(patient);
  const deadline = formatHuDate(quoteRequest.datuma);
  const today = formatHuDate(new Date()) ?? '';

  const w: Writer = {
    doc,
    font,
    bold,
    continuationTitle: `Árajánlatkérő – ${patientName} (folytatás)`,
    state: {
      page: doc.addPage([LAYOUT.pageWidth, LAYOUT.pageHeight]),
      y: LAYOUT.pageHeight - LAYOUT.margin,
    },
  };

  // Intézményi fejléc (logók + klinika), alatta vékony elválasztó
  await drawHeader(
    doc,
    w.state.page,
    w.state,
    {
      institutionName: ['SEMMELWEIS EGYETEM', 'Fogorvostudományi Kar', 'Fogpótlástani Klinika'],
      director: 'Igazgató: Prof. Dr. Hermann Péter',
      logo1Path: 'logo_1.png',
      logo2Path: 'logo_2.png',
      logoWidth: 54,
    },
    font,
    bold
  );
  drawHorizontalLine(w.state.page, w.state.y, LAYOUT.margin, LAYOUT.pageWidth - LAYOUT.margin, 0.75, COLORS.rule);
  w.state.y -= TYPOGRAPHY.spacing.lg;

  // Kelt (jobbra, halványan)
  drawRightAlignedText(
    w.state.page,
    `Budapest, ${today}`,
    w.state.y,
    TYPOGRAPHY.scale.small,
    font,
    LAYOUT.margin,
    COLORS.muted
  );
  w.state.y -= TYPOGRAPHY.scale.small + TYPOGRAPHY.spacing.md;

  // Cím
  drawCenteredText(w.state.page, 'Árajánlatkérő', w.state.y, TITLE_SIZE, bold, COLORS.text);
  w.state.y -= TITLE_SIZE + TYPOGRAPHY.spacing.lg;

  // Adatblokk
  const rows: InfoRow[] = [
    { label: 'Beteg neve', value: patientName, bold: true },
    ...(address ? [{ label: 'Lakcím', value: address }] : []),
    { label: 'Kezelőorvos', value: doctorName },
    ...(deadline ? [{ label: 'Ajánlat határideje', value: deadline, bold: true }] : []),
  ];
  infoBox(w, rows);
  w.state.y -= TYPOGRAPHY.spacing.xl;

  // Megszólítás, bevezető
  line(w, 'Tisztelt Laboratórium!', { advance: BODY_LINE + PARAGRAPH_GAP });
  paragraphs(w, 'Fent nevezett betegünk részére az alábbi fogtechnikai munkákra kérünk árajánlatot:');
  w.state.y -= PARAGRAPH_GAP;

  // A kért munkák
  const requestText = (quoteRequest.szoveg ?? '').toString();
  if (requestText.trim()) {
    paragraphs(w, requestText);
  } else {
    line(w, '(A kért munkák leírása nem került megadásra.)', { color: COLORS.muted });
  }

  // Határidő
  if (deadline) {
    w.state.y -= PARAGRAPH_GAP;
    paragraphs(w, `Kérjük, hogy ajánlatukat legkésőbb ${untilSuffix(deadline)} szíveskedjenek megküldeni.`);
  }

  // Aláírás
  w.state.y -= TYPOGRAPHY.spacing.lg;
  signatureBlock(w, doctorName);

  // Lábléc minden oldalra
  drawFooters(doc, font);

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

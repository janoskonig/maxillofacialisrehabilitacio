/**
 * Markdown → PDF konverzió modul (pdf-lib, Chromium/Puppeteer nélkül)
 */

import { marked } from 'marked';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** HTML → egyszerű szöveg (sorok listája) */
function htmlToPlainLines(html: string): string[] {
  const withNewlines = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '\t')
    .replace(/<\/th>/gi, '\t');
  const stripped = withNewlines.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  return stripped.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Markdown → HTML (marked), majd HTML → szövegsorok */
async function markdownToPlainLines(markdown: string): Promise<string[]> {
  let html: string;
  try {
    if (typeof marked.parse === 'function') {
      html = await marked.parse(markdown, { breaks: true, gfm: true });
    } else if (typeof marked === 'function') {
      html = await marked(markdown, { breaks: true, gfm: true });
    } else {
      const { marked: markedDefault } = await import('marked');
      html = await markedDefault(markdown, { breaks: true, gfm: true });
    }
  } catch {
    html = `<pre>${markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
  }
  return htmlToPlainLines(html);
}

/** ő/ű → ö/ü (Helvetica WinAnsi fallback) */
function replaceLongAccents(text: string): string {
  return text
    .replace(/ő/g, 'ö')
    .replace(/Ő/g, 'Ö')
    .replace(/ű/g, 'ü')
    .replace(/Ű/g, 'Ü');
}

function replaceAllAccentedChars(text: string): string {
  const replacements: Record<string, string> = {
    'á': 'a', 'Á': 'A', 'é': 'e', 'É': 'E', 'í': 'i', 'Í': 'I',
    'ó': 'o', 'Ó': 'O', 'ö': 'o', 'Ö': 'O', 'ő': 'o', 'Ő': 'O',
    'ú': 'u', 'Ú': 'U', 'ü': 'u', 'Ü': 'U', 'ű': 'u', 'Ű': 'U',
  };
  return text.replace(/[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/g, (c) => replacements[c] ?? c);
}

function safeTextForPdf(text: string): string {
  try {
    // pdf-lib StandardFonts WinAnsi: próbáljuk ő/ű nélkül
    return replaceLongAccents(text);
  } catch {
    return replaceAllAccentedChars(text);
  }
}

/**
 * Markdown → PDF konverzió pdf-lib-bal (böngésző/Chromium nélkül)
 */
export async function markdownToPDF(
  markdown: string,
  title?: string,
  options?: {
    format?: 'A4' | 'Letter';
    margin?: { top?: number; right?: number; bottom?: number; left?: number };
  }
): Promise<Buffer> {
  const lines = await markdownToPlainLines(markdown);
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 11;
  const lineHeight = fontSize * 1.35;
  const marginTop = options?.margin?.top ?? 56;
  const marginBottom = options?.margin?.bottom ?? 56;
  const marginLeft = options?.margin?.left ?? 42;
  const marginRight = options?.margin?.right ?? 42;
  const pageWidth = options?.format === 'Letter' ? 612 : 595.28;
  const pageHeight = options?.format === 'Letter' ? 792 : 841.89;
  const maxTextWidth = pageWidth - marginLeft - marginRight;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - marginTop;

  function drawLine(text: string): void {
    const safe = safeTextForPdf(text);
    const width = font.widthOfTextAtSize(safe, fontSize);
    if (width <= maxTextWidth) {
      if (y < marginBottom) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - marginTop;
      }
      page.drawText(safe, {
        x: marginLeft,
        y,
        size: fontSize,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= lineHeight;
      return;
    }
    const words = safe.split(/\s+/);
    let currentLine = '';
    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxTextWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) {
          if (y < marginBottom) {
            page = pdfDoc.addPage([pageWidth, pageHeight]);
            y = pageHeight - marginTop;
          }
          page.drawText(currentLine, {
            x: marginLeft,
            y,
            size: fontSize,
            font,
            color: rgb(0.1, 0.1, 0.1),
          });
          y -= lineHeight;
        }
        currentLine = word;
      }
    }
    if (currentLine) {
      if (y < marginBottom) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - marginTop;
      }
      page.drawText(currentLine, {
        x: marginLeft,
        y,
        size: fontSize,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= lineHeight;
    }
  }

  for (const line of lines) {
    drawLine(line);
  }

  const footer = `Export dátuma: ${new Date().toLocaleString('hu-HU')}`;
  const footerSafe = safeTextForPdf(footer);
  const lastPage = pdfDoc.getPages()[pdfDoc.getPageCount() - 1];
  lastPage.drawText(footerSafe, {
    x: marginLeft,
    y: marginBottom - lineHeight,
    size: 9,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Beteg összefoglaló markdown generálása
 */
export function generatePatientSummaryMarkdown(
  patient: {
    nev?: string | null;
    taj?: string | null;
    diagnozis?: string | null;
    mutetIdeje?: string | null;
  },
  documents: any[],
  checklistStatus: {
    missingFields: any[];
    missingDocs: any[];
  },
  requiredDocRules?: Array<{ label: string; tag: string; minCount: number }>
): string {
  const lines: string[] = [];
  lines.push('# NEAK Export - Beteg Összefoglaló\n');
  lines.push('## Beteg Azonosítók\n');
  if (patient.nev) lines.push(`**Név:** ${patient.nev}`);
  if (patient.taj) lines.push(`**TAJ:** ${patient.taj}`);
  lines.push('');
  if (patient.diagnozis) lines.push(`**Diagnózis:** ${patient.diagnozis}`);
  if (patient.mutetIdeje) lines.push(`**Műtét ideje:** ${patient.mutetIdeje}`);
  lines.push('');
  lines.push('## Checklist Összefoglaló\n');
  const fieldsStatus = checklistStatus.missingFields.length === 0 ? '✓ Minden megvan' : `✗ ${checklistStatus.missingFields.length} hiányzik`;
  lines.push(`**Kötelező mezők:** ${fieldsStatus}`);
  lines.push('');
  const docsStatus = checklistStatus.missingDocs.length === 0 ? '✓ Minden megvan' : `✗ ${checklistStatus.missingDocs.length} hiányzik`;
  lines.push(`**Kötelező dokumentumok:** ${docsStatus}`);
  lines.push('');
  if (requiredDocRules && requiredDocRules.length > 0) {
    lines.push('### Kötelező dokumentumok részletei\n');
    requiredDocRules.forEach((rule) => {
      const docCount = documents.filter((doc) =>
        (doc.tags || []).some((t: string) => t.toLowerCase() === rule.tag.toLowerCase())
      ).length;
      const isComplete = docCount >= rule.minCount;
      const status = isComplete ? '✓' : '✗';
      lines.push(`- ${status} **${rule.label}:** ${docCount} / ${rule.minCount} db`);
    });
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Anamnézis összefoglaló markdown generálása
 */
export function generateMedicalHistoryMarkdown(
  patient: {
    nev?: string | null;
    taj?: string | null;
  },
  anamnesisSummary: string
): string {
  const lines: string[] = [];
  lines.push('# NEAK Export - Kórtörténet\n');
  lines.push('## Beteg Azonosítók\n');
  if (patient.nev) lines.push(`**Név:** ${patient.nev}`);
  if (patient.taj) lines.push(`**TAJ:** ${patient.taj}`);
  lines.push('');
  lines.push('## Anamnézis Összefoglaló\n');
  lines.push(anamnesisSummary);
  lines.push('');
  return lines.join('\n');
}

import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * Minimal single-page PDF with a short message (e.g. for failed generation placeholder).
 */
export async function createPlaceholderPdf(message: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const size = 12;
  const margin = 72;
  page.drawText(message, {
    x: margin,
    y: 841.89 - margin - size,
    size,
    font,
  });
  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

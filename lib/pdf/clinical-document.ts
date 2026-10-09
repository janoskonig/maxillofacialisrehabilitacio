import { PDFDocument, PDFFont, rgb } from 'pdf-lib';
import type { Patient } from '@/lib/types';
import { getDejaVuFont, getDejaVuBoldFont } from './fonts';
import { LAYOUT, PDFState, drawText, drawHeader, drawHorizontalLine, drawFooter, wrapTextLines } from './layout';
import { CLINIC_FOOTER } from './clinic-contact';

/** Page-aware, wrapping writer shared by NEAK clinical attachments. */
export class ClinicalDocument {
  state: PDFState;
  private readonly bottom = LAYOUT.margin + 80;

  private constructor(
    readonly pdf: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
    private readonly title: string,
    private readonly identity: string,
  ) {
    this.state = { page: pdf.addPage([LAYOUT.pageWidth, LAYOUT.pageHeight]), y: LAYOUT.pageHeight - LAYOUT.margin };
  }

  static async create(title: string, patient: Partial<Patient>) {
    const pdf = await PDFDocument.create();
    pdf.setTitle(title);
    const doc = new ClinicalDocument(pdf, await getDejaVuFont(pdf), await getDejaVuBoldFont(pdf), title,
      `${patient.nev || 'Név nélküli beteg'} | TAJ: ${patient.taj || 'nincs adat'}`.slice(0, 180));
    await drawHeader(pdf, doc.state.page, doc.state, {
      institutionName: ['SEMMELWEIS EGYETEM', 'Fogorvostudományi Kar', 'Fogpótlástani Klinika'],
      logo1Path: 'logo_1.png', logo2Path: 'logo_2.png', logoWidth: 45,
    }, doc.font, doc.bold);
    doc.gap(8);
    doc.text(title.toUpperCase(), 17, true);
    doc.text(`Beteg neve: ${patient.nev || 'Nincs név'}`, 11, true);
    doc.text(`TAJ: ${patient.taj || 'Nincs adat'}`, 10);
    const date = new Date().toLocaleDateString('hu-HU', { timeZone: 'Europe/Budapest' });
    doc.text(`Export kelte: ${date}`, 9);
    doc.gap(8);
    return doc;
  }

  ensureSpace(height: number) {
    if (this.state.y - height >= this.bottom) return;
    this.state.page = this.pdf.addPage([LAYOUT.pageWidth, LAYOUT.pageHeight]);
    this.state.y = LAYOUT.pageHeight - LAYOUT.margin;
    this.text(this.title, 10, true);
    this.text(this.identity, 9);
    drawHorizontalLine(this.state.page, this.state.y, LAYOUT.margin, LAYOUT.pageWidth - LAYOUT.margin, 0.5, rgb(0.75, 0.78, 0.8));
    this.gap(14);
  }

  gap(height = 6) { this.state.y -= height; }

  text(value: string, size = 10, bold = false) {
    const font = bold ? this.bold : this.font;
    for (const paragraph of String(value).replace(/\r\n?/g, '\n').split('\n')) {
      if (!paragraph.trim()) { this.gap(size * 0.6); continue; }
      for (const line of wrapTextLines(paragraph, font, size, LAYOUT.contentWidth)) {
        this.ensureSpace(size * 1.4);
        drawText(this.state.page, line, { x: LAYOUT.margin, y: this.state.y, fontSize: size, font, color: rgb(0.12, 0.16, 0.2) });
        this.gap(size * 1.4);
      }
    }
  }

  heading(title: string) {
    this.ensureSpace(48);
    this.gap(8);
    this.text(title, 11, true);
    this.gap(4);
  }

  async finish(): Promise<Buffer> {
    const pages = this.pdf.getPages();
    pages.forEach((page, i) => {
      drawFooter(page, LAYOUT.margin + 45, CLINIC_FOOTER, 7, this.font);
      drawText(page, `${i + 1} / ${pages.length}`, {
        x: LAYOUT.pageWidth - LAYOUT.margin - 35, y: 40, fontSize: 8, font: this.font,
      });
    });
    return Buffer.from(await this.pdf.save());
  }
}

import { PDFDocument, PDFPage, PDFFont, rgb, Color } from 'pdf-lib';
import { getDejaVuFont, getDejaVuBoldFont } from './fonts';
import {
  TYPOGRAPHY,
  LAYOUT,
  PDFState,
  moveDown,
  addLineSpacing,
  drawCenteredText,
  drawRightAlignedText,
  drawLeftAlignedText,
  drawMultilineText,
  drawHorizontalLine,
  drawSignatureLine,
  drawTableRow,
  calculateColumnWidths,
  addPageIfNeeded,
  HeaderConfig,
  FooterConfig,
  drawHeader,
  drawFooter,
} from './layout';

/**
 * High-level API for building PDF documents
 */
export class PDFDocumentBuilder {
  private pdfDoc!: PDFDocument; // Set in initialize()
  private state: PDFState;
  private font: PDFFont | null = null;
  private fontBold: PDFFont | null = null;

  constructor() {
    this.state = {
      page: null as any, // Will be set in initialize()
      y: 0,
    };
  }

  /**
   * Initializes the document with fonts and first page
   */
  async initialize(): Promise<void> {
    this.pdfDoc = await PDFDocument.create();
    this.font = await getDejaVuFont(this.pdfDoc);
    this.fontBold = await getDejaVuBoldFont(this.pdfDoc);
    this.state.page = this.pdfDoc.addPage([LAYOUT.pageWidth, LAYOUT.pageHeight]);
    this.state.y = LAYOUT.pageHeight - LAYOUT.margin;
  }

  /**
   * Gets the current font
   */
  private getFont(bold: boolean = false): PDFFont {
    if (!this.font || !this.fontBold) {
      throw new Error('Document not initialized. Call initialize() first.');
    }
    return bold ? this.fontBold : this.font;
  }

  /**
   * Adds a header block
   */
  async addHeader(config: HeaderConfig): Promise<void> {
    await drawHeader(this.pdfDoc, this.state.page, this.state, config);
  }

  /**
   * Adds a title (centered, large)
   */
  addTitle(text: string, fontSize: number = TYPOGRAPHY.scale.h1): void {
    addPageIfNeeded(this.pdfDoc, this.state);
    drawCenteredText(this.state.page, text, this.state.y, fontSize, this.getFont(true));
    moveDown(this.state, fontSize + TYPOGRAPHY.spacing.md);
  }

  /**
   * Adds a subtitle (centered, medium)
   */
  addSubtitle(text: string, fontSize: number = TYPOGRAPHY.scale.h2): void {
    addPageIfNeeded(this.pdfDoc, this.state);
    drawCenteredText(this.state.page, text, this.state.y, fontSize, this.getFont());
    moveDown(this.state, fontSize + TYPOGRAPHY.spacing.sm);
  }

  /**
   * Adds a heading (left-aligned, medium)
   */
  addHeading(text: string, fontSize: number = TYPOGRAPHY.scale.h3): void {
    addPageIfNeeded(this.pdfDoc, this.state);
    drawLeftAlignedText(this.state.page, text, this.state.y, fontSize, this.getFont(true));
    moveDown(this.state, fontSize + TYPOGRAPHY.spacing.sm);
  }

  /**
   * Adds body text (left-aligned)
   */
  addText(text: string, fontSize: number = TYPOGRAPHY.scale.body, bold: boolean = false): void {
    addPageIfNeeded(this.pdfDoc, this.state);
    drawLeftAlignedText(this.state.page, text, this.state.y, fontSize, this.getFont(bold));
    addLineSpacing(this.state, fontSize);
  }

  /**
   * Adds multiline text with automatic wrapping
   */
  addMultilineText(
    text: string,
    fontSize: number = TYPOGRAPHY.scale.body,
    maxWidth?: number
  ): void {
    addPageIfNeeded(this.pdfDoc, this.state);
    const maxW = maxWidth || LAYOUT.contentWidth;
    this.state.y = drawMultilineText(
      this.state.page,
      text,
      this.state.y,
      fontSize,
      this.getFont(),
      maxW
    );
  }

  /**
   * Adds a date (right-aligned, small)
   */
  addDate(date: Date | string, fontSize: number = TYPOGRAPHY.scale.small): void {
    addPageIfNeeded(this.pdfDoc, this.state);
    const dateStr = typeof date === 'string' ? date : date.toLocaleDateString('hu-HU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    drawRightAlignedText(
      this.state.page,
      `Dátum: ${dateStr}`,
      this.state.y,
      fontSize,
      this.getFont(),
      LAYOUT.margin,
      rgb(0.4, 0.4, 0.4)
    );
    moveDown(this.state, fontSize + TYPOGRAPHY.spacing.md);
  }

  /**
   * Adds a horizontal separator line
   */
  addSeparator(thickness: number = 1, color: Color = rgb(0, 0, 0)): void {
    addPageIfNeeded(this.pdfDoc, this.state);
    drawHorizontalLine(this.state.page, this.state.y, LAYOUT.margin, LAYOUT.pageWidth - LAYOUT.margin, thickness, color);
    moveDown(this.state, TYPOGRAPHY.spacing.lg);
  }

  /**
   * Adds spacing
   */
  addSpacing(amount: number): void {
    moveDown(this.state, amount);
  }

  /**
   * Adds a table
   */
  addTable(
    headers: string[],
    rows: string[][],
    fontSize: number = TYPOGRAPHY.scale.body,
    headerBold: boolean = true
  ): void {
    addPageIfNeeded(this.pdfDoc, this.state);
    
    const columnWidths = calculateColumnWidths(headers.length);
    const columns = columnWidths.map(width => ({ width, align: 'left' as const }));
    const rowHeight = fontSize + 16;

    // Draw header row
    drawTableRow(
      this.state.page,
      headers,
      LAYOUT.margin,
      this.state.y,
      columns,
      fontSize,
      this.getFont(headerBold),
      rowHeight,
      8,
      rgb(0, 0, 0)
    );
    moveDown(this.state, rowHeight);

    // Draw data rows
    for (const row of rows) {
      addPageIfNeeded(this.pdfDoc, this.state);
      drawTableRow(
        this.state.page,
        row,
        LAYOUT.margin,
        this.state.y,
        columns,
        fontSize,
        this.getFont(),
        rowHeight,
        8,
        rgb(0, 0, 0)
      );
      moveDown(this.state, rowHeight);
    }

    moveDown(this.state, TYPOGRAPHY.spacing.md);
  }

  /**
   * Adds a signature line
   */
  addSignatureLine(label: string, lineLength: number = 200): void {
    addPageIfNeeded(this.pdfDoc, this.state);
    drawSignatureLine(
      this.state.page,
      this.state.y,
      label,
      lineLength,
      TYPOGRAPHY.scale.small,
      this.getFont()
    );
    moveDown(this.state, TYPOGRAPHY.spacing.lg);
  }

  /**
   * Adds a footer
   */
  addFooter(config: FooterConfig): void {
    const footerY = Math.max(this.state.y - 20, LAYOUT.margin + 40);
    drawFooter(
      this.state.page,
      footerY,
      config,
      TYPOGRAPHY.scale.tiny,
      this.getFont()
    );
  }

  /**
   * Gets the current Y position
   */
  getCurrentY(): number {
    return this.state.y;
  }

  /**
   * Sets the current Y position
   */
  setY(y: number): void {
    this.state.y = y;
  }

  /**
   * Gets the current page
   */
  getCurrentPage(): PDFPage {
    return this.state.page;
  }

  /**
   * Builds and returns the PDF as a Buffer
   */
  async build(): Promise<Buffer> {
    const bytes = await this.pdfDoc.save();
    return Buffer.from(bytes);
  }

  /**
   * Gets the underlying PDFDocument (for advanced operations)
   */
  getDocument(): PDFDocument {
    return this.pdfDoc;
  }
}

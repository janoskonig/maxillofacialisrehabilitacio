import { PDFPage, PDFFont, rgb, Color } from 'pdf-lib';
import fs from 'fs';
import { resolveExistingPath, projectRootCandidates } from '@/lib/pdf/fs';

/**
 * Typography scale and spacing constants for consistent PDF design
 */
export const TYPOGRAPHY = {
  scale: {
    h1: 18,
    h2: 14,
    h3: 12,
    body: 11,
    small: 9,
    tiny: 7,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.8,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
} as const;

/**
 * Layout constants for A4 pages
 */
export const LAYOUT = {
  pageWidth: 595.28, // A4 width in points
  pageHeight: 841.89, // A4 height in points
  margin: 50,
  contentWidth: 495.28, // pageWidth - 2*margin
  columnGap: 16,
} as const;

/**
 * State object for tracking current position on a PDF page
 */
export interface PDFState {
  page: PDFPage;
  y: number;
}

/**
 * Moves the Y position down by the specified amount
 */
export function moveDown(state: PDFState, amount: number): void {
  state.y -= amount;
}

/**
 * Adds spacing based on font size and line height multiplier
 */
export function addLineSpacing(state: PDFState, fontSize: number, lineHeight: number = TYPOGRAPHY.lineHeight.normal): void {
  moveDown(state, fontSize * lineHeight);
}

/**
 * Calculates the X position for centered text
 */
export function getCenteredX(
  text: string,
  fontSize: number,
  font: PDFFont,
  pageWidth: number = LAYOUT.pageWidth
): number {
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  return (pageWidth - textWidth) / 2;
}

/**
 * Calculates the X position for right-aligned text
 */
export function getRightAlignedX(
  text: string,
  fontSize: number,
  font: PDFFont,
  pageWidth: number = LAYOUT.pageWidth,
  margin: number = LAYOUT.margin
): number {
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  return pageWidth - margin - textWidth;
}

/**
 * Draws text with proper alignment
 */
export function drawText(
  page: PDFPage,
  text: string,
  options: {
    x: number;
    y: number;
    fontSize: number;
    font: PDFFont;
    color?: Color;
    bold?: boolean;
  }
): void {
  const safeText = String(text)
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ');

  try {
    page.drawText(safeText, {
      x: options.x,
      y: options.y - options.fontSize, // Adjust Y position (PDF coordinates start from bottom)
      size: options.fontSize,
      font: options.font,
      color: options.color || rgb(0, 0, 0),
    });
  } catch (error: any) {
    // Fallback for standard fonts that cannot encode certain characters (e.g. ő, ű)
    if (error?.message && error.message.includes('cannot encode')) {
      const longReplaced = safeText
        .replace(/ő/g, 'ö')
        .replace(/Ő/g, 'Ö')
        .replace(/ű/g, 'ü')
        .replace(/Ű/g, 'Ü');

      try {
        page.drawText(longReplaced, {
          x: options.x,
          y: options.y - options.fontSize,
          size: options.fontSize,
          font: options.font,
          color: options.color || rgb(0, 0, 0),
        });
      } catch (retryError: any) {
        if (retryError?.message && retryError.message.includes('cannot encode')) {
          const asciiFallback = longReplaced.replace(/[^\x00-\x7F]/g, '?');
          page.drawText(asciiFallback, {
            x: options.x,
            y: options.y - options.fontSize,
            size: options.fontSize,
            font: options.font,
            color: options.color || rgb(0, 0, 0),
          });
        } else {
          throw retryError;
        }
      }
    } else {
      throw error;
    }
  }
}

/**
 * Draws centered text
 */
export function drawCenteredText(
  page: PDFPage,
  text: string,
  y: number,
  fontSize: number,
  font: PDFFont,
  color?: Color
): void {
  const x = getCenteredX(text, fontSize, font);
  drawText(page, text, { x, y, fontSize, font, color });
}

/**
 * Draws right-aligned text
 */
export function drawRightAlignedText(
  page: PDFPage,
  text: string,
  y: number,
  fontSize: number,
  font: PDFFont,
  margin: number = LAYOUT.margin,
  color?: Color
): void {
  const x = getRightAlignedX(text, fontSize, font, LAYOUT.pageWidth, margin);
  drawText(page, text, { x, y, fontSize, font, color });
}

/**
 * Draws left-aligned text
 */
export function drawLeftAlignedText(
  page: PDFPage,
  text: string,
  y: number,
  fontSize: number,
  font: PDFFont,
  margin: number = LAYOUT.margin,
  color?: Color
): void {
  drawText(page, text, { x: margin, y, fontSize, font, color });
}

/**
 * Draws multiline text with automatic line breaks
 */
export function drawMultilineText(
  page: PDFPage,
  text: string,
  startY: number,
  fontSize: number,
  font: PDFFont,
  maxWidth: number,
  margin: number = LAYOUT.margin,
  lineHeight: number = TYPOGRAPHY.lineHeight.normal,
  color?: Color
): number {
  const words = text.split(' ');
  let currentLine = '';
  let y = startY;
  const lineSpacing = fontSize * lineHeight;

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const textWidth = font.widthOfTextAtSize(testLine, fontSize);

    if (textWidth > maxWidth && currentLine) {
      // Draw current line and start new one
      drawText(page, currentLine, { x: margin, y, fontSize, font, color });
      y -= lineSpacing;
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  // Draw remaining line
  if (currentLine) {
    drawText(page, currentLine, { x: margin, y, fontSize, font, color });
    y -= lineSpacing;
  }

  return y;
}

/**
 * Table column configuration
 */
export interface TableColumn {
  width: number;
  align?: 'left' | 'center' | 'right';
}

/**
 * Draws a table row
 */
export function drawTableRow(
  page: PDFPage,
  cells: string[],
  x: number,
  y: number,
  columns: TableColumn[],
  fontSize: number,
  font: PDFFont,
  rowHeight: number = 20,
  padding: number = 8,
  borderColor?: Color
): void {
  let currentX = x;

  for (let i = 0; i < cells.length && i < columns.length; i++) {
    const column = columns[i];
    const cellText = cells[i] || '';
    let textX = currentX + padding;

    // Calculate text position based on alignment
    if (column.align === 'center') {
      const textWidth = font.widthOfTextAtSize(cellText, fontSize);
      textX = currentX + (column.width - textWidth) / 2;
    } else if (column.align === 'right') {
      const textWidth = font.widthOfTextAtSize(cellText, fontSize);
      textX = currentX + column.width - padding - textWidth;
    }

    // Draw cell border
    if (borderColor) {
      page.drawRectangle({
        x: currentX,
        y: y - rowHeight,
        width: column.width,
        height: rowHeight,
        borderColor,
        borderWidth: 0.5,
      });
    }

    // Draw cell text
    drawText(page, cellText, {
      x: textX,
      y: y,
      fontSize,
      font,
    });

    currentX += column.width;
  }
}

/**
 * Calculates column widths for a table
 */
export function calculateColumnWidths(
  numColumns: number,
  totalWidth: number = LAYOUT.contentWidth,
  columnGap: number = LAYOUT.columnGap
): number[] {
  const totalGap = (numColumns - 1) * columnGap;
  const columnWidth = (totalWidth - totalGap) / numColumns;
  return Array(numColumns).fill(columnWidth);
}

/**
 * Draws a horizontal line
 */
export function drawHorizontalLine(
  page: PDFPage,
  y: number,
  startX: number = LAYOUT.margin,
  endX: number = LAYOUT.pageWidth - LAYOUT.margin,
  thickness: number = 1,
  color: Color = rgb(0, 0, 0)
): void {
  page.drawLine({
    start: { x: startX, y },
    end: { x: endX, y },
    thickness,
    color,
  });
}

/**
 * Draws a signature line with label
 */
export function drawSignatureLine(
  page: PDFPage,
  y: number,
  label: string,
  lineLength: number = 200,
  fontSize: number = TYPOGRAPHY.scale.small,
  font: PDFFont,
  margin: number = LAYOUT.margin
): void {
  // Draw label
  drawText(page, label, {
    x: margin,
    y: y + fontSize + 2,
    fontSize,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  // Draw dotted line
  const lineStartX = margin + font.widthOfTextAtSize(label, fontSize) + 8;
  const dashLength = 3;
  const gapLength = 2;
  let currentX = lineStartX;

  while (currentX < lineStartX + lineLength) {
    const dashEndX = Math.min(currentX + dashLength, lineStartX + lineLength);
    page.drawLine({
      start: { x: currentX, y },
      end: { x: dashEndX, y },
      thickness: 0.5,
      color: rgb(0, 0, 0),
    });
    currentX += dashLength + gapLength;
  }
}

/**
 * Header configuration
 */
export interface HeaderConfig {
  institutionName: string[];
  director?: string;
  address?: string;
  phone?: string;
  logo1Path?: string;
  logo2Path?: string;
  logoWidth?: number;
}

/**
 * Draws a header block with logos and institution information
 */
export async function drawHeader(
  pdfDoc: any, // PDFDocument type from pdf-lib
  page: PDFPage,
  state: PDFState,
  config: HeaderConfig,
  font?: PDFFont,
  fontBold?: PDFFont
): Promise<void> {
  const logoWidth = config.logoWidth || 60;
  let logo1Height = 0;
  let logo2Height = 0;
  let hasLogo = false;

  // Load and draw logo 1 (left)
  if (config.logo1Path) {
    const logo1Path = resolveExistingPath(projectRootCandidates('public', config.logo1Path));
    if (logo1Path) {
      try {
        const logoBytes = fs.readFileSync(logo1Path);
        const img = await pdfDoc.embedPng(logoBytes);
        logo1Height = (img.height / img.width) * logoWidth;
        page.drawImage(img, {
          x: LAYOUT.margin,
          y: state.y - logo1Height,
          width: logoWidth,
          height: logo1Height,
        });
        hasLogo = true;
      } catch (error) {
        console.warn('Failed to load logo 1:', error);
      }
    }
  }

  // Load and draw logo 2 (right)
  if (config.logo2Path) {
    const logo2Path = resolveExistingPath(projectRootCandidates('public', config.logo2Path));
    if (logo2Path) {
      try {
        const logoBytes = fs.readFileSync(logo2Path);
        const img = await pdfDoc.embedPng(logoBytes);
        logo2Height = (img.height / img.width) * logoWidth;
        page.drawImage(img, {
          x: LAYOUT.pageWidth - LAYOUT.margin - logoWidth,
          y: state.y - logo2Height,
          width: logoWidth,
          height: logo2Height,
        });
        hasLogo = true;
      } catch (error) {
        console.warn('Failed to load logo 2:', error);
      }
    }
  }

  if (hasLogo) {
    moveDown(state, Math.max(logo1Height, logo2Height) + TYPOGRAPHY.spacing.sm);
  }

  // Draw institution name lines (centered) if fonts are provided
  if (font && fontBold && config.institutionName.length > 0) {
    for (let i = 0; i < config.institutionName.length; i++) {
      const isFirst = i === 0;
      const fontSize = isFirst ? TYPOGRAPHY.scale.h1 : i === 1 ? 15 : 14;
      drawCenteredText(page, config.institutionName[i], state.y, fontSize, isFirst ? fontBold : font);
      moveDown(state, fontSize + TYPOGRAPHY.spacing.sm);
    }
    
    if (config.director) {
      drawCenteredText(page, config.director, state.y, TYPOGRAPHY.scale.body, font);
      moveDown(state, TYPOGRAPHY.scale.body + TYPOGRAPHY.spacing.md);
    }
  }
}

/**
 * Footer configuration
 */
export interface FooterConfig {
  address?: string;
  postalAddress?: string;
  email?: string;
  phone?: string;
  fax?: string;
  website?: string;
}

/**
 * Draws a footer block
 */
export function drawFooter(
  page: PDFPage,
  y: number,
  config: FooterConfig,
  fontSize: number = TYPOGRAPHY.scale.tiny,
  font: PDFFont
): void {
  const footerY = y;
  
  // Draw separator line
  drawHorizontalLine(page, footerY, LAYOUT.margin, LAYOUT.pageWidth - LAYOUT.margin, 0.5);

  let currentY = footerY - fontSize - 2;

  // Left side information
  if (config.address) {
    drawText(page, config.address, {
      x: LAYOUT.margin,
      y: currentY,
      fontSize,
      font,
    });
    currentY -= fontSize + 2;
  }

  if (config.postalAddress) {
    drawText(page, config.postalAddress, {
      x: LAYOUT.margin,
      y: currentY,
      fontSize,
      font,
    });
    currentY -= fontSize + 2;
  }

  if (config.email) {
    drawText(page, config.email, {
      x: LAYOUT.margin,
      y: currentY,
      fontSize,
      font,
    });
    currentY -= fontSize + 2;
  }

  // Right side information
  currentY = footerY - fontSize - 2;

  if (config.phone) {
    const x = getRightAlignedX(config.phone, fontSize, font);
    drawText(page, config.phone, {
      x,
      y: currentY,
      fontSize,
      font,
    });
    currentY -= fontSize + 2;
  }

  if (config.fax) {
    const x = getRightAlignedX(config.fax, fontSize, font);
    drawText(page, config.fax, {
      x,
      y: currentY,
      fontSize,
      font,
    });
    currentY -= fontSize + 2;
  }

  if (config.website) {
    const x = getRightAlignedX(config.website, fontSize, font);
    drawText(page, config.website, {
      x,
      y: currentY,
      fontSize,
      font,
    });
  }
}

/**
 * Checks if a new page is needed and adds one if necessary
 */
export function addPageIfNeeded(
  pdfDoc: any, // PDFDocument type from pdf-lib
  state: PDFState,
  minY: number = LAYOUT.margin + 40
): void {
  if (state.y >= minY) return;
  
  state.page = pdfDoc.addPage([LAYOUT.pageWidth, LAYOUT.pageHeight]);
  state.y = LAYOUT.pageHeight - LAYOUT.margin;
}

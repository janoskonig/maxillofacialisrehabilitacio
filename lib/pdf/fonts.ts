import { PDFDocument, StandardFonts, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs';
import { resolveExistingPath, projectRootCandidates } from '@/lib/pdf/fs';

// Cache raw font files to avoid repeated disk reads across requests.
let dejaVuFontBytesCache: Uint8Array | null = null;
let dejaVuBoldFontBytesCache: Uint8Array | null = null;

function isLikelyHtmlContent(bytes: Uint8Array): boolean {
  const prefix = Buffer.from(bytes.subarray(0, 512)).toString('utf8').toLowerCase();
  return prefix.includes('<html') || prefix.includes('<!doctype html') || prefix.includes('404: not found');
}

function loadFontBytes(candidates: string[], fontName: string): Uint8Array | null {
  const fontPath = resolveExistingPath(candidates);
  if (!fontPath) return null;

  const fontBytes = fs.readFileSync(fontPath);
  if (isLikelyHtmlContent(fontBytes)) {
    console.warn(`${fontName} at ${fontPath} is not a valid font file (HTML content detected).`);
    return null;
  }

  return fontBytes;
}

/**
 * Loads and caches DejaVu Sans font for proper Hungarian character support (ő, ű, etc.)
 * Falls back to StandardFonts.Helvetica if DejaVu is not available
 */
export async function getDejaVuFont(pdfDoc: PDFDocument): Promise<PDFFont> {
  if (!dejaVuFontBytesCache) {
    dejaVuFontBytesCache = loadFontBytes(
      projectRootCandidates('public', 'fonts', 'DejaVuSans.ttf'),
      'DejaVu Sans'
    );
  }

  if (dejaVuFontBytesCache) {
    try {
      pdfDoc.registerFontkit(fontkit);
      return await pdfDoc.embedFont(dejaVuFontBytesCache);
    } catch (error) {
      console.warn('Failed to embed DejaVu Sans font, falling back to Helvetica:', error);
    }
  }

  // Fallback to standard font
  const fallbackFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  return fallbackFont;
}

/**
 * Loads and caches DejaVu Sans Bold font for proper Hungarian character support
 * Falls back to StandardFonts.HelveticaBold if DejaVu Bold is not available
 */
export async function getDejaVuBoldFont(pdfDoc: PDFDocument): Promise<PDFFont> {
  if (!dejaVuBoldFontBytesCache) {
    dejaVuBoldFontBytesCache = loadFontBytes(
      projectRootCandidates('public', 'fonts', 'DejaVuSans-Bold.ttf'),
      'DejaVu Sans Bold'
    );
  }

  if (dejaVuBoldFontBytesCache) {
    try {
      pdfDoc.registerFontkit(fontkit);
      return await pdfDoc.embedFont(dejaVuBoldFontBytesCache);
    } catch (error) {
      console.warn('Failed to embed DejaVu Sans Bold font, falling back to HelveticaBold:', error);
    }
  }

  // Fallback to standard font
  const fallbackFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  return fallbackFont;
}

/**
 * Clears the font cache (useful for testing or when fonts need to be reloaded)
 */
export function clearFontCache(): void {
  dejaVuFontBytesCache = null;
  dejaVuBoldFontBytesCache = null;
}

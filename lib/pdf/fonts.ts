import { PDFDocument, StandardFonts, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs';
import { resolveExistingPath, projectRootCandidates } from '@/lib/pdf/fs';

// Cache for embedded fonts
let dejaVuFontCache: PDFFont | null = null;
let dejaVuBoldFontCache: PDFFont | null = null;

/**
 * Loads and caches DejaVu Sans font for proper Hungarian character support (ő, ű, etc.)
 * Falls back to StandardFonts.Helvetica if DejaVu is not available
 */
export async function getDejaVuFont(pdfDoc: PDFDocument): Promise<PDFFont> {
  if (dejaVuFontCache) {
    return dejaVuFontCache;
  }

  const fontPath = resolveExistingPath(projectRootCandidates('public', 'fonts', 'DejaVuSans.ttf'));
  
  if (fontPath) {
    try {
      // Ensure fontkit is registered before embedding custom fonts
      pdfDoc.registerFontkit(fontkit);
      const fontBytes = fs.readFileSync(fontPath);
      dejaVuFontCache = await pdfDoc.embedFont(fontBytes);
      return dejaVuFontCache;
    } catch (error) {
      console.warn('Failed to load DejaVu Sans font, falling back to Helvetica:', error);
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
  if (dejaVuBoldFontCache) {
    return dejaVuBoldFontCache;
  }

  const fontPath = resolveExistingPath(projectRootCandidates('public', 'fonts', 'DejaVuSans-Bold.ttf'));
  
  if (fontPath) {
    try {
      // Ensure fontkit is registered before embedding custom fonts
      pdfDoc.registerFontkit(fontkit);
      const fontBytes = fs.readFileSync(fontPath);
      dejaVuBoldFontCache = await pdfDoc.embedFont(fontBytes);
      return dejaVuBoldFontCache;
    } catch (error) {
      console.warn('Failed to load DejaVu Sans Bold font, falling back to HelveticaBold:', error);
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
  dejaVuFontCache = null;
  dejaVuBoldFontCache = null;
}

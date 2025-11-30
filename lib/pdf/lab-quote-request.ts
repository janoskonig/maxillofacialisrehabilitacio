import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { Patient, LabQuoteRequest } from '@/lib/types';

/**
 * Helper függvény az ő → ö, ű → ü cseréhez (fallback, ha az eredeti nem működik)
 */
function replaceLongAccents(text: string): string {
  return text
    .replace(/ő/g, 'ö')
    .replace(/Ő/g, 'Ö')
    .replace(/ű/g, 'ü')
    .replace(/Ű/g, 'Ü');
}

/**
 * Helper függvény az összes ékezetes karakter cseréjéhez ASCII karakterekre
 * Utolsó fallback, ha még mindig hiba van
 */
function replaceAllAccentedChars(text: string): string {
  const replacements: Record<string, string> = {
    'á': 'a', 'Á': 'A',
    'é': 'e', 'É': 'E',
    'í': 'i', 'Í': 'I',
    'ó': 'o', 'Ó': 'O',
    'ö': 'o', 'Ö': 'O',
    'ő': 'o', 'Ő': 'O',
    'ú': 'u', 'Ú': 'U',
    'ü': 'u', 'Ü': 'U',
    'ű': 'u', 'Ű': 'U',
  };
  
  return text.replace(/[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/g, (char) => replacements[char] || char);
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
  const page = pdfDoc.addPage([595, 842]); // A4 méret (pontokban)
  
  // Helvetica fontot használunk (StandardFonts)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  const pageWidth = page.getSize().width;
  const margin = 50;
  let yPosition = page.getSize().height - margin;
  
  // Logo betöltése (ha létezik PNG verzió)
  let logoImage1 = null; // Balra igazított logo
  let logoImage2 = null; // Jobbra igazított logo
  try {
    const logo1Path = path.join(process.cwd(), 'public', 'logo_1.png');
    if (fs.existsSync(logo1Path)) {
      const logoBytes = fs.readFileSync(logo1Path);
      logoImage1 = await pdfDoc.embedPng(logoBytes);
    }
  } catch (error) {
    console.warn('Logo 1 betöltése sikertelen:', error);
  }
  try {
    const logo2Path = path.join(process.cwd(), 'public', 'logo_2.png');
    if (fs.existsSync(logo2Path)) {
      const logoBytes = fs.readFileSync(logo2Path);
      logoImage2 = await pdfDoc.embedPng(logoBytes);
    }
  } catch (error) {
    console.warn('Logo 2 betöltése sikertelen:', error);
  }
  
  // Helper függvény középre igazított szöveghez
  const addCenteredText = (text: string, fontSize: number, isBold: boolean = false) => {
    const currentFont = isBold ? boldFont : font;
      // Először próbáljuk meg az eredeti szöveget
    try {
      const textWidth = measureTextWidth(text, fontSize, currentFont);
      const x = (pageWidth - textWidth) / 2;
      page.drawText(text, {
        x,
        y: yPosition,
        size: fontSize,
        font: currentFont,
        color: rgb(0, 0, 0),
      });
    } catch (error: any) {
      if (error.message && error.message.includes('cannot encode')) {
        try {
          // Próbáljuk meg az ő → ö, ű → ü cserét
          const textWithReplacedLong = replaceLongAccents(text);
          const textWidth = measureTextWidth(textWithReplacedLong, fontSize, currentFont);
          const x = (pageWidth - textWidth) / 2;
          page.drawText(textWithReplacedLong, {
            x,
            y: yPosition,
            size: fontSize,
            font: currentFont,
            color: rgb(0, 0, 0),
          });
        } catch (retryError: any) {
          // Ha még mindig hiba van, cseréljük az összes ékezetes karaktert
          if (retryError.message && retryError.message.includes('cannot encode')) {
            const safeText = replaceAllAccentedChars(text);
            const textWidth = measureTextWidth(safeText, fontSize, currentFont);
            const x = (pageWidth - textWidth) / 2;
            page.drawText(safeText, {
              x,
              y: yPosition,
              size: fontSize,
              font: currentFont,
              color: rgb(0, 0, 0),
            });
          } else {
            throw retryError;
          }
        }
      } else {
        throw error;
      }
    }
    yPosition -= fontSize + 10;
  };
  
  // Helper függvény jobbra igazított szöveghez
  const addRightAlignedText = (text: string, fontSize: number, isBold: boolean = false) => {
    const currentFont = isBold ? boldFont : font;
      // Először próbáljuk meg az eredeti szöveget
    try {
      const textWidth = measureTextWidth(text, fontSize, currentFont);
      const x = pageWidth - margin - textWidth;
      page.drawText(text, {
        x,
        y: yPosition,
        size: fontSize,
        font: currentFont,
        color: rgb(0.4, 0.4, 0.4), // Szürke szín a dátumhoz
      });
    } catch (error: any) {
      if (error.message && error.message.includes('cannot encode')) {
        try {
          // Próbáljuk meg az ő → ö, ű → ü cserét
          const textWithReplacedLong = replaceLongAccents(text);
          const textWidth = measureTextWidth(textWithReplacedLong, fontSize, currentFont);
          const x = pageWidth - margin - textWidth;
          page.drawText(textWithReplacedLong, {
            x,
            y: yPosition,
            size: fontSize,
            font: currentFont,
            color: rgb(0.4, 0.4, 0.4),
          });
        } catch (retryError: any) {
          // Ha még mindig hiba van, cseréljük az összes ékezetes karaktert
          if (retryError.message && retryError.message.includes('cannot encode')) {
            const safeText = replaceAllAccentedChars(text);
            const textWidth = measureTextWidth(safeText, fontSize, currentFont);
            const x = pageWidth - margin - textWidth;
            page.drawText(safeText, {
              x,
              y: yPosition,
              size: fontSize,
              font: currentFont,
              color: rgb(0.4, 0.4, 0.4),
            });
          } else {
            throw retryError;
          }
        }
      } else {
        throw error;
      }
    }
    yPosition -= fontSize + 5;
  };
  
  // Helper függvény szöveg hozzáadásához
  const addText = (text: string, fontSize: number, isBold: boolean = false, x: number = margin) => {
    const currentFont = isBold ? boldFont : font;
    // Először próbáljuk meg az eredeti szöveget (minden ékezetes karakterrel, beleértve az Ő, Ű, ő, ű-t)
    try {
      page.drawText(text, {
        x,
        y: yPosition,
        size: fontSize,
        font: currentFont,
        color: rgb(0, 0, 0),
      });
    } catch (error: any) {
      // Ha hiba van, próbáljuk meg az ő → ö, ű → ü cserét
      if (error.message && error.message.includes('cannot encode')) {
        try {
          const textWithReplacedLong = replaceLongAccents(text);
          page.drawText(textWithReplacedLong, {
            x,
            y: yPosition,
            size: fontSize,
            font: currentFont,
            color: rgb(0, 0, 0),
          });
        } catch (retryError: any) {
          // Ha még mindig hiba van, cseréljük az összes ékezetes karaktert
          if (retryError.message && retryError.message.includes('cannot encode')) {
            const safeText = replaceAllAccentedChars(text);
            try {
              page.drawText(safeText, {
                x,
                y: yPosition,
                size: fontSize,
                font: currentFont,
                color: rgb(0, 0, 0),
              });
            } catch (finalError) {
              // Ha még mindig hiba van, teljesen biztonságos szöveget használunk
              const finalSafeText = text.replace(/[^\x00-\x7F]/g, '?');
              page.drawText(finalSafeText, {
                x,
                y: yPosition,
                size: fontSize,
                font: currentFont,
                color: rgb(0, 0, 0),
              });
            }
          } else {
            throw retryError;
          }
        }
      } else {
        throw error;
      }
    }
    yPosition -= fontSize + 10;
  };
  
  // Helper függvény szöveg szélességének méréséhez
  // Először próbáljuk meg az eredeti szöveget, majd ha hiba van, próbáljuk az ő → ö, ű → ü cserét
  const measureTextWidth = (text: string, fontSize: number, fontToUse: any): number => {
    try {
      // Először próbáljuk meg az eredeti szöveget (minden ékezetes karakterrel)
      return fontToUse.widthOfTextAtSize(text, fontSize);
    } catch (error: any) {
      // Ha hiba van, próbáljuk meg az ő → ö, ű → ü cserét
      if (error.message && error.message.includes('cannot encode')) {
        try {
          const textWithReplacedLong = replaceLongAccents(text);
          return fontToUse.widthOfTextAtSize(textWithReplacedLong, fontSize);
        } catch (retryError: any) {
          // Ha még mindig hiba van, cseréljük az összes ékezetes karaktert
          if (retryError.message && retryError.message.includes('cannot encode')) {
            const safeText = replaceAllAccentedChars(text);
            return fontToUse.widthOfTextAtSize(safeText, fontSize);
          }
          throw retryError;
        }
      }
      throw error;
    }
  };

  // Helper függvény több soros szöveghez
  const addMultilineText = (text: string, fontSize: number, isBold: boolean = false, x: number = margin, maxWidth?: number) => {
    const currentFont = isBold ? boldFont : font;
    // Először próbáljuk meg az eredeti szöveget (minden ékezetes karakterrel)
    const displayText = text;
    const lines = displayText.split('\n');
    lines.forEach(line => {
      if (maxWidth) {
        // Szöveg tördelése, ha túl hosszú
        const words = line.split(' ');
        let currentLine = '';
        words.forEach(word => {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const textWidth = measureTextWidth(testLine, fontSize, currentFont);
          if (textWidth > maxWidth && currentLine) {
            try {
              page.drawText(currentLine, {
                x,
                y: yPosition,
                size: fontSize,
                font: currentFont,
                color: rgb(0, 0, 0),
              });
            } catch (error: any) {
              if (error.message && error.message.includes('cannot encode')) {
                try {
                  // Próbáljuk meg az ő → ö, ű → ü cserét
                  const textWithReplacedLong = replaceLongAccents(currentLine);
                  page.drawText(textWithReplacedLong, {
                    x,
                    y: yPosition,
                    size: fontSize,
                    font: currentFont,
                    color: rgb(0, 0, 0),
                  });
                } catch (retryError: any) {
                  // Ha még mindig hiba van, cseréljük az összes ékezetes karaktert
                  if (retryError.message && retryError.message.includes('cannot encode')) {
                    const safeText = replaceAllAccentedChars(currentLine);
                    page.drawText(safeText, {
                      x,
                      y: yPosition,
                      size: fontSize,
                      font: currentFont,
                      color: rgb(0, 0, 0),
                    });
                  } else {
                    throw retryError;
                  }
                }
              } else {
                throw error;
              }
            }
            yPosition -= fontSize + 5;
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        });
        if (currentLine) {
          try {
            page.drawText(currentLine, {
              x,
              y: yPosition,
              size: fontSize,
              font: currentFont,
              color: rgb(0, 0, 0),
            });
          } catch (error: any) {
            if (error.message && error.message.includes('cannot encode')) {
              try {
                // Próbáljuk meg az ő → ö, ű → ü cserét
                const textWithReplacedLong = replaceLongAccents(currentLine);
                page.drawText(textWithReplacedLong, {
                  x,
                  y: yPosition,
                  size: fontSize,
                  font: currentFont,
                  color: rgb(0, 0, 0),
                });
              } catch (retryError: any) {
                // Ha még mindig hiba van, cseréljük az összes ékezetes karaktert
                if (retryError.message && retryError.message.includes('cannot encode')) {
                  const safeText = replaceAllAccentedChars(currentLine);
                  page.drawText(safeText, {
                    x,
                    y: yPosition,
                    size: fontSize,
                    font: currentFont,
                    color: rgb(0, 0, 0),
                  });
                } else {
                  throw retryError;
                }
              }
            } else {
              throw error;
            }
          }
          yPosition -= fontSize + 5;
        }
      } else {
        try {
          page.drawText(line, {
            x,
            y: yPosition,
            size: fontSize,
            font: currentFont,
            color: rgb(0, 0, 0),
          });
        } catch (error: any) {
          if (error.message && error.message.includes('cannot encode')) {
            try {
              // Próbáljuk meg az ő → ö, ű → ü cserét
              const textWithReplacedLong = replaceLongAccents(line);
              page.drawText(textWithReplacedLong, {
                x,
                y: yPosition,
                size: fontSize,
                font: currentFont,
                color: rgb(0, 0, 0),
              });
            } catch (retryError: any) {
              // Ha még mindig hiba van, cseréljük az összes ékezetes karaktert
              if (retryError.message && retryError.message.includes('cannot encode')) {
                const safeText = replaceAllAccentedChars(line);
                page.drawText(safeText, {
                  x,
                  y: yPosition,
                  size: fontSize,
                  font: currentFont,
                  color: rgb(0, 0, 0),
                });
              } else {
                throw retryError;
              }
            }
          } else {
            throw error;
          }
        }
        yPosition -= fontSize + 5;
      }
    });
  };
  
  // Fejléc (hasonló a fog státusz PDF-hez)
  // Logo hozzáadása (ha van) - logo_1 balra, logo_2 jobbra, ugyanabban a sorban mint a fejléc szöveg
  const logoWidth = 60;
  let logo1Height = 0;
  let logo2Height = 0;
  
  if (logoImage1) {
    logo1Height = (logoImage1.height / logoImage1.width) * logoWidth;
  }
  if (logoImage2) {
    logo2Height = (logoImage2.height / logoImage2.width) * logoWidth;
  }
  
  // Fejléc szöveg középre igazítva
  // Az első sor magassága (18pt + 10pt spacing)
  const firstLineHeight = 18 + 10;
  const headerCenterY = yPosition - (firstLineHeight / 2);
  
  // Logók rajzolása ugyanabban a sorban, mint a fejléc szöveg
  // Függőlegesen középre igazítva a fejléc szöveghez képest
  if (logoImage1) {
    const logo1Y = headerCenterY - (logo1Height / 2);
    page.drawImage(logoImage1, {
      x: margin, // Balra igazítva
      y: logo1Y,
      width: logoWidth,
      height: logo1Height,
    });
  }
  if (logoImage2) {
    const logo2Y = headerCenterY - (logo2Height / 2);
    page.drawImage(logoImage2, {
      x: pageWidth - logoWidth - margin, // Jobbra igazítva
      y: logo2Y,
      width: logoWidth,
      height: logo2Height,
    });
  }
  
  // Fejléc szöveg középre igazítva (ugyanabban a sorban, mint a logók)
  addCenteredText('SEMMELWEIS EGYETEM', 18, true);
  addCenteredText('Fogorvostudományi Kar', 15);
  addCenteredText('Fogpótlástani Klinika', 14);
  addCenteredText('Igazgató: Prof. Dr. Hermann Péter', 11);
  yPosition -= 15;
  
  // Dátum jobbra igazítva
  const currentDate = new Date().toLocaleDateString('hu-HU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  addRightAlignedText(`Dátum: ${currentDate}`, 9);
  yPosition -= 15;
  
  // Cím
  addCenteredText('Árajánlatkérő', 20, true);
  yPosition -= 20;
  
  // Beteg adatai
  addText(patient.nev || '', 12, true);
  yPosition -= 5;
  
  // Cím formázása: Utcanév házszám, Város, Irányítószám külön sorokban
  if (patient.cim) {
    addText(patient.cim, 12);
    yPosition -= 5;
  }
  if (patient.varos) {
    addText(patient.varos, 12);
    yPosition -= 5;
  }
  if (patient.iranyitoszam) {
    addText(patient.iranyitoszam, 12);
    yPosition -= 5;
  }
  
  yPosition -= 10;
  addText('részére', 12);
  yPosition -= 20;
  
  // Üdvözlés
  addText('Tisztelt Laboratórium!', 12);
  yPosition -= 20;
  
  // Szöveg
  addText('Fent nevezett részére szeretnénk kérni árajánlatot a következőkre:', 12);
  yPosition -= 20;
  
  // Árajánlatkérő szöveg
  if (quoteRequest.szoveg) {
    addMultilineText(quoteRequest.szoveg, 12, false, margin, pageWidth - 2 * margin);
    yPosition -= 10;
  }
  
  // Árajánlatkérő dátuma
  if (quoteRequest.datuma) {
    const date = new Date(quoteRequest.datuma);
    const formattedDate = date.toLocaleDateString('hu-HU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    addText('Határidő: ' + formattedDate, 12);
    yPosition -= 20;
  }
  
  // Üdvözlet
  addText('Üdvözlettel:', 12);
  yPosition -= 10;
  addText(patient.kezeleoorvos || '', 12, true);
  yPosition -= 30;
  
  // Aláírás helye (jobbra igazítva)
  const budapestDate = 'Budapest, ' + new Date().toLocaleDateString('hu-HU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  addRightAlignedText(budapestDate, 12);
  
  // PDF generálása
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}


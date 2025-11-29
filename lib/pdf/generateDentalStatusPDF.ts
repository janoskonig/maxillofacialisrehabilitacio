import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

interface Patient {
  id?: string;
  nev?: string | null;
  taj?: string | null;
  meglevoFogak?: Record<string, any>;
  felsoFogpotlasVan?: boolean;
  felsoFogpotlasMikor?: string | null;
  felsoFogpotlasKeszito?: string | null;
  felsoFogpotlasElegedett?: boolean;
  felsoFogpotlasProblema?: string | null;
  felsoFogpotlasTipus?: string | null;
  fabianFejerdyProtetikaiOsztalyFelso?: string | null;
  alsoFogpotlasVan?: boolean;
  alsoFogpotlasMikor?: string | null;
  alsoFogpotlasKeszito?: string | null;
  alsoFogpotlasElegedett?: boolean;
  alsoFogpotlasProblema?: string | null;
  alsoFogpotlasTipus?: string | null;
  fabianFejerdyProtetikaiOsztalyAlso?: string | null;
  meglevoImplantatumok?: Record<string, string>;
  nemIsmertPoziciokbanImplantatum?: boolean;
  nemIsmertPoziciokbanImplantatumRészletek?: string | null;
}

type ToothStatus = { status?: 'D' | 'F' | 'M'; description?: string } | string;

function normalizeToothData(value: ToothStatus | undefined): { status?: 'D' | 'F' | 'M'; description?: string } | null {
  if (!value) return null;
  if (typeof value === 'string') {
    return { description: value };
  }
  return value;
}

export async function generateDentalStatusPDF(patient: Patient): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      // Fix pdfkit font path issue in Next.js
      const fontDataPath = path.join(process.cwd(), 'node_modules', 'pdfkit', 'js', 'data');
      const originalReadFileSync = fs.readFileSync;
      
      (fs as any).readFileSync = function(filePath: string, ...args: any[]) {
        if (filePath.includes('.afm') && (filePath.includes('vendor-chunks') || filePath.includes('.next'))) {
          const afmFile = path.basename(filePath);
          const afmPath = path.join(fontDataPath, afmFile);
          if (fs.existsSync(afmPath)) {
            return originalReadFileSync.call(this, afmPath, ...args);
          }
        }
        return originalReadFileSync.call(this, filePath, ...args);
      };
      
      const doc = new PDFDocument({ 
        size: 'A4', 
        margin: 50,
        autoFirstPage: true,
        lang: 'hu',
      });
      const buffers: Buffer[] = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        (fs as any).readFileSync = originalReadFileSync;
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on('error', (error) => {
        (fs as any).readFileSync = originalReadFileSync;
        reject(error);
      });

      // Header
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#000000').text('SEMMELWEIS EGYETEM', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(15).font('Helvetica').text('Fogorvostudományi Kar', { align: 'center' });
      doc.moveDown(0.2);
      doc.fontSize(14).text('Fogpótlástani Klinika', { align: 'center' });
      doc.moveDown(0.2);
      doc.fontSize(11).text('Igazgató: Prof. Dr. Hermann Péter', { align: 'center' });
      doc.moveDown(1.2);
      
      // Date
      const currentDate = new Date().toLocaleDateString('hu-HU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      doc.fontSize(9).font('Helvetica').fillColor('#666666').text(`Dátum: ${currentDate}`, { align: 'right' });
      doc.moveDown(1);
      
      // Separator line
      doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(1).stroke('#000000');
      doc.moveDown(1.5);

      // Patient Info
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000').text('PÁCIENS ADATOK', 50, doc.y);
      doc.moveDown(0.8);
      doc.fontSize(11).font('Helvetica').fillColor('#000000');
      doc.text(`Beteg neve: ${patient.nev || 'Név nélküli beteg'}`, 50, doc.y);
      if (patient.taj) {
        doc.moveDown(0.5);
        doc.text(`TAJ szám: ${patient.taj}`, 50, doc.y);
      }
      doc.moveDown(1.5);

      // Dental Status Section
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000').text('FOGAZATI STÁTUSZ', 50, doc.y);
      doc.moveDown(0.8);
      
      const fogak = patient.meglevoFogak || {};
      
      // Zsigmondy Cross - Compact table format fitting page width
      const upperLeft = [18, 17, 16, 15, 14, 13, 12, 11];
      const upperRight = [21, 22, 23, 24, 25, 26, 27, 28];
      const lowerLeft = [48, 47, 46, 45, 44, 43, 42, 41];
      const lowerRight = [31, 32, 33, 34, 35, 36, 37, 38];

      // Helper function to draw tooth status symbol
      const drawToothStatus = (doc: PDFKit.PDFDocument, x: number, y: number, cellWidth: number, cellHeight: number, status: 'M' | 'present' | null, description?: string) => {
        const centerX = x + cellWidth / 2;
        const centerY = y + cellHeight / 2;
        const size = 7; // Symbol size
        
        if (status === 'M') {
          // Draw gray X
          doc.strokeColor('#6b7280').lineWidth(2);
          doc.moveTo(centerX - size, centerY - size)
            .lineTo(centerX + size, centerY + size)
            .moveTo(centerX + size, centerY - size)
            .lineTo(centerX - size, centerY + size)
            .stroke();
        } else if (status === 'present') {
          // Ellenőrizzük a szabadszavas leírást az ikon meghatározáshoz
          const descriptionLower = (description || '').toLowerCase();
          const hasKerdeses = descriptionLower.includes('kérdéses');
          const hasRemenytelen = descriptionLower.includes('reménytelen');
          
          if (hasRemenytelen) {
            // Reménytelen → piros felkiáltójel
            doc.strokeColor('#dc2626').lineWidth(2.5);
            doc.fillColor('#dc2626');
            // Felkiáltójel függőleges vonal
            doc.moveTo(centerX, centerY - size)
              .lineTo(centerX, centerY + size / 3)
              .stroke();
            // Pont alul
            doc.circle(centerX, centerY + size * 0.8, 1.8).fill();
          } else if (hasKerdeses) {
            // Kérdéses → sárga kérdőjel
            doc.strokeColor('#eab308').lineWidth(2);
            doc.fillColor('#eab308');
            // Kérdőjel felső része (körív)
            const radius = size / 2.2;
            doc.circle(centerX, centerY - size / 2, radius).stroke();
            // Kérdőjel görbe alsó része
            doc.moveTo(centerX - size / 3, centerY + size / 4)
              .quadraticCurveTo(centerX, centerY + size / 2, centerX + size / 3, centerY + size / 4)
              .stroke();
            // Pont alul
            doc.circle(centerX, centerY + size * 0.75, 1.5).fill();
          } else {
            // Normál → zöld pipa
            doc.strokeColor('#10b981').lineWidth(2.5);
            doc.moveTo(centerX - size, centerY)
              .lineTo(centerX - size / 3, centerY + size)
              .lineTo(centerX + size, centerY - size)
              .stroke();
          }
        }
      };

      // Calculate cell width to fit all teeth in page width
      const pageWidth = 545 - 50; // Available width
      const numTeethPerRow = 8; // 8 teeth per row
      const spacing = 2; // Space between cells
      const gapBetweenSides = 10; // Gap between left and right sides
      const cellWidth = Math.floor((pageWidth - (numTeethPerRow * spacing) - gapBetweenSides) / (numTeethPerRow * 2));
      const cellHeight = 18;
      const startX = 50;
      
      const tableY = doc.y;
      
      // Upper jaw - single row with left and right sides
      let xPos = startX;
      
      // Upper left row (18-11, fordítva: 2. kvadráns, 11 az utolsó)
      upperLeft.forEach(tooth => {
        doc.rect(xPos, tableY, cellWidth, cellHeight).stroke('#000000');
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000').text(tooth.toString(), xPos + 1, tableY + 1);
        const toothStr = tooth.toString();
        const value = fogak[toothStr];
        const normalized = normalizeToothData(value);
        if (normalized) {
          const status = normalized.status === 'M' ? 'M' : 'present';
          drawToothStatus(doc, xPos, tableY, cellWidth, cellHeight, status, normalized.description);
        }
        xPos += cellWidth + spacing;
      });
      
      // Space between left and right
      xPos += gapBetweenSides;
      
      // Upper right row (21-28, 1. kvadráns)
      upperRight.forEach(tooth => {
        doc.rect(xPos, tableY, cellWidth, cellHeight).stroke('#000000');
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000').text(tooth.toString(), xPos + 1, tableY + 1);
        const toothStr = tooth.toString();
        const value = fogak[toothStr];
        const normalized = normalizeToothData(value);
        if (normalized) {
          const status = normalized.status === 'M' ? 'M' : 'present';
          drawToothStatus(doc, xPos, tableY, cellWidth, cellHeight, status, normalized.description);
        }
        xPos += cellWidth + spacing;
      });
      
      doc.y = tableY + cellHeight + 10;

      // Lower jaw - single row with left and right sides
      const lowerTableY = doc.y;
      xPos = startX;
      
      // Lower left row (48-41, fordítva: 4. kvadráns)
      lowerLeft.forEach(tooth => {
        doc.rect(xPos, lowerTableY, cellWidth, cellHeight).stroke('#000000');
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000').text(tooth.toString(), xPos + 1, lowerTableY + 1);
        const toothStr = tooth.toString();
        const value = fogak[toothStr];
        const normalized = normalizeToothData(value);
        if (normalized) {
          const status = normalized.status === 'M' ? 'M' : 'present';
          drawToothStatus(doc, xPos, lowerTableY, cellWidth, cellHeight, status, normalized.description);
        }
        xPos += cellWidth + spacing;
      });
      
      // Space between left and right
      xPos += gapBetweenSides;
      
      // Lower right row (31-38)
      lowerRight.forEach(tooth => {
        doc.rect(xPos, lowerTableY, cellWidth, cellHeight).stroke('#000000');
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000').text(tooth.toString(), xPos + 1, lowerTableY + 1);
        const toothStr = tooth.toString();
        const value = fogak[toothStr];
        const normalized = normalizeToothData(value);
        if (normalized) {
          const status = normalized.status === 'M' ? 'M' : 'present';
          drawToothStatus(doc, xPos, lowerTableY, cellWidth, cellHeight, status, normalized.description);
        }
        xPos += cellWidth + spacing;
      });
      
      doc.y = lowerTableY + cellHeight + 15;

      // Legend
      doc.fontSize(8).font('Helvetica').fillColor('#666666');
      doc.text('Jelentés: ✓ = Megvan (zöld), ? = Kérdéses (sárga), ! = Reménytelen (piros), X = Hiányzik (szürke)', 50, doc.y, { width: 495 });
      doc.moveDown(1);

      // DMF-T Index
      let dCount = 0;
      let fCount = 0;
      let mCount = 0;

      Object.values(fogak).forEach(value => {
        const normalized = normalizeToothData(value);
        if (normalized) {
          if (normalized.status === 'D') dCount++;
          else if (normalized.status === 'F') fCount++;
          else if (normalized.status === 'M') mCount++;
        }
      });

      const dmft = dCount + fCount + mCount;

      const dmftY = doc.y;
      doc.rect(50, dmftY, 495, 50).fillAndStroke('#e0f2fe', '#93c5fd');
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000').text('DMF-T INDEX', 60, dmftY + 8);
      
      doc.fontSize(10).font('Helvetica').fillColor('#dc2626').text(`D (szuvas): ${dCount}`, 60, dmftY + 25);
      doc.fillColor('#2563eb').text(`F (tömött): ${fCount}`, 200, dmftY + 25);
      doc.fillColor('#6b7280').text(`M (hiányzik): ${mCount}`, 340, dmftY + 25);
      doc.font('Helvetica-Bold').fillColor('#000000').text(`DMF-T összesen: ${dmft} / 32`, 450, dmftY + 25);
      
      doc.y = dmftY + 60;

      // Tooth Details - Separated by upper and lower jaw
      // Helper function to format tooth details
      const formatToothDetail = (toothNumber: string, normalized: { status?: 'D' | 'F' | 'M'; description?: string } | null): string => {
        if (!normalized) return '';
        
        let description = normalized.description || '';
        const status = normalized.status;

        // Ha nincs leírás, akkor a státusz jelentését írjuk ki
        if (!description && status) {
          if (status === 'D') description = 'Szuvas';
          else if (status === 'F') description = 'Tömött';
          else if (status === 'M') description = 'Hiányzik';
        }

        // Format: "fogszám: leírás (DMF-T jelzés)"
        let statusText = '';
        if (status === 'D') statusText = ' (D)';
        else if (status === 'F') statusText = ' (F)';
        else if (status === 'M') statusText = ' (M)';

        return `${toothNumber}: ${description}${statusText}`;
      };

      // Upper teeth (11-18, 21-28)
      const upperTeeth = [11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28];
      const upperTeethWithData = upperTeeth
        .map(t => t.toString())
        .filter(toothNumber => {
          const value = fogak[toothNumber];
          const normalized = normalizeToothData(value);
          return normalized && (normalized.description || normalized.status);
        })
        .sort((a, b) => parseInt(a) - parseInt(b));

      if (upperTeethWithData.length > 0) {
        doc.moveDown(0.5);
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000').text('FELSÖ FOGAK', 50, doc.y);
        doc.moveDown(0.5);

        upperTeethWithData.forEach(toothNumber => {
          const value = fogak[toothNumber];
          const normalized = normalizeToothData(value);
          const formattedText = formatToothDetail(toothNumber, normalized);
          
          if (formattedText) {
            doc.fontSize(10).font('Helvetica').fillColor('#000000').text(formattedText, 50, doc.y, { width: 495 });
            doc.moveDown(0.4);
          }
        });

        // Fábián- és Fejérdy-féle protetikai foghiányosztályozás for upper jaw
        if (patient.fabianFejerdyProtetikaiOsztalyFelso) {
          doc.moveDown(0.5);
          doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Fábián- és Fejérdy-féle protetikai foghiányosztályozás:', 50, doc.y);
          doc.fontSize(10).font('Helvetica').fillColor('#000000').text(patient.fabianFejerdyProtetikaiOsztalyFelso, 50, doc.y);
          doc.moveDown(0.5);
        } else {
          doc.moveDown(0.5);
          doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Fábián- és Fejérdy-féle protetikai foghiányosztályozás:', 50, doc.y);
          doc.moveDown(0.5);
        }
      }

      // Lower teeth (31-38, 41-48)
      const lowerTeeth = [31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48];
      const lowerTeethWithData = lowerTeeth
        .map(t => t.toString())
        .filter(toothNumber => {
          const value = fogak[toothNumber];
          const normalized = normalizeToothData(value);
          return normalized && (normalized.description || normalized.status);
        })
        .sort((a, b) => parseInt(a) - parseInt(b));

      if (lowerTeethWithData.length > 0) {
        doc.moveDown(0.5);
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000').text('ALSÓ FOGAK', 50, doc.y);
        doc.moveDown(0.5);

        lowerTeethWithData.forEach(toothNumber => {
          const value = fogak[toothNumber];
          const normalized = normalizeToothData(value);
          const formattedText = formatToothDetail(toothNumber, normalized);
          
          if (formattedText) {
            doc.fontSize(10).font('Helvetica').fillColor('#000000').text(formattedText, 50, doc.y, { width: 495 });
            doc.moveDown(0.4);
          }
        });

        // Fábián- és Fejérdy-féle protetikai foghiányosztályozás for lower jaw
        if (patient.fabianFejerdyProtetikaiOsztalyAlso) {
          doc.moveDown(0.5);
          doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Fábián- és Fejérdy-féle protetikai foghiányosztályozás:', 50, doc.y);
          doc.fontSize(10).font('Helvetica').fillColor('#000000').text(patient.fabianFejerdyProtetikaiOsztalyAlso, 50, doc.y);
          doc.moveDown(0.5);
        } else {
          doc.moveDown(0.5);
          doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Fábián- és Fejérdy-féle protetikai foghiányosztályozás:', 50, doc.y);
          doc.moveDown(0.5);
        }
      }


      // Implants
      if ((patient.meglevoImplantatumok && Object.keys(patient.meglevoImplantatumok).length > 0) || patient.nemIsmertPoziciokbanImplantatum) {
        doc.moveDown(1);
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000').text('IMPLANTATUMOK', 50, doc.y);
        doc.moveDown(0.5);
        
        if (patient.meglevoImplantatumok && Object.keys(patient.meglevoImplantatumok).length > 0) {
          Object.keys(patient.meglevoImplantatumok)
            .sort((a, b) => parseInt(a) - parseInt(b))
            .forEach(toothNumber => {
              doc.fontSize(10).font('Helvetica').fillColor('#000000').text(`${toothNumber}. fog: ${patient.meglevoImplantatumok![toothNumber]}`, 50, doc.y);
              doc.moveDown(0.4);
            });
        }
        
        if (patient.nemIsmertPoziciokbanImplantatum) {
          doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Nem ismert pozíciókban implantátum', 50, doc.y);
          doc.moveDown(0.3);
          if (patient.nemIsmertPoziciokbanImplantatumRészletek) {
            doc.fontSize(9).font('Helvetica').fillColor('#4b5563').text(patient.nemIsmertPoziciokbanImplantatumRészletek, 60, doc.y, { width: 485 });
            doc.moveDown(0.4);
          }
        }
      }

      // Footer
      const footerY = Math.max(doc.y + 40, 750);
      doc.moveTo(50, footerY).lineTo(545, footerY).lineWidth(0.5).stroke('#000000');
      doc.fontSize(7).font('Helvetica').fillColor('#000000');
      
      // Left footer
      doc.text('Cím: 1088 Budapest, Szentkirályi utca 47.', 50, footerY + 8);
      doc.text('Postacím: 1085 Budapest, Üllői út 26.; 1428 Budapest Pf. 2.', 50, footerY + 16);
      doc.text('E-mail: fogpotlastan@dent.semmelweis-univ.hu', 50, footerY + 24);
      
      // Right footer
      const telText = 'Tel: 06-1 338-4380, 06-1 459-1500/59326';
      const telWidth = doc.widthOfString(telText);
      doc.text(telText, 545 - telWidth, footerY + 8);
      
      const faxText = 'Fax: (06-1) 317-5270';
      const faxWidth = doc.widthOfString(faxText);
      doc.text(faxText, 545 - faxWidth, footerY + 16);
      
      const webText = 'web: http://semmelweis-hu/fogpotlastan';
      const webWidth = doc.widthOfString(webText);
      doc.text(webText, 545 - webWidth, footerY + 24);

      doc.end();
    } catch (error) {
      (fs as any).readFileSync = originalReadFileSync;
      reject(error);
    }
  });
}

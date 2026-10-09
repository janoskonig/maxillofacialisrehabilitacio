import { rgb } from 'pdf-lib';
import type { Patient } from '@/lib/types';
import { buildDentalExportContent, dentalProsthesisLines, DENTAL_CODES } from '@/lib/neak-dental-content';
import { UPPER_ROW, LOWER_ROW, BASE_LABELS } from '@/components/patient-form/odontogram/tooth-conditions';
import { LAYOUT } from './layout';
import { ClinicalDocument } from './clinical-document';

/** The current saved odontogram, including both legacy and modern annotations. */
export async function generateDentalStatusPDF(patient: Partial<Patient>): Promise<Buffer> {
  const content = buildDentalExportContent(patient);
  const doc = await ClinicalDocument.create('Fogazati státusz', patient);
  doc.text('Jelenleg mentett állapot', 11, true);
  doc.text(content.notes[0], 9);
  doc.gap(8);

  doc.ensureSpace(132);
  const drawArch = (numbers: number[], label: string) => {
    doc.text(label, 10, true);
    const width = LAYOUT.contentWidth / 16;
    const top = doc.state.y;
    numbers.forEach((number, i) => {
      const row = content.rows.find((entry) => entry.number === number)!;
      const x = LAYOUT.margin + i * width;
      const hasImplant = Boolean(patient.meglevoImplantatumok?.[String(number)]);
      const code = hasImplant && !row.explicit ? 'I*' : row.code;
      doc.state.page.drawRectangle({
        x, y: top - 36, width, height: 36,
        borderColor: rgb(0.75, 0.78, 0.8), borderWidth: 0.5,
        color: row.base === 'missing' ? rgb(0.94, 0.94, 0.94) : rgb(0.97, 0.98, 0.99),
      });
      doc.state.page.drawText(String(number), { x: x + 5, y: top - 12, size: 8, font: doc.bold });
      const size = 7.5;
      const textWidth = doc.font.widthOfTextAtSize(code, size);
      doc.state.page.drawText(code, { x: x + (width - textWidth) / 2, y: top - 28, size, font: doc.font });
    });
    doc.gap(44);
  };
  drawArch(UPPER_ROW, 'Felső állcsont (FDI fogszámok)');
  drawArch(LOWER_ROW, 'Alsó állcsont (FDI fogszámok)');
  doc.text(content.notes[1], 8.5);
  doc.text('I*: külön implantátum-nyilvántartásban szerepel. D / +D: szuvasodás jelölése.', 8.5);
  doc.text('?: az alapállapot nincs külön megadva; a szöveges bejegyzés a részletes listában olvasható.', 8.5);
  doc.text(Object.entries(DENTAL_CODES).map(([base, code]) => `${code} = ${BASE_LABELS[base as keyof typeof BASE_LABELS]}`).join('; '), 8.5);

  if (content.hasStatus) {
    const { d, f, m, dmft } = content.index;
    doc.heading('Jelölésekből számított D/F/M összesítés');
    doc.text(`D: ${d} | F: ${f} | M: ${m} | D+F+M: ${dmft}`, 10, true);
    doc.text(content.notes[2], 8.5);
  }

  for (const [label, numbers, jaw] of [
    ['Felső állcsont - részletes státusz', UPPER_ROW, 'upper'],
    ['Alsó állcsont - részletes státusz', LOWER_ROW, 'lower'],
  ] as const) {
    doc.heading(label);
    const rows = numbers.map((number) => content.rows.find((row) => row.number === number)!).filter((row) => row.explicit);
    if (rows.length === 0) doc.text(content.hasStatus ? 'Nincs külön fogszintű bejegyzés.' : 'Nincs rögzített fogazati státusz.');
    for (const row of rows) doc.text(`${row.number}. fog: ${row.detail}`);
    doc.gap(5);
    for (const line of dentalProsthesisLines(patient, jaw)) doc.text(line);
  }

  doc.heading('Implantátumok');
  const implants = Object.entries(patient.meglevoImplantatumok ?? {}).sort(([a], [b]) => Number(a) - Number(b));
  const chartImplants = content.rows.filter((row) => row.explicit && row.base === 'implant');
  for (const [number, detail] of implants) doc.text(`${number}. pozíció: ${detail || 'Implantátum; részletek nincsenek megadva'}`);
  for (const row of chartImplants) {
    if (!implants.some(([number]) => number === String(row.number))) doc.text(`${row.number}. pozíció: az odontogramon jelölt implantátum; külön implantátum-adat nincs.`);
  }
  if (patient.nemIsmertPoziciokbanImplantatum) {
    doc.text('Ismeretlen pozícióban lévő implantátum is szerepel a nyilvántartásban.');
    if (patient.nemIsmertPoziciokbanImplantatumRészletek) doc.text(patient.nemIsmertPoziciokbanImplantatumRészletek);
  }
  if (implants.length === 0 && chartImplants.length === 0 && !patient.nemIsmertPoziciokbanImplantatum) {
    doc.text('Nincs rögzített implantátumadat.');
  }
  if (patient.fabianFejerdyProtetikaiOsztaly && !patient.fabianFejerdyProtetikaiOsztalyFelso && !patient.fabianFejerdyProtetikaiOsztalyAlso) {
    doc.heading('Korábban rögzített, állcsontmegjelölés nélküli osztályozás');
    doc.text(`Fábián-Fejérdy foghiányosztály: ${patient.fabianFejerdyProtetikaiOsztaly}`);
  }
  return doc.finish();
}

import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { generateDentalStatusPDF } from '@/lib/pdf/generateDentalStatusPDF';
import { generateTreatmentPlanPDF } from '@/lib/pdf/treatment-plan';
import { buildTreatmentExportContent } from '@/lib/neak-treatment-content';
import { neakClinicalPatient as patient, neakClinicalSources as sources } from '../fixtures/neak-clinical';

describe('NEAK clinical PDFs', () => {
  it('renders modern tooth annotations into a readable multipage PDF', async () => {
    const buffer = await generateDentalStatusPDF(patient);
    const pdf = await PDFDocument.load(buffer);
    expect(pdf.getTitle()).toBe('Fogazati státusz');
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    expect(buffer.length).toBeLessThan(700 * 1024);
  });
  it('wraps long tooth descriptions across pages without failing', async () => {
    const buffer = await generateDentalStatusPDF({
      ...patient, meglevoFogak: { '11': { base: 'crown', description: 'hosszú megjegyzés '.repeat(500) } },
    });
    const pdf = await PDFDocument.load(buffer);
    expect(pdf.getPageCount()).toBeGreaterThan(2);
  });
  it('renders the complete treatment content and handles multiline plans', async () => {
    const content = buildTreatmentExportContent(patient, sources);
    const pdf = await PDFDocument.load(await generateTreatmentPlanPDF(patient, content));
    expect(pdf.getTitle()).toBe('Kezelési terv');
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    const long = { ...content, sections: [{ title: 'Hosszú terv', lines: ['Tervmegjegyzés '.repeat(1200)] }] };
    const longPdf = await PDFDocument.load(await generateTreatmentPlanPDF(patient, long));
    expect(longPdf.getPageCount()).toBeGreaterThan(2);
  });
});

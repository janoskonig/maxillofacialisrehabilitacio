import type { Patient } from '@/lib/types';
import type { NeakTreatmentContent } from '@/lib/neak-treatment-content';
import { ClinicalDocument } from './clinical-document';

export async function generateTreatmentPlanPDF(patient: Partial<Patient>, content: NeakTreatmentContent): Promise<Buffer> {
  const doc = await ClinicalDocument.create('Kezelési terv', patient);
  for (const section of content.sections) {
    doc.heading(section.title);
    for (const line of section.lines) {
      doc.text(line);
      doc.gap(5);
    }
  }
  doc.heading('Megjegyzések');
  for (const note of content.notes) doc.text(note, 9);
  return doc.finish();
}

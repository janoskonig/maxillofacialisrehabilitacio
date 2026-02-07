/**
 * Dev-only: list form field names in the equity request PDF template.
 * Run from project root: npx tsx scripts/inspect-equity-template.ts
 */
import { PDFDocument } from 'pdf-lib';
import { readFileFromCandidates, projectRootCandidates } from '../lib/pdf/fs';

(async () => {
  const candidates = projectRootCandidates('public', 'templates', 'FNMT.152.K.pdf');
  const bytes = readFileFromCandidates(candidates);
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();
  const fields = form.getFields();
  const names = fields.map((f) => f.getName());
  console.log('Template form field names:');
  console.log(JSON.stringify(names, null, 2));
})();

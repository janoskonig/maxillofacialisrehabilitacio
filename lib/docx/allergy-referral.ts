import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { Patient } from '@/lib/types';
import { projectRootCandidates, readFileFromCandidates } from '@/lib/pdf/fs';

const TEMPLATE_NAME = 'Allergia vizsgálat kérése-formanyomtatvány.docx';

function getTemplateBytes(): Buffer {
  const candidates = projectRootCandidates('public', 'templates', TEMPLATE_NAME);
  return readFileFromCandidates(candidates);
}

function formatHungarianDate(date: Date): string {
  return `${date.getFullYear()}. ${String(date.getMonth() + 1).padStart(2, '0')}. ${String(date.getDate()).padStart(2, '0')}.`;
}

export function generateAllergyReferralDocx(patient: Patient): Buffer {
  const templateBytes = getTemplateBytes();
  const zip = new PizZip(templateBytes);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  const addressParts = [
    patient.iranyitoszam,
    patient.varos,
    patient.cim,
  ].filter(Boolean);

  doc.render({
    nev: patient.nev || '',
    szuletesi_hely_ido: patient.szuletesiDatum
      ? new Date(patient.szuletesiDatum).toLocaleDateString('hu-HU')
      : '',
    lakcim: addressParts.join(', '),
    taj: patient.taj || '',
    datum: formatHungarianDate(new Date()),
  });

  const buf = doc.getZip().generate({ type: 'nodebuffer' });
  return buf;
}

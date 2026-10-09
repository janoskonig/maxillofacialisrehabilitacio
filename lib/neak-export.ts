import { getChecklistStatus, requiredFieldSeverity, REQUIRED_DOC_RULES } from '@/lib/clinical-rules';
import { normalizeTags } from '@/lib/utils';
import type { NeakTreatmentContent } from '@/lib/neak-treatment-content';
import type { buildDentalExportContent } from '@/lib/neak-dental-content';
import type { Patient, PatientDocument } from '@/lib/types';

export const NEAK_EXPORT_LIMITS = {
  maxDocs: 200,
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
};

export interface NeakDocument {
  id: string;
  filename?: string;
  tags: unknown;
  fileSize?: number | string | null;
  filePath?: string;
  uploadedAt?: Date | string;
  createdAt?: Date | string;
}

export interface NeakIncludedDocument {
  id: string;
  filename?: string;
  tags: string[];
  sizeBytes: number;
  category: 'required' | 'quote' | 'allergy' | 'technikus_meltanyossagi';
}

export const NEAK_GENERATED_FILES = [
  'patient_summary.pdf', 'medical_history.pdf', 'dental_status.pdf',
  'equity_request_dental.pdf', 'equity_request_patient_data.pdf',
  'treatment_plan.pdf', 'treatment_plan.txt', 'quote_requests.txt', 'README.txt',
];

/** One plan for the preview and export. No physical-file availability claim. */
export function buildNeakExportPlan(patient: Patient, documents: NeakDocument[]) {
  const normalized = documents.map((doc) => ({
    ...doc,
    tags: Array.from(new Set(normalizeTags(doc.tags).map((tag) => tag.replace(/\./g, '')))),
  }));
  const checklist = getChecklistStatus(patient, normalized as unknown as PatientDocument[]);
  const missingFields = checklist.missingFields.filter((f) => requiredFieldSeverity(f) === 'error');
  const recommendedFields = checklist.missingFields.filter((f) => requiredFieldSeverity(f) === 'warning');
  const requiredTags = new Set(REQUIRED_DOC_RULES.flatMap((r) => normalizeTags(r.tag)));
  const time = (doc: NeakDocument) => {
    const value = doc.uploadedAt ?? doc.createdAt;
    const parsed = value instanceof Date ? value.getTime() : Date.parse(value ?? '');
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const quotes = normalized.filter((doc) => doc.tags.includes('arajanlat'))
    .sort((a, b) => time(b) - time(a) || b.id.localeCompare(a.id));
  const latestQuoteId = quotes[0]?.id;
  const includedDocuments: NeakIncludedDocument[] = [];
  for (const doc of normalized) {
    let category: NeakIncludedDocument['category'] | undefined;
    if (doc.tags.some((tag) => requiredTags.has(tag))) category = 'required';
    else if (doc.tags.includes('technikusmeltanyossagi')) category = 'technikus_meltanyossagi';
    else if (doc.id === latestQuoteId) category = 'quote';
    else if (doc.tags.includes('allergiavizsgalat')) category = 'allergy';
    if (category) {
      const size = Number(doc.fileSize ?? 0);
      includedDocuments.push({
        id: doc.id, filename: doc.filename, tags: doc.tags,
        sizeBytes: Number.isFinite(size) && size >= 0 ? size : 0, category,
      });
    }
  }
  includedDocuments.sort((a, b) => a.id.localeCompare(b.id));
  const estimatedTotalBytes = includedDocuments.reduce((sum, doc) => sum + doc.sizeBytes, 0);
  const limitErrors: Array<{ code: string; message: string }> = [];
  if (includedDocuments.length > NEAK_EXPORT_LIMITS.maxDocs) {
    limitErrors.push({ code: 'TOO_MANY_DOCS', message: 'Legfeljebb 200 melléklet exportálható.' });
  }
  if (includedDocuments.some((doc) => doc.sizeBytes > NEAK_EXPORT_LIMITS.maxFileBytes)) {
    limitErrors.push({ code: 'FILE_TOO_LARGE', message: 'Egy melléklet mérete meghaladja az 50 MB-ot.' });
  }
  if (estimatedTotalBytes > NEAK_EXPORT_LIMITS.maxTotalBytes) {
    limitErrors.push({ code: 'ZIP_TOO_LARGE', message: 'A mellékletek összmérete meghaladja a 200 MB-ot.' });
  }
  const warnings = [
    ...recommendedFields.map((f) => `Ajánlott adat hiányzik: ${f.label}.`),
    'A páciensnyomtatványon a születési helyet és az anyja nevét kézzel kell kitölteni.',
    'Az ellenőrzés a rögzített adatokra vonatkozik; a mellékletek elérhetősége letöltéskor derül ki.',
  ];
  return {
    isReady: missingFields.length === 0 && checklist.missingDocs.length === 0 && limitErrors.length === 0,
    missingFields: missingFields.map(({ key, label }) => ({ key, label })),
    missingDocTags: checklist.missingDocs.map((r) => r.tag),
    missingDocRules: checklist.missingDocs,
    includedDocuments, estimatedTotalBytes, limitErrors, warnings,
    generatedFiles: NEAK_GENERATED_FILES,
    protocolVersion: checklist.protocolVersion,
    checklistSummary: {
      missingFields: missingFields.length, missingDocs: checklist.missingDocs.length,
      hasErrors: missingFields.length > 0 || checklist.missingDocs.length > 0 || limitErrors.length > 0,
    },
  };
}

export type NeakExportPlan = ReturnType<typeof buildNeakExportPlan> & {
  treatmentContent?: NeakTreatmentContent;
  dentalContent?: ReturnType<typeof buildDentalExportContent>;
};

/** Clear the deadline even when a download fails or resolves immediately. */
export async function withNeakDownloadTimeout<T>(download: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      download,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('A melléklet letöltése túllépte az időkorlátot.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

import type { PatientDocumentAnnotation } from '@/lib/types/document-annotation';

const BATCH_MAX = 80;

export async function fetchAnnotationsBatchForPatient(
  patientId: string,
  documentIds: string[],
): Promise<Record<string, PatientDocumentAnnotation[]>> {
  const raw = documentIds.filter(Boolean);
  const unique = raw.filter((id, i) => raw.indexOf(id) === i);
  const merged: Record<string, PatientDocumentAnnotation[]> = {};
  for (const id of unique) merged[id] = [];

  for (let i = 0; i < unique.length; i += BATCH_MAX) {
    const chunk = unique.slice(i, i + BATCH_MAX);
    if (chunk.length === 0) continue;
    const res = await fetch(
      `/api/patients/${patientId}/documents/annotations-batch?ids=${chunk.join(',')}`,
      { credentials: 'include' },
    );
    if (!res.ok) throw new Error('annotations_batch_failed');
    const data = (await res.json()) as { byDocumentId?: Record<string, PatientDocumentAnnotation[]> };
    const by = data.byDocumentId ?? {};
    for (const [k, v] of Object.entries(by)) {
      merged[k] = Array.isArray(v) ? v : [];
    }
  }
  return merged;
}

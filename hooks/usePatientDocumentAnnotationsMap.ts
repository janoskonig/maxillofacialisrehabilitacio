'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PatientDocumentAnnotation } from '@/lib/types/document-annotation';
import { fetchAnnotationsBatchForPatient } from '@/lib/document-annotations-batch-client';

/** `documentIds`: lehetőleg `useMemo` — stabil referencia elkerüli a felesleges fetch-et. */
export function usePatientDocumentAnnotationsMap(
  patientId: string | null | undefined,
  documentIds: readonly string[],
): {
  byDocumentId: Record<string, PatientDocumentAnnotation[]>;
  refresh: () => void;
} {
  const [byDocumentId, setByDocumentId] = useState<Record<string, PatientDocumentAnnotation[]>>({});

  const refresh = useCallback(() => {
    if (!patientId || documentIds.length === 0) {
      setByDocumentId({});
      return;
    }
    void fetchAnnotationsBatchForPatient(patientId, [...documentIds])
      .then(setByDocumentId)
      .catch(() => setByDocumentId({}));
  }, [patientId, documentIds]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { byDocumentId, refresh };
}

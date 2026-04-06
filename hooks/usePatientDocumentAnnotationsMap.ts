'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PatientDocumentAnnotation } from '@/lib/types/document-annotation';
import { fetchAnnotationsBatchForPatient } from '@/lib/document-annotations-batch-client';

const IDS_SEP = '\u0001';

/** `documentIds`: stabil tartalom elég; új tömbreferencia ugyanazzal a tartalommal nem indít felesleges fetch-et. */
export function usePatientDocumentAnnotationsMap(
  patientId: string | null | undefined,
  documentIds: readonly string[],
): {
  byDocumentId: Record<string, PatientDocumentAnnotation[]>;
  refresh: () => void;
} {
  const [byDocumentId, setByDocumentId] = useState<Record<string, PatientDocumentAnnotation[]>>({});

  const documentIdsKey = useMemo(
    () =>
      Array.from(new Set((documentIds as string[]).filter(Boolean)))
        .sort()
        .join(IDS_SEP),
    [documentIds],
  );

  const fetchGenRef = useRef(0);

  const refresh = useCallback(() => {
    if (!patientId || documentIdsKey.length === 0) {
      setByDocumentId({});
      return;
    }
    const ids = documentIdsKey.split(IDS_SEP);
    const gen = ++fetchGenRef.current;
    void fetchAnnotationsBatchForPatient(patientId, ids)
      .then((data) => {
        if (fetchGenRef.current === gen) setByDocumentId(data);
      })
      .catch(() => {
        if (fetchGenRef.current === gen) setByDocumentId({});
      });
  }, [patientId, documentIdsKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { byDocumentId, refresh };
}

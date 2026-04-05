import type { FreehandPayloadV1, TextPayloadV1 } from '@/lib/document-annotations-schema';

export type PatientDocumentAnnotationKind = 'freehand' | 'text';

export type PatientDocumentAnnotationPayload = FreehandPayloadV1 | TextPayloadV1;

export type PatientDocumentAnnotation = {
  id: string;
  documentId: string;
  patientId: string;
  kind: PatientDocumentAnnotationKind;
  payload: PatientDocumentAnnotationPayload;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

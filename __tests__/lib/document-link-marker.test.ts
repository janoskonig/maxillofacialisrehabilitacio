import { describe, it, expect } from 'vitest';
import {
  buildDocumentLinkMarker,
  parseDocumentLinkMarker,
  insertDocumentLinkIntoMessage,
} from '@/lib/messaging/document-link-marker';

const DOC_ID = '550e8400-e29b-41d4-a716-446655440000';
const PATIENT_ID = '660e8400-e29b-41d4-a716-446655440001';

describe('document-link-marker', () => {
  it('builds patient-doctor marker with empty patient segment', () => {
    expect(
      buildDocumentLinkMarker({
        tag: 'op',
        patientId: PATIENT_ID,
        documentId: DOC_ID,
        chatType: 'patient-doctor',
      }),
    ).toBe(`[DOCUMENT_UPLOADED:op::${DOC_ID}]`);
  });

  it('builds doctor-doctor marker with patient id', () => {
    expect(
      buildDocumentLinkMarker({
        tag: 'foto',
        patientId: PATIENT_ID,
        documentId: DOC_ID,
        chatType: 'doctor-doctor',
      }),
    ).toBe(`[DOCUMENT_UPLOADED:foto:${PATIENT_ID}:${DOC_ID}]`);
  });

  it('parses three-part marker', () => {
    const parsed = parseDocumentLinkMarker(
      `[DOCUMENT_UPLOADED:op:${PATIENT_ID}:${DOC_ID}]`,
    );
    expect(parsed).toEqual({
      tag: 'op',
      patientId: PATIENT_ID,
      documentId: DOC_ID,
    });
  });

  it('parses patient-doctor marker with empty patient segment', () => {
    const parsed = parseDocumentLinkMarker(`[DOCUMENT_UPLOADED:op::${DOC_ID}]`);
    expect(parsed).toEqual({
      tag: 'op',
      patientId: null,
      documentId: DOC_ID,
    });
  });

  it('parses legacy two-part marker (tag:documentId)', () => {
    const parsed = parseDocumentLinkMarker(`[DOCUMENT_UPLOADED:op:${DOC_ID}]`);
    expect(parsed).toEqual({
      tag: 'op',
      patientId: null,
      documentId: DOC_ID,
    });
  });

  it('inserts marker on new line when text exists', () => {
    expect(insertDocumentLinkIntoMessage('Szia', `[DOCUMENT_UPLOADED:op::${DOC_ID}]`)).toBe(
      `Szia\n[DOCUMENT_UPLOADED:op::${DOC_ID}]`,
    );
  });
});

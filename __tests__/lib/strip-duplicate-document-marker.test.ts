import { describe, it, expect } from 'vitest';
import {
  stripDocumentMarkerIfContextLinked,
  hideDocumentLinksRenderedInline,
} from '@/lib/messaging/strip-duplicate-document-marker';
import type { MessageContextLink } from '@/lib/types/messaging';

const DOC_ID = '550e8400-e29b-41d4-a716-446655440000';

function docLink(overrides: Partial<MessageContextLink> = {}): MessageContextLink {
  return {
    id: '1',
    channel: 'patient',
    messageId: 'm1',
    entityType: 'document',
    entityId: DOC_ID,
    createdAt: new Date(),
    createdBy: 'u1',
    ...overrides,
  };
}

describe('stripDocumentMarkerIfContextLinked', () => {
  it('strips marker when structured document link exists', () => {
    const text = `Szia\n[DOCUMENT_UPLOADED:op::${DOC_ID}]`;
    expect(stripDocumentMarkerIfContextLinked(text, [docLink()])).toBe('Szia');
  });

  it('keeps marker when no matching link', () => {
    const text = `[DOCUMENT_UPLOADED:op::${DOC_ID}]`;
    expect(stripDocumentMarkerIfContextLinked(text, [])).toBe(text);
  });

  it('keeps marker for image documents (rendered inline instead of the chip)', () => {
    const text = `Nézd\n[DOCUMENT_UPLOADED:chat::${DOC_ID}]`;
    const links = [docLink({ preview: { label: 'x.jpg', mimeType: 'image/jpeg' } })];
    expect(stripDocumentMarkerIfContextLinked(text, links)).toBe(text);
  });

  it('still strips for non-image documents with preview', () => {
    const text = `Lelet\n[DOCUMENT_UPLOADED:zarojelentes::${DOC_ID}]`;
    const links = [docLink({ preview: { label: 'lelet.pdf', mimeType: 'application/pdf' } })];
    expect(stripDocumentMarkerIfContextLinked(text, links)).toBe('Lelet');
  });
});

describe('hideDocumentLinksRenderedInline', () => {
  it('hides the image document chip when the marker renders it inline', () => {
    const text = `[DOCUMENT_UPLOADED:chat::${DOC_ID}]`;
    const image = docLink({ id: 'img', preview: { label: 'x.jpg', mimeType: 'image/png' } });
    const other = docLink({ id: 'pat', entityType: 'patient', entityId: 'p1' });
    expect(hideDocumentLinksRenderedInline(text, [image, other])).toEqual([other]);
  });

  it('keeps non-image document chips and links without preview', () => {
    const text = `[DOCUMENT_UPLOADED:op::${DOC_ID}]`;
    const pdf = docLink({ id: 'pdf', preview: { label: 'a.pdf', mimeType: 'application/pdf' } });
    const noPreview = docLink({ id: 'np' });
    expect(hideDocumentLinksRenderedInline(text, [pdf])).toEqual([pdf]);
    expect(hideDocumentLinksRenderedInline(text, [noPreview])).toEqual([noPreview]);
  });

  it('returns links unchanged when there is no marker', () => {
    const image = docLink({ preview: { label: 'x.jpg', mimeType: 'image/jpeg' } });
    expect(hideDocumentLinksRenderedInline('szöveg', [image])).toEqual([image]);
    expect(hideDocumentLinksRenderedInline('szöveg', undefined)).toEqual([]);
  });
});

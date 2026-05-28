import { describe, it, expect } from 'vitest';
import { stripDocumentMarkerIfContextLinked } from '@/lib/messaging/strip-duplicate-document-marker';
import type { MessageContextLink } from '@/lib/types/messaging';

const DOC_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('stripDocumentMarkerIfContextLinked', () => {
  it('strips marker when structured document link exists', () => {
    const text = `Szia\n[DOCUMENT_UPLOADED:op::${DOC_ID}]`;
    const links: MessageContextLink[] = [
      {
        id: '1',
        channel: 'patient',
        messageId: 'm1',
        entityType: 'document',
        entityId: DOC_ID,
        createdAt: new Date(),
        createdBy: 'u1',
      },
    ];
    expect(stripDocumentMarkerIfContextLinked(text, links)).toBe('Szia');
  });

  it('keeps marker when no matching link', () => {
    const text = `[DOCUMENT_UPLOADED:op::${DOC_ID}]`;
    expect(stripDocumentMarkerIfContextLinked(text, [])).toBe(text);
  });
});

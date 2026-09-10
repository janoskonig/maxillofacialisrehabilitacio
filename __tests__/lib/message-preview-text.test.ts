import { describe, it, expect } from 'vitest';
import {
  humanizeMessagePreview,
  messageHasTextBesidesMarkers,
  IMAGE_PREVIEW_LABEL,
  DOCUMENT_PREVIEW_LABEL,
  CONSILIUM_PREP_PREVIEW_LABEL,
} from '@/lib/messaging/message-preview-text';

const DOC_ID = '550e8400-e29b-41d4-a716-446655440000';
const PATIENT_ID = '660e8400-e29b-41d4-a716-446655440001';

describe('humanizeMessagePreview', () => {
  it('replaces chat image marker with the image label', () => {
    expect(humanizeMessagePreview(`[CHAT_IMAGE:${DOC_ID}]`)).toBe(IMAGE_PREVIEW_LABEL);
  });

  it('treats chat-tagged document markers as images', () => {
    expect(humanizeMessagePreview(`[DOCUMENT_UPLOADED:chat:${PATIENT_ID}:${DOC_ID}]`)).toBe(IMAGE_PREVIEW_LABEL);
    expect(humanizeMessagePreview(`[DOCUMENT_UPLOADED:chat::${DOC_ID}]`)).toBe(IMAGE_PREVIEW_LABEL);
  });

  it('labels other document markers as documents (3-part and legacy 2-part)', () => {
    expect(humanizeMessagePreview(`[DOCUMENT_UPLOADED:op:${PATIENT_ID}:${DOC_ID}]`)).toBe(DOCUMENT_PREVIEW_LABEL);
    expect(humanizeMessagePreview(`[DOCUMENT_UPLOADED:op:${DOC_ID}]`)).toBe(DOCUMENT_PREVIEW_LABEL);
    expect(humanizeMessagePreview(`[DOCUMENT_UPLOADED:::${DOC_ID}]`)).toBe(DOCUMENT_PREVIEW_LABEL);
  });

  it('keeps caption text and collapses whitespace', () => {
    expect(humanizeMessagePreview(`Nézd meg\n[CHAT_IMAGE:${DOC_ID}]`)).toBe(`Nézd meg ${IMAGE_PREVIEW_LABEL}`);
  });

  it('labels consilium prep markers', () => {
    expect(humanizeMessagePreview('[CONSILIUM_PREP:abc_DEF-123]')).toBe(CONSILIUM_PREP_PREVIEW_LABEL);
  });

  it('returns empty string for empty input and plain text unchanged', () => {
    expect(humanizeMessagePreview(null)).toBe('');
    expect(humanizeMessagePreview(undefined)).toBe('');
    expect(humanizeMessagePreview('  Szia   Doki ')).toBe('Szia Doki');
  });
});

describe('messageHasTextBesidesMarkers', () => {
  it('is false for marker-only messages', () => {
    expect(messageHasTextBesidesMarkers(`[CHAT_IMAGE:${DOC_ID}]`)).toBe(false);
    expect(messageHasTextBesidesMarkers(`[DOCUMENT_UPLOADED:chat::${DOC_ID}]\n`)).toBe(false);
  });

  it('is true when a caption is present', () => {
    expect(messageHasTextBesidesMarkers(`Ez itt\n[CHAT_IMAGE:${DOC_ID}]`)).toBe(true);
  });
});

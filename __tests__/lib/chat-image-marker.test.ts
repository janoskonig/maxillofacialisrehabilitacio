import { describe, it, expect } from 'vitest';
import {
  buildChatImageMarker,
  parseChatImageMarker,
  extractChatImageAttachmentIds,
} from '@/lib/messaging/chat-image-marker';

const ID = '550e8400-e29b-41d4-a716-446655440000';
const ID2 = '660e8400-e29b-41d4-a716-446655440001';

describe('chat-image-marker', () => {
  it('builds [CHAT_IMAGE:<id>]', () => {
    expect(buildChatImageMarker(ID)).toBe(`[CHAT_IMAGE:${ID}]`);
  });

  it('parses marker with surrounding text and reports its position', () => {
    const text = `Nézd meg\n[CHAT_IMAGE:${ID}]\nmit gondolsz?`;
    const parsed = parseChatImageMarker(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.attachmentId).toBe(ID);
    expect(text.slice(parsed!.start, parsed!.end)).toBe(`[CHAT_IMAGE:${ID}]`);
  });

  it('ignores markers whose id is not a UUID', () => {
    expect(parseChatImageMarker('[CHAT_IMAGE:not-an-id]')).toBeNull();
    expect(parseChatImageMarker('[CHAT_IMAGE:../etc/passwd]')).toBeNull();
  });

  it('returns null for text without marker', () => {
    expect(parseChatImageMarker('sima szöveg')).toBeNull();
    expect(parseChatImageMarker('')).toBeNull();
  });

  it('extracts all unique attachment ids in order', () => {
    const text = `[CHAT_IMAGE:${ID}] szöveg [CHAT_IMAGE:${ID2}] [CHAT_IMAGE:${ID.toUpperCase()}] [CHAT_IMAGE:x]`;
    expect(extractChatImageAttachmentIds(text)).toEqual([ID, ID2]);
  });
});

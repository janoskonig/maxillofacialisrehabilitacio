import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReplyState } from '@/components/messaging/useReplyState';
import type { QuotedMessagePreview } from '@/lib/types/messaging';

const sample: QuotedMessagePreview = {
  id: '11111111-1111-4111-8111-111111111111',
  channel: 'doctor',
  senderId: '22222222-2222-4222-8222-222222222222',
  senderName: 'Dr. Teszt',
  message: 'parent',
  createdAt: new Date('2026-05-27T08:00:00Z'),
  deleted: false,
};

describe('useReplyState', () => {
  it('defaults to no reply', () => {
    const { result } = renderHook(() => useReplyState());
    expect(result.current.replyTarget).toBeNull();
    expect(result.current.replyToMessageId).toBeNull();
    expect(result.current.isReplying).toBe(false);
  });

  it('accepts initial target', () => {
    const { result } = renderHook(() => useReplyState(sample));
    expect(result.current.isReplying).toBe(true);
    expect(result.current.replyToMessageId).toBe(sample.id);
  });

  it('setReplyTarget switches to reply mode', () => {
    const { result } = renderHook(() => useReplyState());
    act(() => result.current.setReplyTarget(sample));
    expect(result.current.isReplying).toBe(true);
    expect(result.current.replyTarget).toEqual(sample);
    expect(result.current.replyToMessageId).toBe(sample.id);
  });

  it('clearReply resets state', () => {
    const { result } = renderHook(() => useReplyState(sample));
    act(() => result.current.clearReply());
    expect(result.current.isReplying).toBe(false);
    expect(result.current.replyTarget).toBeNull();
    expect(result.current.replyToMessageId).toBeNull();
  });

  it('setReplyTarget(null) clears too', () => {
    const { result } = renderHook(() => useReplyState(sample));
    act(() => result.current.setReplyTarget(null));
    expect(result.current.isReplying).toBe(false);
  });
});

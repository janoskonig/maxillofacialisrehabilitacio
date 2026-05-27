import { describe, expect, it } from 'vitest';
import {
  filterMessagesByThreadCollapse,
  isDirectReplyVisible,
  countHiddenDirectReplies,
} from '@/lib/messaging/reply-thread-visibility';
import { replyThreadToggleLabel } from '@/components/messaging/reply-thread-label';

describe('reply-thread-visibility (Fázis 4.2)', () => {
  const messages = [
    { id: 'p1', replyToMessageId: null },
    { id: 'r1', replyToMessageId: 'p1' },
    { id: 'r2', replyToMessageId: 'p1' },
    { id: 'p2', replyToMessageId: null },
  ];

  it('shows all messages when nothing collapsed', () => {
    expect(filterMessagesByThreadCollapse(messages, new Set())).toHaveLength(4);
  });

  it('hides direct replies when parent collapsed', () => {
    const collapsed = new Set(['p1']);
    expect(filterMessagesByThreadCollapse(messages, collapsed)).toEqual([
      messages[0],
      messages[3],
    ]);
    expect(countHiddenDirectReplies(messages, 'p1', collapsed)).toBe(2);
  });

  it('isDirectReplyVisible respects parent collapse only', () => {
    const collapsed = new Set(['p1']);
    expect(isDirectReplyVisible({ replyToMessageId: 'p1' }, collapsed)).toBe(false);
    expect(isDirectReplyVisible({ replyToMessageId: null }, collapsed)).toBe(true);
  });
});

describe('replyThreadToggleLabel (Fázis 4.2)', () => {
  it('labels expand vs collapse states', () => {
    expect(replyThreadToggleLabel(3, false)).toContain('összecsukás');
    expect(replyThreadToggleLabel(3, true)).toContain('megjelenítés');
  });
});

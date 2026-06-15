import { describe, it, expect } from 'vitest';
import { decorateMessages, dayLabel } from '@/lib/messaging/group-messages';

interface M {
  senderId: string;
  createdAt: Date;
}

/**
 * Helyi idő szerinti Date — szándékosan NEM UTC, hogy a nap-határ tesztek
 * időzóna-függetlenek legyenek (a `decorateMessages` `isSameDay`-je helyi idő
 * szerint dolgozik). Formátum: "YYYY-MM-DD HH:MM".
 */
function at(local: string): Date {
  const [date, time] = local.split(' ');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = (time ?? '00:00').split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi);
}

describe('dayLabel', () => {
  it('returns "Ma" for today', () => {
    expect(dayLabel(new Date())).toBe('Ma');
  });

  it('returns "Tegnap" for yesterday', () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    expect(dayLabel(d)).toBe('Tegnap');
  });

  it('returns a Hungarian long date for older days', () => {
    // 2020. január 5. — locale-formázott, ellenőrizzük a felépítést.
    const label = dayLabel(at('2020-01-05 10:00'));
    expect(label).toMatch(/^2020\. .+ 5\.$/);
  });
});

describe('decorateMessages', () => {
  it('returns an empty array for no messages', () => {
    expect(decorateMessages([])).toEqual([]);
  });

  it('shows a day separator on the first message', () => {
    const out = decorateMessages<M>([{ senderId: 'a', createdAt: at('2024-03-01 08:00') }]);
    expect(out[0].showDaySeparator).toBe(true);
    expect(out[0].dayLabel).not.toBeNull();
    expect(out[0].isFirstInGroup).toBe(true);
    expect(out[0].isLastInGroup).toBe(true);
  });

  it('shows a separator only when the day changes', () => {
    const out = decorateMessages<M>([
      { senderId: 'a', createdAt: at('2024-03-01 08:00') },
      { senderId: 'a', createdAt: at('2024-03-01 08:01') },
      { senderId: 'a', createdAt: at('2024-03-02 09:00') },
    ]);
    expect(out.map((o) => o.showDaySeparator)).toEqual([true, false, true]);
  });

  it('groups consecutive messages from the same sender within the time window', () => {
    const out = decorateMessages<M>([
      { senderId: 'a', createdAt: at('2024-03-01 08:00') },
      { senderId: 'a', createdAt: at('2024-03-01 08:01') },
      { senderId: 'a', createdAt: at('2024-03-01 08:02') },
    ]);
    expect(out.map((o) => o.isFirstInGroup)).toEqual([true, false, false]);
    expect(out.map((o) => o.isLastInGroup)).toEqual([false, false, true]);
  });

  it('breaks the group when the sender changes', () => {
    const out = decorateMessages<M>([
      { senderId: 'a', createdAt: at('2024-03-01 08:00') },
      { senderId: 'b', createdAt: at('2024-03-01 08:01') },
    ]);
    expect(out[0].isLastInGroup).toBe(true);
    expect(out[1].isFirstInGroup).toBe(true);
  });

  it('breaks the group when messages are more than 5 minutes apart', () => {
    const out = decorateMessages<M>([
      { senderId: 'a', createdAt: at('2024-03-01 08:00') },
      { senderId: 'a', createdAt: at('2024-03-01 08:10') },
    ]);
    expect(out[0].isLastInGroup).toBe(true);
    expect(out[1].isFirstInGroup).toBe(true);
  });

  it('breaks the group across a day boundary even for the same sender', () => {
    const out = decorateMessages<M>([
      { senderId: 'a', createdAt: at('2024-03-01 23:59') },
      { senderId: 'a', createdAt: at('2024-03-02 00:01') },
    ]);
    // Új nap → külön blokk, külön elválasztó.
    expect(out[1].showDaySeparator).toBe(true);
    expect(out[0].isLastInGroup).toBe(true);
    expect(out[1].isFirstInGroup).toBe(true);
  });

  it('accepts ISO string createdAt values', () => {
    const out = decorateMessages([
      { senderId: 'a', createdAt: '2024-03-01T08:00:00Z' },
      { senderId: 'a', createdAt: '2024-03-01T08:01:00Z' },
    ]);
    expect(out[0].isFirstInGroup).toBe(true);
    expect(out[1].isLastInGroup).toBe(true);
  });
});

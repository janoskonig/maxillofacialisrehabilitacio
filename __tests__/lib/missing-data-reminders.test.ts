import { describe, it, expect } from 'vitest';
import { dedupeRecipients, formatMissingSummary } from '@/lib/missing-data-reminders';
import type { MissingItem } from '@/lib/patient-data-completeness';

describe('dedupeRecipients', () => {
  const referrer = {
    userId: 'u1',
    email: 'ref@example.com',
    name: 'Dr. Beutaló',
    role: 'beutalo_orvos' as const,
  };
  const prosthodontist = {
    userId: 'u2',
    email: 'fog@example.com',
    name: 'Dr. Fogpótlás',
    role: 'fogpótlástanász' as const,
  };

  it('keeps distinct recipients', () => {
    expect(dedupeRecipients([referrer, prosthodontist])).toHaveLength(2);
  });

  it('drops nulls (e.g. unresolvable referrer)', () => {
    const out = dedupeRecipients([null, prosthodontist]);
    expect(out).toHaveLength(1);
    expect(out[0].userId).toBe('u2');
  });

  it('deduplicates the same user appearing in both roles', () => {
    const sameAsReferrer = { ...prosthodontist, userId: 'u1' };
    const out = dedupeRecipients([referrer, sameAsReferrer]);
    expect(out).toHaveLength(1);
    expect(out[0].userId).toBe('u1');
    // First occurrence wins
    expect(out[0].role).toBe('beutalo_orvos');
  });

  it('skips recipients without an email address', () => {
    const noEmail = { ...prosthodontist, email: '' };
    expect(dedupeRecipients([noEmail])).toHaveLength(0);
  });

  it('returns empty for all-null input', () => {
    expect(dedupeRecipients([null, null])).toEqual([]);
  });
});

describe('formatMissingSummary', () => {
  it('joins labels with commas', () => {
    const items: MissingItem[] = [
      { key: 'taj', label: 'TAJ', group: 'clinical' },
      { key: 'diagnozis', label: 'Diagnózis', group: 'clinical' },
      { key: 'ohipT0', label: 'OHIP-14 kiindulási (T0) kitöltés', group: 'research' },
    ];
    expect(formatMissingSummary(items)).toBe(
      'TAJ, Diagnózis, OHIP-14 kiindulási (T0) kitöltés'
    );
  });

  it('returns empty string for no items', () => {
    expect(formatMissingSummary([])).toBe('');
  });
});

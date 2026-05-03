/**
 * Unit tests for `lib/unsuccessful-attempt-templates.ts` — the canonical
 * reason templates introduced in PR 4 to keep the modal chips and the admin
 * statistics grouping in lockstep.
 */

import { describe, it, expect } from 'vitest';
import {
  UNSUCCESSFUL_REASON_TEMPLATES,
  matchReasonTemplate,
} from '@/lib/unsuccessful-attempt-templates';

describe('UNSUCCESSFUL_REASON_TEMPLATES', () => {
  it('contains exactly 5 templates (modal chip count)', () => {
    expect(UNSUCCESSFUL_REASON_TEMPLATES).toHaveLength(5);
  });

  it('templates are all non-empty unique strings', () => {
    const set = new Set<string>(UNSUCCESSFUL_REASON_TEMPLATES);
    expect(set.size).toBe(UNSUCCESSFUL_REASON_TEMPLATES.length);
    for (const t of UNSUCCESSFUL_REASON_TEMPLATES) {
      expect(typeof t).toBe('string');
      expect(t.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('matchReasonTemplate', () => {
  it('returns null for null/undefined/empty input', () => {
    expect(matchReasonTemplate(null)).toBeNull();
    expect(matchReasonTemplate(undefined)).toBeNull();
    expect(matchReasonTemplate('')).toBeNull();
    expect(matchReasonTemplate('   ')).toBeNull();
  });

  it('returns the canonical template when text matches exactly', () => {
    for (const t of UNSUCCESSFUL_REASON_TEMPLATES) {
      expect(matchReasonTemplate(t)).toBe(t);
    }
  });

  it('matches case-insensitively after trim', () => {
    const t = UNSUCCESSFUL_REASON_TEMPLATES[0];
    expect(matchReasonTemplate(t.toUpperCase())).toBe(t);
    expect(matchReasonTemplate(`  ${t.toLowerCase()}  `)).toBe(t);
  });

  it('returns null for free-form text that resembles but does not match a template', () => {
    expect(matchReasonTemplate('rossz lenyomat')).toBeNull();
    expect(matchReasonTemplate('beteg ideges volt')).toBeNull();
    expect(matchReasonTemplate('Lenyomat hibás')).toBeNull();
  });

  it('does NOT do fuzzy / partial matching (deliberate to keep grouping deterministic)', () => {
    // The first canonical template is "Lenyomat torzult / nem értékelhető".
    // A substring or a misspelling must NOT match — otherwise the stats
    // grouping would silently merge unrelated free-text reasons.
    expect(matchReasonTemplate('Lenyomat torzult')).toBeNull();
    expect(matchReasonTemplate('Lenyomat torzult, ujra')).toBeNull();
  });
});

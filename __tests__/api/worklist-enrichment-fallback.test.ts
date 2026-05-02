/**
 * Regression test for the worklist BOOKED enrichment fallback.
 *
 * The bug: the third match fallback in the BOOKED enrichment of
 * `app/api/worklists/wip-next-appointments/route.ts` originally pulled the
 * EARLIEST future booking of the episode onto any row with `stepSeq === 0`.
 * In practice this meant Anatómiai lenyomat (seq 0) — which had no booking
 * of its own — falsely displayed K2 (Kontroll 2, seq 5)'s szept. 3. 08:30
 * appointment as if it were Anat's. The user understandably interpreted the
 * worklist as "Anat is already booked" while bulk-convert kept trying (and
 * failing) to book it.
 *
 * The fix: the episodeMap fallback is now restricted to TRUE legacy rows —
 * appointments that lack BOTH `step_code` AND `step_seq`. Modern appointments
 * with step identity match through exactMap or stepSeqMap; if they don't, they
 * belong to a different step and must NOT bleed up to seq=0.
 *
 * Pure source-shape regression: this guards against a future refactor that
 * could re-introduce the unconditional episode-wide fallback.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'app',
    'api',
    'worklists',
    'wip-next-appointments',
    'route.ts'
  ),
  'utf8'
);

describe('worklist enrichment — episodeMap fallback restriction (regression)', () => {
  it('BookedEntry tracks hasStepIdentity (false only for true legacy rows)', () => {
    expect(SRC).toMatch(/hasStepIdentity:\s*boolean/);
    // The flag must be derived from BOTH columns being absent — either of the
    // two present means the row belongs to an identifiable step.
    expect(SRC).toMatch(
      /hasStepIdentity\s*=\s*row\.step_code\s*!=\s*null\s*\|\|\s*row\.step_seq\s*!=\s*null/
    );
  });

  it('episodeMap fallback only fires when the candidate has NO step identity', () => {
    // Pin the gating: the fallback now requires `epFallbackCandidate &&
    // !epFallbackCandidate.hasStepIdentity`. Previously it was just
    // `episodeMap.get(item.episodeId)` — which over-attached.
    expect(SRC).toMatch(
      /epFallbackCandidate\s*&&\s*!epFallbackCandidate\.hasStepIdentity/
    );
  });

  it('still scopes the fallback to seq=0 / undefined-seq rows', () => {
    // The fallback is for the FIRST step only; later steps must rely on
    // exact / seq matches so we never silently project the wrong appointment.
    expect(SRC).toMatch(
      /item\.stepSeq\s*===\s*0\s*\|\|\s*item\.stepSeq\s*===\s*undefined/
    );
  });

  it('does NOT keep the unconditional `(seq===0||undefined) && episodeMap.get(...)` fallback', () => {
    // The pre-fix expression was a single chained `||` straight to the map.
    // The new code splits it into a candidate variable + identity gate, so
    // the unconditional pattern must no longer appear inside the booked
    // composition.
    expect(SRC).not.toMatch(
      /\|\|\s*\(\(item\.stepSeq\s*===\s*0\s*\|\|\s*item\.stepSeq\s*===\s*undefined\)\s*&&\s*episodeMap\.get\(item\.episodeId\)\)/
    );
  });
});

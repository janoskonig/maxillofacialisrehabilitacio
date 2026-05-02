/**
 * Regression test for the convert-all-intents chain-anchor logic.
 *
 * The previous implementation derived the next intent's `chainMinStartTime`
 * from `prevActualStart + (currSuggested - prevSuggestedStart)`. This was
 * SUPPOSED to mirror the pathway gap, but in practice the projector's
 * `suggested_start` values are themselves chained off `lastHardAnchor` —
 * which can be set to a much-later existing booking. The two suggested_start
 * values then encode the projector's drift, and adding the delta to a real
 * start time amplified the drift further (the user's symptom: Anatómiai
 * lenyomat could not get a May slot because its computed minimum was forced
 * past September).
 *
 * The fix replaces the two-suggested delta with the canonical pathway gap
 * (`default_days_offset` from the pathway template):
 *
 *   chainMinStartTime = previousActualStart + pathwayGapDays
 *
 * — exactly the user's prescription. This source-shape regression keeps the
 * route from quietly drifting back to the broken delta-based implementation.
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
    'episodes',
    '[id]',
    'convert-all-intents',
    'route.ts'
  ),
  'utf8'
);

describe('convert-all-intents — chain-anchor uses pathway gap, not suggested-delta (regression)', () => {
  it('imports the pathway template helper to read default_days_offset', () => {
    expect(SRC).toMatch(/from\s+['"]@\/lib\/pathway-work-phases-for-episode['"]/);
    expect(SRC).toMatch(/getPathwayWorkPhasesForEpisode/);
  });

  it('builds a per-step gap map from default_days_offset', () => {
    expect(SRC).toMatch(/gapByStep\s*=\s*new Map<string,\s*number>\(\)/);
    expect(SRC).toMatch(/default_days_offset/);
    expect(SRC).toMatch(/gapByStep\.set\(\s*ph\.work_phase_code/);
  });

  it('chainMinStartTime is computed as prevActualStart + (gapDays * MS_PER_DAY)', () => {
    // The new minimum-start formula must use prevActualStart and a constant
    // millisecond-per-day multiplier — NOT (currSuggested - prevSuggestedStart).
    expect(SRC).toMatch(
      /chainMinStartTime\s*=\s*new Date\(\s*prevActualStart\.getTime\(\)\s*\+\s*gapDays\s*\*\s*MS_PER_DAY\s*\)/
    );
    expect(SRC).toMatch(/MS_PER_DAY\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it('does NOT use the legacy delta-based chainMinStartTime', () => {
    // The delta pattern was: `currSuggested.getTime() - prevSuggestedStart.getTime()`.
    // A defense-in-depth check: neither variable name and neither subtraction
    // pattern should appear in the source after the refactor.
    expect(SRC).not.toMatch(/prevSuggestedStart/);
    expect(SRC).not.toMatch(/currSuggested\.getTime\(\)\s*-\s*\w+SuggestedStart/);
  });

  it('does NOT select intent.suggested_start (no longer needed)', () => {
    // The SQL no longer needs suggested_start because the chain anchor now
    // comes from the pathway template. Keeping it would invite a future
    // refactor that re-introduces the broken delta.
    const sqlBlock = SRC.match(
      /pool\.query\(\s*`\s*SELECT[\s\S]*?FROM\s+slot_intents[\s\S]*?`/
    );
    expect(sqlBlock, 'slot_intents SELECT not found').toBeTruthy();
    expect(sqlBlock![0]).not.toMatch(/suggested_start/);
  });

  it('virtually advances prevActualStart on SKIPPED so cumulative pathway gap is preserved', () => {
    // If e.g. Harapásregisztráció is skipped, Fogpróba must still respect the
    // distance from Anat (Anat + Harapás.gap + Fogpróba.gap), not just
    // Anat + Fogpróba.gap. We achieve this by carrying the would-be minimum
    // forward into prevActualStart even on skip.
    expect(SRC).toMatch(
      /skipped\.push[\s\S]*?prevActualStart\s*=\s*chainMinStartTime/
    );
  });

  it('first intent has no chainMinStartTime (only "now" floor)', () => {
    // For the first intent prevActualStart is null, so chainMinStartTime is
    // undefined — the picker will then fall back to `now` only. We assert the
    // undefined-default by checking the conditional spread `...(chainMinStartTime ? ...)`.
    expect(SRC).toMatch(
      /\.\.\.\(chainMinStartTime\s*\?\s*\{\s*chainMinStartTime\s*\}\s*:\s*\{\s*\}\)/
    );
    // And prevActualStart starts as null.
    expect(SRC).toMatch(/let\s+prevActualStart:\s*Date\s*\|\s*null\s*=\s*null/);
  });

  it('falls back to a default gap when the pathway template lacks the step', () => {
    // Legacy data drift: a step might exist as an episode_work_phases row
    // without a matching pathway template entry. Falling back to a sensible
    // default keeps bulk-convert robust.
    expect(SRC).toMatch(/DEFAULT_PATHWAY_GAP_DAYS\s*=\s*\d+/);
  });
});

describe('convert-all-intents — episode-level per-step override (regression)', () => {
  it('SELECT pulls episode_work_phases.default_days_offset (when column exists)', () => {
    // Probe + LEFT JOIN must be present so the per-step override on the
    // patient's episode is observable to the bulk-convert. Without this,
    // an admin can edit `episode_work_phases.default_days_offset` at the
    // worklist UI and see the worklist update — but the bulk-convert keeps
    // using the pathway template, which is exactly the inconsistency the
    // user reported.
    expect(SRC).toMatch(/information_schema\.columns/);
    expect(SRC).toMatch(/column_name\s*=\s*'default_days_offset'/);
    expect(SRC).toMatch(
      /LEFT JOIN episode_work_phases ewp[\s\S]*?ewp\.episode_id\s*=\s*si\.episode_id[\s\S]*?ewp\.work_phase_code\s*=\s*si\.step_code/
    );
    expect(SRC).toMatch(/ewp\.default_days_offset\s+AS\s+episode_offset/);
  });

  it('precedence: episode_offset > template gap > DEFAULT_PATHWAY_GAP_DAYS', () => {
    // The new gap selection must read episode_offset FIRST, then fall back to
    // the per-step pathway gap, then the hard default. The legacy "template only"
    // resolution must NOT remain — that was the bug.
    expect(SRC).toMatch(
      /episodeOverrideDays[\s\S]*?\?\?\s*gapByStep\.get\(\s*stepCode\s*\)[\s\S]*?\?\?\s*DEFAULT_PATHWAY_GAP_DAYS/
    );
    // Defense: episode_offset must be coerced through a non-negative number
    // guard so accidental NULLs / strings don't leak into Date arithmetic.
    expect(SRC).toMatch(
      /typeof\s+row\.episode_offset\s*===\s*'number'\s*&&\s*row\.episode_offset\s*>=\s*0/
    );
  });

  it('matches the precedence used by the projector + worklist (single source of truth)', () => {
    // The worklist (lib/next-step-engine.ts) and the projector
    // (lib/slot-intent-projector.ts) both resolve the gap as
    // `episode_override ?? template ?? 14`. The bulk-convert must agree
    // bit-for-bit, otherwise the operator can see one window in the UI and
    // get another from the booker. The doc comment encodes the precedence
    // contract.
    const docMatch = SRC.match(
      /\* `pathwayMinGap` precedence[\s\S]*?episode_work_phases\.default_days_offset[\s\S]*?care_pathways\.work_phases_json[\s\S]*?DEFAULT_PATHWAY_GAP_DAYS/
    );
    expect(docMatch, 'precedence comment block missing or out of order').toBeTruthy();
  });
});

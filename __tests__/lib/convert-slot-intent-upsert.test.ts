/**
 * Regression test for the bulk-convert "stale cancelled blocks rebooking" bug.
 *
 * The single-slot booking path (`lib/appointment-service.ts`) has long handled
 * the legacy data-drift where a slot is `state = 'free'` but a previous
 * appointment row remains pinned to `time_slot_id` with
 * `appointment_status IN ('cancelled_by_doctor','cancelled_by_patient')`. It
 * does this with `INSERT ... ON CONFLICT (time_slot_id) DO UPDATE SET ... WHERE
 * appointments.appointment_status IN (...)` so the cancelled row is "revived"
 * onto the new booking, side-stepping the `appointments_time_slot_id_key`
 * UNIQUE constraint.
 *
 * Before this fix, the bulk-convert path
 * (`lib/convert-slot-intent.ts → convertIntentToAppointment`) used a vanilla
 * `INSERT INTO appointments` plus a status-blind `SELECT 1 ... WHERE
 * time_slot_id = $slot LIMIT 1` guard, which rejected with
 * "A slot már másik foglaláshoz tartozik (verseny); kihagyva." for every
 * intent that happened to pick such a slot. End users saw it as
 * "2 időpont lefoglalva, 5 kihagyva" with all five reasons identical, even
 * though the slots were genuinely free.
 *
 * This test pins the corrected SQL shape in place so a future refactor can't
 * silently regress the fix. It does NOT need a database — it asserts on the
 * source of `lib/convert-slot-intent.ts` that the UPSERT pattern is present
 * and that the cancelled-status WHERE clause covers exactly the canonical
 * cancelled set from `lib/active-appointment.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CANCELLED_APPOINTMENT_STATUSES } from '@/lib/active-appointment';

const SRC = readFileSync(
  join(__dirname, '..', '..', 'lib', 'convert-slot-intent.ts'),
  'utf8'
);

describe('convertIntentToAppointment — UPSERT shape (regression)', () => {
  it('inserts via ON CONFLICT (time_slot_id) DO UPDATE — not a vanilla INSERT', () => {
    expect(
      /INSERT INTO appointments[\s\S]*?ON CONFLICT\s*\(\s*time_slot_id\s*\)\s*DO UPDATE/.test(
        SRC
      ),
      'convert-slot-intent must mirror appointment-service.ts and UPSERT on time_slot_id'
    ).toBe(true);
  });

  it('only revives rows whose current status is in the canonical cancelled set', () => {
    // Pull the WHERE-clause associated with the UPSERT and check it matches
    // exactly the cancelled set exported from lib/active-appointment.ts.
    const upsertMatch = SRC.match(
      /ON CONFLICT\s*\(\s*time_slot_id\s*\)[\s\S]*?WHERE\s+appointments\.appointment_status\s+IN\s*\(([^)]*)\)/
    );
    expect(upsertMatch, 'UPSERT must carry a WHERE filter on appointment_status').toBeTruthy();
    const whereLiteralsBlob = upsertMatch![1];

    for (const value of CANCELLED_APPOINTMENT_STATUSES) {
      expect(
        whereLiteralsBlob.includes(`'${value}'`),
        `UPSERT WHERE clause must include canonical cancelled value '${value}'`
      ).toBe(true);
    }

    // And the WHERE clause must NOT silently revive ACTIVE statuses (NULL,
    // completed, no_show) — that would overwrite a live booking.
    expect(whereLiteralsBlob).not.toMatch(/'completed'|'no_show'/);
    expect(whereLiteralsBlob).not.toMatch(/IS\s+NULL/i);
  });

  it('drops the legacy status-blind "SELECT 1 FROM appointments WHERE time_slot_id" guard', () => {
    // The old guard rejected ANY existing row, including stale cancelled ones,
    // and produced the user-visible "A slot már másik foglaláshoz tartozik
    // (verseny); kihagyva." for free-but-historically-cancelled slots. The
    // UPSERT now subsumes both the read check and the conflict handling, so
    // the legacy guard SQL must not come back.
    expect(SRC).not.toMatch(
      /SELECT\s+1\s+FROM\s+appointments\s+WHERE\s+time_slot_id\s*=\s*\$1\s+LIMIT\s+1/
    );
  });

  it('still surfaces a real ACTIVE-row conflict as SLOT_ALREADY_BOOKED (no silent overwrite)', () => {
    // When the existing row is ACTIVE, the UPSERT WHERE clause filters it
    // out and RETURNING is empty. The function must detect that and roll
    // back with the same machine code the UI/clients already key off of.
    expect(SRC).toMatch(/code:\s*'SLOT_ALREADY_BOOKED'/);
    expect(SRC).toMatch(/apptResult\.rows\.length\s*===\s*0/);
  });
});

describe('convertIntentToAppointment — drift-tolerant slot picker (W: bulk-convert robustness)', () => {
  it('exposes a shared FREE_SLOT_PREDICATE_SQL built from the canonical active fragment', () => {
    // Both the windowed and the nearest-free picker must share ONE definition
    // of "free", and that definition must include the NOT EXISTS clause that
    // skips slots with a live appointment row attached. Without this, a
    // single drifted slot (state=free + active appt) cascades into a wave of
    // SLOT_ALREADY_BOOKED skips for every subsequent intent in the loop.
    expect(SRC).toMatch(/const\s+FREE_SLOT_PREDICATE_SQL\s*=/);
    const predicateBlock = SRC.match(/const\s+FREE_SLOT_PREDICATE_SQL\s*=\s*`([\s\S]*?)`/);
    expect(predicateBlock, 'FREE_SLOT_PREDICATE_SQL must be defined as a SQL fragment').toBeTruthy();
    const body = predicateBlock![1];
    expect(body).toMatch(/state\s*=\s*'free'/);
    expect(body).toMatch(/NOT\s+EXISTS/i);
    expect(body).toMatch(/SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT/);
    expect(body).toMatch(/a\.time_slot_id\s*=\s*ats\.id/);
  });

  it('the windowed picker SQL uses FREE_SLOT_PREDICATE_SQL (no inlined state=free leftover)', () => {
    // Pin the call sites so a future refactor cannot accidentally split the
    // picker definition again.
    const windowedMatch = SRC.match(/const\s+sqlInWindow\s*=\s*`([\s\S]*?)`/);
    expect(windowedMatch, 'sqlInWindow constant missing').toBeTruthy();
    expect(windowedMatch![1]).toMatch(/\$\{FREE_SLOT_PREDICATE_SQL\}/);
  });

  it('the nearest-free picker uses FREE_SLOT_PREDICATE_SQL (no inlined state=free leftover)', () => {
    // We expect EXACTLY two interpolations of FREE_SLOT_PREDICATE_SQL in the
    // file: one in pickNearestFreeSlot (the fallback when the window has no
    // slots) and one in sqlInWindow (the in-window picker). If a future edit
    // accidentally inlines `state = 'free'` into either, the count drops to 1
    // and this test fails — surfacing the regression immediately.
    const matches = SRC.match(/\$\{FREE_SLOT_PREDICATE_SQL\}/g) ?? [];
    expect(matches.length).toBe(2);
    // And the pickNearestFreeSlot function must embed it (we previously
    // verified sqlInWindow separately).
    const nearestSql = SRC.match(
      /async function pickNearestFreeSlot[\s\S]*?return client\.query\(\s*`([\s\S]*?)`/
    );
    expect(nearestSql, 'pickNearestFreeSlot SQL template literal missing').toBeTruthy();
    expect(nearestSql![1]).toMatch(/\$\{FREE_SLOT_PREDICATE_SQL\}/);
  });

  it('self-heals slot.state to booked when SLOT_ALREADY_BOOKED is raised', () => {
    // When a drifted slot slips through, the post-rollback self-heal updates
    // slot.state to match reality so the next picker iteration skips it.
    // Otherwise the next intent picks the same slot and bounces too,
    // turning one drift row into N skipped intents.
    expect(SRC).toMatch(/UPDATE\s+available_time_slots[\s\S]*?SET\s+state\s*=\s*'booked'[\s\S]*?WHERE\s+id\s*=\s*\$1[\s\S]*?AND\s+state\s*=\s*'free'/);
    // And the heal must be guarded by an EXISTS check so we only flip
    // slot.state when an active appt row is actually present (i.e. real drift,
    // not a transient race).
    const healBlock = SRC.match(/Self-heal[\s\S]*?try\s*\{[\s\S]*?\}\s*catch/);
    expect(healBlock, 'Self-heal block missing').toBeTruthy();
    expect(healBlock![0]).toMatch(/EXISTS\s*\([\s\S]*?appointments\s+a[\s\S]*?SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT/);
  });
});

describe('convertIntentToAppointment — bulk-flow lowerBound semantics (W: chain-anchor simplification)', () => {
  it('bulk-flow (skipOneHardNext) ignores intent.window_start / suggested_start drift', () => {
    // The previous lowerBound = max(now, windowStart, suggested, chainMin)
    // honoured the projector's chained suggested_start, which over-drifts
    // when a previous booking pushed `lastHardAnchor` forward. The new rule
    // splits the lowerBound on `skipOneHardNext`: bulk path uses ONLY
    // [now, chainMinStartTime], single-intent path retains the historical
    // [now, windowStart, suggested, chainMin].
    const lowerBoundBlock = SRC.match(
      /const\s+lowerParts:\s*number\[\][\s\S]*?const\s+lowerBound\s*=\s*new Date\(Math\.max[\s\S]*?\)\s*;/
    );
    expect(lowerBoundBlock, 'lowerBound assembly block missing').toBeTruthy();
    const block = lowerBoundBlock![0];

    // The bulk branch must be gated on skipOneHardNext.
    expect(block).toMatch(/if\s*\(\s*skipOneHardNext\s*\)\s*\{/);

    // Inside the if-block (bulk), windowStart and suggested must NOT be
    // pushed onto lowerParts. We verify by asserting the bulk block contains
    // ONLY a chainMinStartTime push, no windowStart/suggested pushes.
    const bulkBranch = block.match(
      /if\s*\(\s*skipOneHardNext\s*\)\s*\{([\s\S]*?)\}\s*else\s*\{/
    );
    expect(bulkBranch, 'bulk if-branch missing').toBeTruthy();
    expect(bulkBranch![1]).toMatch(/chainMinStartTime\.getTime\(\)/);
    expect(bulkBranch![1]).not.toMatch(/windowStart\.getTime\(\)/);
    expect(bulkBranch![1]).not.toMatch(/suggested\.getTime\(\)/);

    // Else-branch (single-intent) keeps the legacy max(...).
    const elseBranch = block.match(/\}\s*else\s*\{([\s\S]*?)\}\s*const\s+lowerBound/);
    expect(elseBranch, 'else single-intent branch missing').toBeTruthy();
    expect(elseBranch![1]).toMatch(/windowStart\.getTime\(\)/);
    expect(elseBranch![1]).toMatch(/suggested\.getTime\(\)/);
    expect(elseBranch![1]).toMatch(/chainMinStartTime\.getTime\(\)/);
  });

  it('always anchors lowerBound at "now" so past-window intents do not pick stale slots', () => {
    // `Date.now()` must be in lowerParts unconditionally — both bulk and
    // single-intent flows. This guards against picking a slot whose
    // start_time has already elapsed.
    expect(SRC).toMatch(/const\s+lowerParts:\s*number\[\]\s*=\s*\[\s*Date\.now\(\)\s*\]/);
  });
});

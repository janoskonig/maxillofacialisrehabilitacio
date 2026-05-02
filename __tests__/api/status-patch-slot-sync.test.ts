/**
 * Regression test for the appointment-status PATCH slot-state sync.
 *
 * Before this fix, `app/api/appointments/[id]/status/route.ts` set the
 * appointment_status to `cancelled_by_doctor` / `cancelled_by_patient` and
 * expired the slot intent, but did NOT touch `available_time_slots.state`. The
 * slot stayed `state='booked'`, while the appointments table said the slot was
 * cancelled — exactly the drift the bulk-convert robustness fix surfaces as
 * `SLOT_ALREADY_BOOKED`. Worse, when a separate sync flipped slot.state back
 * to 'free' (e.g. Google Calendar resync, manual fix), the picker would hand
 * the slot to the next intent and the UPSERT would bounce.
 *
 * Two other cancellation paths (`lib/appointment-service.ts` rebook scenario
 * and `app/api/episodes/[id]/work-phases/[workPhaseId]/route.ts` reactivate)
 * already kept slot.state in sync. This test pins the status PATCH path so
 * the three stay consistent.
 *
 * Source-level test (no DB) — guards against a future edit that drops the
 * UPDATE statement or accidentally extends it to no_show.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(__dirname, '..', '..', 'app', 'api', 'appointments', '[id]', 'status', 'route.ts'),
  'utf8'
);

describe('PATCH /api/appointments/[id]/status — slot-state sync (regression)', () => {
  it('frees the slot on cancelled_by_doctor / cancelled_by_patient', () => {
    // Capture the slot-state-sync UPDATE block: it must be guarded on the
    // cancelled-only condition AND target available_time_slots back to
    // free/available. Joined to the appointment by id (FROM appointments / WHERE
    // a.id = $1 / a.time_slot_id = ats.id).
    expect(SRC).toMatch(/normalisedStatus\s*===\s*'cancelled_by_doctor'/);
    expect(SRC).toMatch(/normalisedStatus\s*===\s*'cancelled_by_patient'/);
    const updateBlock = SRC.match(
      /UPDATE\s+available_time_slots[\s\S]*?WHERE[\s\S]*?a\.time_slot_id\s*=\s*ats\.id/i
    );
    expect(updateBlock, 'slot-state UPDATE statement missing from status PATCH').toBeTruthy();
    expect(updateBlock![0]).toMatch(/state\s*=\s*'free'/);
    expect(updateBlock![0]).toMatch(/status\s*=\s*'available'/);
  });

  it('does NOT free the slot on no_show (no_show is canonical-active)', () => {
    // The `isCancelOrNoShow` umbrella still expires the slot intent for no_show
    // (so reprojection runs), but the available_time_slots UPDATE must be
    // gated on cancelled_by_* only. We anchor the search to the
    // "Slot-state" comment we placed right above the gating `if`, so the
    // regex can't accidentally lock onto an earlier early-return guard.
    const slotStateBlock = SRC.match(
      /Slot-state[\s\S]{0,1200}?if\s*\(\s*([\s\S]*?)\s*\)\s*\{[\s\S]*?UPDATE\s+available_time_slots/
    );
    expect(slotStateBlock, 'Slot-state guard block missing').toBeTruthy();
    const ifHead = slotStateBlock![1];
    expect(ifHead).toMatch(/cancelled_by_doctor/);
    expect(ifHead).toMatch(/cancelled_by_patient/);
    expect(ifHead).not.toMatch(/no_show/);
  });

  it('keeps the existing slot_intents -> expired and REPROJECT_INTENTS event', () => {
    // The old behaviour (intent expire + scheduling event) must remain
    // unchanged so reprojection still triggers after a cancellation.
    expect(SRC).toMatch(/UPDATE\s+slot_intents\s+si[\s\S]*?SET\s+state\s*=\s*'expired'/);
    expect(SRC).toMatch(/'REPROJECT_INTENTS'/);
  });
});

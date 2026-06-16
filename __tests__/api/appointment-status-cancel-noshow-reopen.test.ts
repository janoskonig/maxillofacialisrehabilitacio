/**
 * Source-level guard tests for `PATCH /api/appointments/[id]/status`.
 *
 * Regression: a `no_show` (or any cancel) on a *booked* (scheduled) work phase
 * must reopen the phase to `pending` and drop the dead appointment link — not
 * only when the prior status was `completed`. Otherwise the phase stays
 * `scheduled` linked to a dead appointment, the worklist won't surface it for
 * rebooking, and (pre-migration-059) a no_show re-book failed with
 * WORK_PHASE_ALREADY_BOOKED.
 *
 * The end-to-end behavioural proof (real handler, minted JWT, live DB) lives in
 * scripts/sim/edge-cases.ts EC17; this pins the corrected SQL/logic shape so a
 * refactor can't silently regress it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(__dirname, '..', '..', 'app', 'api', 'appointments', '[id]', 'status', 'route.ts'),
  'utf8'
);

describe('PATCH /api/appointments/[id]/status — cancel/no_show reopens the work phase', () => {
  it('runs the EWP-reopen for every cancel/no_show transition, not only completed', () => {
    // The reopen branch must NOT be gated on `oldStatus === 'completed'` — that
    // was the bug. Inside the `isCancelOrNoShow` block the guard is only the
    // episode/step presence.
    expect(SRC).toMatch(/const isCancelOrNoShow\s*=/);
    expect(SRC).toMatch(/if \(episodeIdForEwp && stepCodeForEwp\) \{/);
    expect(SRC).not.toMatch(/oldStatus === 'completed' &&\s*\n\s*episodeIdForEwp/);
  });

  it('reopens via the shared revert helper (pending + NULL link + audit)', () => {
    expect(SRC).toMatch(/revertWorkPhaseLinkToPending/);
    expect(SRC).toMatch(/findEwpForAppointmentRevert/);
  });

  it('only reopens when this appointment is the EWP link and no other active booking exists', () => {
    expect(SRC).toMatch(/ewp\.appointmentId === appointmentId/);
    expect(SRC).toMatch(/SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT/);
  });

  it('frees the slot for cancellations but keeps the no_show slot consumed', () => {
    // Cancelled → slot back to free/available; no_show is deliberately NOT freed.
    expect(SRC).toMatch(/normalisedStatus === 'cancelled_by_doctor'\s*\|\|\s*\n?\s*normalisedStatus === 'cancelled_by_patient'/);
    expect(SRC).toMatch(/SET state = 'free', status = 'available'/);
  });

  it('uses a dedicated pool client transaction', () => {
    expect(SRC).toMatch(/await pool\.connect\(\)/);
    expect(SRC).toMatch(/client\.query\('BEGIN'\)/);
    expect(SRC).toMatch(/client\.release\(\)/);
  });
});

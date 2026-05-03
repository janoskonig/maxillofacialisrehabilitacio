/**
 * Unit tests for `lib/worklist-prior-attempts.ts` — a worklist row
 * enrichment helper that attaches `priorAttempts`, `currentAppointmentId`,
 * `currentAttemptNumber`, and `currentAppointmentStatus` to each
 * `WorklistItemBackend` based on the appointment history (migration 029).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetAttemptColumnsExistCache,
  setAttemptColumnsExist,
} from '@/lib/appointment-attempts';
import { enrichWorklistPriorAttempts } from '@/lib/worklist-prior-attempts';
import type { WorklistItemBackend } from '@/lib/worklist-types';

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface FakeRow {
  id: string;
  episode_id: string;
  step_code: string | null;
  attempt_number: number;
  appointment_status: 'unsuccessful' | 'no_show' | 'completed' | null;
  start_time: string | null;
  end_time: string | null;
  dentist_email: string | null;
  attempt_failed_reason: string | null;
  attempt_failed_at: string | null;
  attempt_failed_by: string | null;
}

function makeFakePool(rows: FakeRow[]) {
  const calls: RecordedQuery[] = [];
  return {
    pool: {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return { rows };
      },
    } as unknown as Parameters<typeof enrichWorklistPriorAttempts>[0],
    calls,
  };
}

function makeItem(overrides: Partial<WorklistItemBackend> = {}): WorklistItemBackend {
  return {
    episodeId: 'ep-1',
    patientId: 'p-1',
    currentStage: 'STAGE_5',
    nextStep: 'STEP_LENYOMAT',
    stepCode: 'STEP_LENYOMAT',
    overdueByDays: 0,
    windowStart: null,
    windowEnd: null,
    durationMinutes: 30,
    pool: 'work',
    priorityScore: 0,
    noShowRisk: 0,
    ...overrides,
  };
}

beforeEach(() => {
  resetAttemptColumnsExistCache();
  setAttemptColumnsExist(true);
});

describe('enrichWorklistPriorAttempts', () => {
  it('no-ops on empty items', async () => {
    const { pool, calls } = makeFakePool([]);
    await enrichWorklistPriorAttempts(pool as unknown as Parameters<typeof enrichWorklistPriorAttempts>[0], []);
    expect(calls).toHaveLength(0);
  });

  it('skips items missing episodeId or stepCode (no DB hit needed)', async () => {
    const { pool, calls } = makeFakePool([]);
    const items: WorklistItemBackend[] = [makeItem({ stepCode: undefined })];
    await enrichWorklistPriorAttempts(pool as unknown as Parameters<typeof enrichWorklistPriorAttempts>[0], items);
    expect(calls).toHaveLength(0);
  });

  it('attaches a single prior unsuccessful attempt to the matching item', async () => {
    const { pool } = makeFakePool([
      {
        id: 'appt-prev',
        episode_id: 'ep-1',
        step_code: 'STEP_LENYOMAT',
        attempt_number: 1,
        appointment_status: 'unsuccessful',
        start_time: '2026-04-20T08:00:00Z',
        end_time: '2026-04-20T08:30:00Z',
        dentist_email: 'doc@x',
        attempt_failed_reason: 'Lenyomat torzult',
        attempt_failed_at: '2026-04-20T09:00:00Z',
        attempt_failed_by: 'doc@x',
      },
    ]);
    const items: WorklistItemBackend[] = [
      makeItem({ bookedAppointmentId: 'appt-current' }),
    ];
    await enrichWorklistPriorAttempts(pool as unknown as Parameters<typeof enrichWorklistPriorAttempts>[0], items);

    expect(items[0].priorAttempts).toHaveLength(1);
    expect(items[0].priorAttempts![0]).toMatchObject({
      appointmentId: 'appt-prev',
      attemptNumber: 1,
      status: 'unsuccessful',
      failedReason: 'Lenyomat torzult',
    });

    // The current attempt is the booked one, attempt #2 (1 prior + 1).
    expect(items[0].currentAppointmentId).toBe('appt-current');
    expect(items[0].currentAttemptNumber).toBe(2);
    expect(items[0].currentAppointmentStatus).toBe('pending');
  });

  it('treats COMPLETED step (no booked future) — last completed becomes "current", any earlier failed → priorAttempts', async () => {
    const { pool } = makeFakePool([
      {
        id: 'attempt-1-fail',
        episode_id: 'ep-1',
        step_code: 'STEP_LENYOMAT',
        attempt_number: 1,
        appointment_status: 'unsuccessful',
        start_time: '2026-04-20T08:00:00Z',
        end_time: null,
        dentist_email: null,
        attempt_failed_reason: 'Rossz lenyomat',
        attempt_failed_at: '2026-04-20T09:00:00Z',
        attempt_failed_by: 'doc@x',
      },
      {
        id: 'attempt-2-done',
        episode_id: 'ep-1',
        step_code: 'STEP_LENYOMAT',
        attempt_number: 2,
        appointment_status: 'completed',
        start_time: '2026-05-01T08:00:00Z',
        end_time: null,
        dentist_email: 'doc@x',
        attempt_failed_reason: null,
        attempt_failed_at: null,
        attempt_failed_by: null,
      },
    ]);
    const items: WorklistItemBackend[] = [
      makeItem({ bookedAppointmentId: undefined, stepStatus: 'completed' }),
    ];
    await enrichWorklistPriorAttempts(pool as unknown as Parameters<typeof enrichWorklistPriorAttempts>[0], items);

    expect(items[0].currentAppointmentId).toBe('attempt-2-done');
    expect(items[0].currentAttemptNumber).toBe(2);
    expect(items[0].currentAppointmentStatus).toBe('completed');
    expect(items[0].priorAttempts).toHaveLength(1);
    expect(items[0].priorAttempts![0].appointmentId).toBe('attempt-1-fail');
  });

  it('does NOT touch unrelated items in the same batch', async () => {
    const { pool } = makeFakePool([
      {
        id: 'appt-prev',
        episode_id: 'ep-1',
        step_code: 'STEP_LENYOMAT',
        attempt_number: 1,
        appointment_status: 'unsuccessful',
        start_time: '2026-04-20T08:00:00Z',
        end_time: null,
        dentist_email: null,
        attempt_failed_reason: null,
        attempt_failed_at: null,
        attempt_failed_by: null,
      },
    ]);
    const items: WorklistItemBackend[] = [
      makeItem(),
      // Different step in the same episode — should NOT receive the prior attempt.
      makeItem({ stepCode: 'STEP_OTHER' }),
    ];
    await enrichWorklistPriorAttempts(pool as unknown as Parameters<typeof enrichWorklistPriorAttempts>[0], items);

    expect(items[0].priorAttempts).toHaveLength(1);
    expect(items[1].priorAttempts).toHaveLength(0);
  });

  it('returns an empty priorAttempts array when no rows match', async () => {
    const { pool } = makeFakePool([]);
    const items: WorklistItemBackend[] = [makeItem({ bookedAppointmentId: 'appt-current' })];
    await enrichWorklistPriorAttempts(pool as unknown as Parameters<typeof enrichWorklistPriorAttempts>[0], items);
    expect(items[0].priorAttempts).toEqual([]);
    // currentAppointmentId still set from bookedAppointmentId, attempt #1.
    expect(items[0].currentAppointmentId).toBe('appt-current');
    expect(items[0].currentAttemptNumber).toBe(1);
  });

  it('is a no-op on legacy DB (probe returns false, no query issued)', async () => {
    setAttemptColumnsExist(false);
    const { pool, calls } = makeFakePool([]);
    const items: WorklistItemBackend[] = [makeItem({ bookedAppointmentId: 'x' })];
    await enrichWorklistPriorAttempts(pool as unknown as Parameters<typeof enrichWorklistPriorAttempts>[0], items);
    expect(calls).toHaveLength(0);
    expect(items[0].priorAttempts).toBeUndefined();
  });

  it('SQL: queries appointments scoped to (episode_id ANY, step_code ANY) with the three counting statuses', async () => {
    const { pool, calls } = makeFakePool([]);
    const items: WorklistItemBackend[] = [
      makeItem({ episodeId: 'ep-A', stepCode: 'STEP_X' }),
      makeItem({ episodeId: 'ep-B', stepCode: 'STEP_Y' }),
    ];
    await enrichWorklistPriorAttempts(pool as unknown as Parameters<typeof enrichWorklistPriorAttempts>[0], items);
    expect(calls).toHaveLength(1);
    const sql = calls[0].sql;
    expect(sql).toMatch(/appointment_status\s+IN\s*\(/);
    expect(sql).toContain("'unsuccessful'");
    expect(sql).toContain("'no_show'");
    expect(sql).toContain("'completed'");
    expect(sql).not.toMatch(/'cancelled/);
    expect(sql).toMatch(/episode_id\s*=\s*ANY\(\$1::uuid\[\]\)/);
    expect(sql).toMatch(/step_code\s*=\s*ANY\(\$2::text\[\]\)/);
    // Ordering for stable display
    expect(sql).toMatch(/ORDER BY[\s\S]*?attempt_number\s+ASC/);
  });
});

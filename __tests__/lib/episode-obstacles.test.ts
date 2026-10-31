import { describe, expect, it } from 'vitest';
import { createObstacleSchema, isActiveObstacle, obstacleWaitlistRows, obstacleWaitingDays, type WaitingObstacle } from '@/lib/episode-obstacles';
import { isValidBlockKey } from '@/lib/episode-block-taxonomy';
import { allPendingStepsWithData, isBlockedAll, type EpisodeBatchData } from '@/lib/next-step-engine';

const now = new Date('2026-10-31T12:00:00Z');
const obstacle = (overrides: Partial<WaitingObstacle> = {}): WaitingObstacle => ({
  id: 'block-1', episodeId: 'episode-1', patientId: 'patient-1', patientName: 'Teszt Anna', episodeTitle: 'Fogpótlás',
  key: 'WAIT_QUOTE', active: true, waitingOn: 'Minta Fogtechnika', waitingSince: '2026-10-01T10:00:00Z',
  expectedUnblockDate: '2026-10-10T10:00:00Z', expiresAt: null, note: null, createdAt: '2026-10-01T10:00:00Z',
  resolvedAt: null, resolutionNote: null, assignedProviderId: 'doctor-1', assignedProviderName: 'Dr. Minta', currentStageLabel: null,
  ...overrides,
});

describe('obstacle waiting list', () => {
  it('requires a concrete person or institution, even for a known obstacle category', () => {
    expect(createObstacleSchema.safeParse({ key: 'WAIT_QUOTE', waitingOn: '   ' }).success).toBe(false);
    expect(createObstacleSchema.safeParse({ key: 'WAIT_QUOTE', waitingOn: '  Minta Fogtechnika  ' })).toMatchObject({ success: true, data: { waitingOn: 'Minta Fogtechnika' } });
    expect(isValidBlockKey('__proto__')).toBe(false);
  });

  it('rejects nonexistent dates, future starts, and a response before the start', () => {
    const base = { key: 'WAIT_HISTOLOGY', waitingOn: 'Patológia' };
    for (const waitingSince of ['2026-02-31', '2026-13-01', '2999-01-01']) {
      expect(createObstacleSchema.safeParse({ ...base, waitingSince }).success).toBe(false);
    }
    expect(createObstacleSchema.safeParse({ ...base, waitingSince: '2020-02-20', expectedUnblockDate: '2020-02-19' }).success).toBe(false);
  });

  it('keeps an unresolved obstacle active after the expected response date', () => {
    expect(isActiveObstacle(obstacle(), now)).toBe(true);
    expect(isActiveObstacle(obstacle({ active: false }), now)).toBe(false);
    expect(isActiveObstacle(obstacle({ expiresAt: '2026-10-30T00:00:00Z' }), now)).toBe(false);
  });

  it('groups multiple obstacles for a treatment and sorts by the oldest active wait', () => {
    const rows = obstacleWaitlistRows([
      obstacle({ id: 'new', waitingSince: '2026-10-25T10:00:00Z', key: 'WAIT_HISTOLOGY' }),
      obstacle(),
      obstacle({ id: 'other', episodeId: 'episode-2', waitingSince: '2026-10-15T10:00:00Z' }),
      obstacle({ id: 'resolved', episodeId: 'episode-3', active: false, waitingSince: '2020-01-01T00:00:00Z' }),
    ], {}, now);
    expect(rows.map((row) => row.episodeId)).toEqual(['episode-1', 'episode-2']);
    expect(rows[0].obstacles).toHaveLength(2);
    expect(rows[0].waitingSince).toBe('2026-10-01T10:00:00Z');
  });

  it('filters by who we are waiting for and puts missing deadlines last', () => {
    const list = [obstacle(), obstacle({ id: 'other', episodeId: 'episode-2', key: 'WAIT_INSURER', waitingOn: 'Minta Biztosító', expectedUnblockDate: null })];
    expect(obstacleWaitlistRows(list, { search: 'biztosító', key: 'WAIT_INSURER', providerId: 'doctor-1' }, now).map((row) => row.episodeId)).toEqual(['episode-2']);
    expect(obstacleWaitlistRows(list, { sort: 'expected' }, now).map((row) => row.episodeId)).toEqual(['episode-1', 'episode-2']);
  });

  it('counts Budapest calendar days across the autumn DST change', () => {
    expect(obstacleWaitingDays('2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z')).toBe(1);
  });

  it('keeps scheduling blocked until all obstacles have been resolved', () => {
    const data: EpisodeBatchData = {
      blocks: [{ key: 'WAIT_QUOTE', expires_at: null, waiting_on: 'Minta Fogtechnika' }, { key: 'WAIT_INSURER', expires_at: null, waiting_on: 'Minta Biztosító' }],
      pathwayWorkPhases: null, completedStats: { completedCount: 0, lastCompletedAt: null }, episodeWorkPhases: null,
      openedAt: now, currentStage: 'STAGE_0',
    };
    const both = allPendingStepsWithData('episode-1', data);
    expect(both).toMatchObject({ status: 'blocked', block_keys: ['WAIT_QUOTE', 'WAIT_INSURER'], reason: expect.stringContaining('Minta Fogtechnika') });
    const remaining = allPendingStepsWithData('episode-1', { ...data, blocks: data.blocks.slice(1) });
    expect(remaining).toMatchObject({ status: 'blocked', reason: expect.stringContaining('Minta Biztosító') });
    expect(isBlockedAll(allPendingStepsWithData('episode-1', { ...data, blocks: [] }))).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  getDbPool: vi.fn(),
}));

vi.mock('@/lib/next-step-engine', async () => {
  const actual = await vi.importActual<typeof import('@/lib/next-step-engine')>('@/lib/next-step-engine');
  return {
    ...actual,
    nextRequiredStep: vi.fn(),
  };
});

vi.mock('@/lib/refresh-episode-next-step-cache', () => ({
  getProviderIdForEpisode: vi.fn(),
}));

import { getDbPool } from '@/lib/db';
import { nextRequiredStep } from '@/lib/next-step-engine';
import { getProviderIdForEpisode } from '@/lib/refresh-episode-next-step-cache';
import { getFirstBookableSlotForEpisode, canUseProviderScopeAll } from '@/lib/first-bookable-slot';

describe('canUseProviderScopeAll', () => {
  it('allows configured staff roles', () => {
    expect(canUseProviderScopeAll('admin')).toBe(true);
    expect(canUseProviderScopeAll('beutalo_orvos')).toBe(true);
    expect(canUseProviderScopeAll('fogpótlástanász')).toBe(true);
  });
  it('denies other roles', () => {
    expect(canUseProviderScopeAll('patient')).toBe(false);
    expect(canUseProviderScopeAll(undefined)).toBe(false);
  });
});

describe('getFirstBookableSlotForEpisode', () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.mocked(getDbPool).mockReturnValue({ query } as never);
    query.mockReset();
    vi.mocked(nextRequiredStep).mockReset();
    vi.mocked(getProviderIdForEpisode).mockReset();
  });

  it('returns blocked payload when next step is blocked', async () => {
    vi.mocked(nextRequiredStep).mockResolvedValue({
      status: 'blocked',
      required_prereq_keys: ['x'],
      reason: 'blocked reason',
      block_keys: ['b'],
      code: 'NO_CARE_PATHWAY',
    });

    const r = await getFirstBookableSlotForEpisode('ep1');
    expect(r).toEqual({
      kind: 'blocked',
      status: 'blocked',
      blockedReason: 'blocked reason',
      requiredPrereqs: ['x'],
      blockKeys: ['b'],
      code: 'NO_CARE_PATHWAY',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('adds provider filter when episode resolves a dentist', async () => {
    const earliest = new Date('2030-01-05T10:00:00.000Z');
    const latest = new Date('2030-01-20T18:00:00.000Z');
    vi.mocked(nextRequiredStep).mockResolvedValue({
      work_phase_code: 'wp1',
      pool: 'work',
      duration_minutes: 45,
      earliest_date: earliest,
      latest_date: latest,
    });
    vi.mocked(getProviderIdForEpisode).mockResolvedValue('dentist-1');
    query.mockResolvedValue({
      rows: [
        {
          id: 'slot-1',
          startTime: new Date('2030-01-10T09:00:00.000Z'),
          durationMinutes: 60,
          slotPurpose: 'work',
          state: 'free',
          dentistEmail: 'd@test',
          dentistName: 'Dr T',
          dentistUserId: 'dentist-1',
        },
      ],
    });

    const r = await getFirstBookableSlotForEpisode('ep1');
    expect(r.kind).toBe('slot');
    if (r.kind === 'slot') {
      expect(r.slotId).toBe('slot-1');
      expect(r.dentistUserId).toBe('dentist-1');
      expect(r.providerFilterUserId).toBe('dentist-1');
    }
    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain('ats.user_id = $');
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toContain('dentist-1');
  });

  it('omits provider filter when providerScope=all and role allowed', async () => {
    const earliest = new Date('2030-01-05T10:00:00.000Z');
    const latest = new Date('2030-01-20T18:00:00.000Z');
    vi.mocked(nextRequiredStep).mockResolvedValue({
      work_phase_code: 'wp1',
      pool: 'work',
      duration_minutes: 30,
      earliest_date: earliest,
      latest_date: latest,
    });
    vi.mocked(getProviderIdForEpisode).mockResolvedValue('dentist-1');
    query.mockResolvedValue({
      rows: [
        {
          id: 'slot-2',
          startTime: new Date('2030-01-06T08:00:00.000Z'),
          durationMinutes: 30,
          slotPurpose: 'work',
          state: 'free',
          dentistEmail: 'other@test',
          dentistName: 'Dr Other',
          dentistUserId: 'dentist-2',
        },
      ],
    });

    const r = await getFirstBookableSlotForEpisode('ep1', { providerScope: 'all', authRole: 'admin' });
    expect(r.kind).toBe('slot');
    if (r.kind === 'slot') {
      expect(r.dentistUserId).toBe('dentist-2');
      expect(r.providerFilterUserId).toBeNull();
    }
    const sql = query.mock.calls[0][0] as string;
    expect(sql).not.toMatch(/ats\.user_id = \$/);
  });

  it('returns none when query returns no row', async () => {
    const earliest = new Date('2030-01-05T10:00:00.000Z');
    const latest = new Date('2030-01-06T18:00:00.000Z');
    vi.mocked(nextRequiredStep).mockResolvedValue({
      work_phase_code: 'wp1',
      pool: 'consult',
      duration_minutes: 30,
      earliest_date: earliest,
      latest_date: latest,
    });
    vi.mocked(getProviderIdForEpisode).mockResolvedValue(null);
    query.mockResolvedValue({ rows: [] });

    const r = await getFirstBookableSlotForEpisode('ep1');
    expect(r).toMatchObject({
      kind: 'none',
      pool: 'consult',
      durationMinutes: 30,
      workPhaseCode: 'wp1',
      providerFilterUserId: null,
    });
  });
});

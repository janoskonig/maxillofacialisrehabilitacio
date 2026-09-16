import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getDbPool: () => ({ query: queryMock }),
}));

import { cancelConsiliumMeetingTaskForUser } from '@/lib/user-tasks';

const TASK_ID = '123e4567-e89b-42d3-a456-426614174000';

beforeEach(() => {
  queryMock.mockReset();
});

describe('cancelConsiliumMeetingTaskForUser — technikus szereplő', () => {
  it('technikus címzett is visszavonhatja a neki delegált konzílium-feladatot (nincs szerepkör-rövidzár)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: TASK_ID }] });
    await expect(
      cancelConsiliumMeetingTaskForUser(TASK_ID, 'tech-1', 'technikus', 'SE Fogpótlástani Klinika'),
    ).resolves.toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual([TASK_ID, 'tech-1', 'SE Fogpótlástani Klinika', 'technikus']);
  });

  it('a jogosultságot továbbra is az SQL dönti el: nincs találat → false', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(
      cancelConsiliumMeetingTaskForUser(TASK_ID, 'tech-1', 'technikus', 'SE Fogpótlástani Klinika'),
    ).resolves.toBe(false);
  });
});

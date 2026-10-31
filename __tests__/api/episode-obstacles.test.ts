import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn(), emit: vi.fn() }));
vi.mock('@/lib/api/route-handler', () => ({
  roleHandler: (_roles: unknown, handler: unknown) => handler,
  authedHandler: (handler: unknown) => handler,
}));
vi.mock('@/lib/db', () => ({ getDbPool: () => ({ query: mocks.query, connect: mocks.connect }) }));
vi.mock('@/lib/scheduling-events', () => ({ emitSchedulingEvent: mocks.emit }));
import { POST } from '@/app/api/episodes/[id]/blocks/route';
import { PATCH } from '@/app/api/episode-blocks/[id]/route';
import { GET } from '@/app/api/episode-blocks/route';

const context = { params: { id: 'episode-1' }, auth: { userId: 'user-1', email: 'staff@example.test', role: 'admin' }, correlationId: 'test' } as const;
const request = (body: unknown, method = 'POST') => new NextRequest('http://localhost/api/episodes/episode-1/blocks', { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  mocks.emit.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT id, status')) return { rows: [{ id: 'episode-1', status: 'open' }] };
    if (sql.startsWith('SELECT id, active')) return { rows: [{ id: 'block-1', active: true, waiting_since: new Date('2026-10-01T10:00:00Z') }] };
    if (sql.includes('RETURNING')) return { rows: [{ id: 'block-1', episodeId: 'episode-1' }] };
    return { rows: [] };
  });
});

describe('episode obstacle mutations', () => {
  it('rejects an unspecified waiting party before writing anything', async () => {
    const response = await POST(request({ key: 'WAIT_QUOTE', waitingOn: ' ' }), context);
    expect(response.status).toBe(400);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('creates an open-ended obstacle with an explicit stable waiting date and author', async () => {
    const response = await POST(request({ key: 'WAIT_QUOTE', waitingOn: 'Minta Fogtechnika', waitingSince: '2020-10-01', expectedUnblockDate: '2020-10-15' }), context);
    expect(response.status).toBe(201);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('true, NULL'), ['episode-1', 'WAIT_QUOTE', 'Minta Fogtechnika', '2020-10-01', '2020-10-15', null, 'user-1']);
    expect(mocks.query).toHaveBeenCalledWith('COMMIT');
    expect(mocks.emit).toHaveBeenCalledWith('block', 'block-1', 'created');
    expect(mocks.release).toHaveBeenCalled();
  });

  it('does not attach a new obstacle to a closed treatment', async () => {
    mocks.query.mockResolvedValue({ rows: [{ id: 'episode-1', status: 'closed' }] });
    expect((await POST(request({ key: 'WAIT_QUOTE', waitingOn: 'Minta Fogtechnika' }), context)).status).toBe(409);
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('records explicit resolution without deleting waiting history', async () => {
    const response = await PATCH(request({ action: 'resolve', resolutionNote: 'Árajánlat megérkezett' }, 'PATCH'), context);
    expect(response.status).toBe(200);
    const update = mocks.query.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE'))!;
    expect(update[0]).toContain('active = false, resolved_at = CURRENT_TIMESTAMP');
    expect(update[0]).not.toContain('waiting_since =');
    expect(update[1]).toEqual(['episode-1', 'user-1', 'Árajánlat megérkezett']);
    expect(mocks.emit).toHaveBeenCalledWith('block', 'block-1', 'resolved');
  });

  it('updates who and when without resetting the original waiting date or adding an expiry', async () => {
    const response = await PATCH(request({ action: 'update', key: 'WAIT_QUOTE', waitingOn: 'Másik Labor', expectedUnblockDate: '2026-11-10', waitingSince: '2026-10-20' }, 'PATCH'), context);
    expect(response.status).toBe(200);
    const update = mocks.query.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE'))!;
    expect(update[0]).not.toContain('waiting_since =');
    expect(update[0]).not.toContain('expires_at =');
  });

  it('rejects a revised response date before waiting began', async () => {
    expect((await PATCH(request({ action: 'update', key: 'WAIT_QUOTE', waitingOn: 'Labor', expectedUnblockDate: '2026-09-20' }, 'PATCH'), context)).status).toBe(400);
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE'))).toBe(false);
  });

  it('rolls back a failed write and emits no scheduling change', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO episode_blocks')) throw new Error('write failed');
      return { rows: [{ id: 'episode-1', status: 'open' }] };
    });
    await expect(POST(request({ key: 'WAIT_HISTOLOGY', waitingOn: 'Patológia' }), context)).rejects.toThrow('write failed');
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.release).toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('loads the waiting list without requiring a treatment pathway or truncating to 200 records', async () => {
    const response = await GET(request(null), context);
    expect(response.status).toBe(200);
    const sql = mocks.query.mock.calls[0][0];
    expect(sql).toContain('b.expires_at IS NULL');
    expect(sql).toContain("pe.status = 'open'");
    expect(sql).not.toContain('care_pathway_id');
    expect(sql).not.toContain('LIMIT 200');
  });
});

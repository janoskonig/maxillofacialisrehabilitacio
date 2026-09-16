import { describe, it, expect, vi, beforeEach } from 'vitest';

const auditMock = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@/lib/work-phase-audit', () => ({
  insertWorkPhaseAudit: (...a: unknown[]) => auditMock(...a),
}));

import { purgeCancelledAppointmentsOnSlot } from '@/lib/appointment-slot-release';
import { HttpError } from '@/lib/auth-server';

/**
 * Halott (lemondott) foglalás-sor eltakarítása a slotról az újrafoglaló írás előtt.
 */
function makeClient(opts: { dead?: Array<{ id: string; episode_id: string | null }>; linked?: Array<{ id: string; episode_id: string; status: string }>; deleteError?: unknown } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (/SELECT id, episode_id FROM appointments/.test(sql)) return { rows: opts.dead ?? [] };
    if (/FROM episode_work_phases WHERE appointment_id = ANY/.test(sql)) return { rows: opts.linked ?? [] };
    if (/DELETE FROM appointments/.test(sql)) {
      if (opts.deleteError) throw opts.deleteError;
      return { rows: [], rowCount: (opts.dead ?? []).length };
    }
    return { rows: [], rowCount: 1 };
  });
  return { query } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('purgeCancelledAppointmentsOnSlot', () => {
  it('nincs halott sor: nem töröl semmit', async () => {
    const client = makeClient();
    expect(await purgeCancelledAppointmentsOnSlot(client, 'slot-1')).toEqual([]);
    expect(client.query.mock.calls.some(([s]: [string]) => /DELETE/.test(s))).toBe(false);
  });

  it('csak a lemondott sorokat célozza, a kivétel-sort kihagyja, aktívat nem bánt', async () => {
    const client = makeClient({ dead: [{ id: 'dead-1', episode_id: null }] });
    const ids = await purgeCancelledAppointmentsOnSlot(client, 'slot-1', { exceptAppointmentId: 'moving-1' });
    expect(ids).toEqual(['dead-1']);
    const [selectSql, selectParams] = client.query.mock.calls[0];
    expect(selectSql).toMatch(/appointment_status IN \('cancelled_by_doctor', 'cancelled_by_patient'\)/);
    expect(selectSql).toMatch(/id <> \$2/);
    expect(selectSql).toMatch(/FOR UPDATE/);
    expect(selectParams).toEqual(['slot-1', 'moving-1']);
    const del = client.query.mock.calls.find(([s]: [string]) => /DELETE FROM appointments WHERE id = ANY/.test(s));
    expect(del![1]).toEqual([['dead-1']]);
  });

  it('dangling fázis-link: a fázis visszanyílik (pending) audittal', async () => {
    const client = makeClient({
      dead: [{ id: 'dead-1', episode_id: 'ep-1' }],
      linked: [{ id: 'ewp-1', episode_id: 'ep-1', status: 'scheduled' }],
    });
    await purgeCancelledAppointmentsOnSlot(client, 'slot-1', { changedBy: 'admin@dev.local' });
    const upd = client.query.mock.calls.find(([s]: [string]) => /UPDATE episode_work_phases/.test(s));
    expect(upd![0]).toMatch(/appointment_id = NULL/);
    expect(upd![1]).toEqual(['ewp-1']);
    expect(auditMock).toHaveBeenCalledWith(client, expect.objectContaining({ episodeWorkPhaseId: 'ewp-1', newStatus: 'pending', changeType: 'integrity_repair' }));
  });

  it('FK RESTRICT (tervkötés-napló) → érthető 409', async () => {
    const client = makeClient({ dead: [{ id: 'dead-1', episode_id: null }], deleteError: Object.assign(new Error('fk'), { code: '23503' }) });
    await expect(purgeCancelledAppointmentsOnSlot(client, 'slot-1')).rejects.toMatchObject({ status: 409, code: 'CANCELLED_ROW_LOCKED' });
    await purgeCancelledAppointmentsOnSlot(client, 'slot-1').catch((e) => expect(e).toBeInstanceOf(HttpError));
  });
});

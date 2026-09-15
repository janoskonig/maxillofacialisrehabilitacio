import { describe, it, expect, vi, beforeEach } from 'vitest';

const findEwpMock = vi.fn();
const revertMock = vi.fn(async () => undefined);
vi.mock('@/lib/episode-work-phase-revert-lookup', () => ({
  findEwpForAppointmentRevert: (...a: unknown[]) => findEwpMock(...a),
  revertWorkPhaseLinkToPending: (...a: unknown[]) => revertMock(...(a as [])),
}));

import { releaseRejectedOfferLinks } from '@/lib/conditional-offer-release';

/**
 * Elutasított ajánlat kötéseinek elengedése: sima ajánlatnál no-op, epizódhoz
 * kötöttnél státusz cancelled_by_patient + fázis visszanyitás + recall-elengedés.
 */
function makeClient(opts: { recallLinked?: boolean } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (/FROM episode_tasks WHERE appointment_id = \$1/.test(sql)) {
      return { rows: opts.recallLinked ? [{ '?column?': 1 }] : [] };
    }
    if (/UPDATE appointments/.test(sql)) return { rows: [{ id: 'x' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { query } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('releaseRejectedOfferLinks', () => {
  it('sima (epizód/fázis/recall nélküli) ajánlat: nem nyúl a sorhoz', async () => {
    const client = makeClient();
    const r = await releaseRejectedOfferLinks(client, { id: 'a1', episode_id: null, step_code: null, work_phase_id: null });
    expect(r).toEqual({ released: false, workPhaseReopened: false });
    expect(client.query.mock.calls.some(([s]: [string]) => /UPDATE appointments/.test(s))).toBe(false);
    expect(findEwpMock).not.toHaveBeenCalled();
  });

  it('epizódhoz kötött ajánlat: cancelled_by_patient + esemény + fázis pending + REPROJECT', async () => {
    findEwpMock.mockResolvedValue({ id: 'ewp1', status: 'scheduled', appointmentId: 'a1' });
    const client = makeClient();
    const r = await releaseRejectedOfferLinks(client, { id: 'a1', episode_id: 'ep1', step_code: 'lenyomat', work_phase_id: 'ewp1' });
    expect(r).toEqual({ released: true, workPhaseReopened: true });
    const sql = client.query.mock.calls.map(([s]: [string]) => s);
    expect(sql.some((s: string) => /SET appointment_status = 'cancelled_by_patient'/.test(s))).toBe(true);
    expect(sql.some((s: string) => /INSERT INTO appointment_status_events/.test(s))).toBe(true);
    expect(revertMock).toHaveBeenCalledWith(client, expect.objectContaining({ ewpId: 'ewp1', episodeId: 'ep1', oldEwpStatus: 'scheduled' }));
    expect(sql.some((s: string) => /REPROJECT_INTENTS/.test(s))).toBe(true);
  });

  it('ha a fázis már máshoz kötődik, nem nyitja vissza, de a sort lezárja', async () => {
    findEwpMock.mockResolvedValue({ id: 'ewp1', status: 'scheduled', appointmentId: 'masik' });
    const client = makeClient();
    const r = await releaseRejectedOfferLinks(client, { id: 'a1', episode_id: 'ep1', step_code: 'lenyomat', work_phase_id: 'ewp1' });
    expect(r).toEqual({ released: true, workPhaseReopened: false });
    expect(revertMock).not.toHaveBeenCalled();
  });

  it('recall-kötött ajánlat: a feladat visszakerül foglalhatóra', async () => {
    const client = makeClient({ recallLinked: true });
    const r = await releaseRejectedOfferLinks(client, { id: 'a1', episode_id: null, step_code: null, work_phase_id: null });
    expect(r.released).toBe(true);
    const sql = client.query.mock.calls.map(([s]: [string]) => s);
    expect(sql.some((s: string) => /UPDATE episode_tasks SET appointment_id = NULL, completed_at = NULL/.test(s))).toBe(true);
  });
});

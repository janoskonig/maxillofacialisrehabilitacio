/**
 * Puzzle v2 (094) — séma-őr: a 094-es migráció ELŐTTI DB-n (nincs
 * episode_visits.appointment_id) a vizit-időpont helperek csendben kimaradnak,
 * nem 42703-mal buknak — a deploy migráció előtt is működjön a terv-fül és a
 * foglalás (adoptAppointmentForPhaseVisit a booking-motorokban fut!).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetSchemaProbeCacheForTests } from '@/lib/schema-probe';
import {
  adoptAppointmentForPhaseVisit,
  hasVisitAppointmentColumn,
  listUnattachedAppointments,
  normalizeVisitOrder,
} from '@/lib/visit-appointment-sync';

/** Fake client: az information_schema probe 0 sort ad (nincs oszlop); minden más SQL tiltott. */
function clientWithoutColumn() {
  const queries: string[] = [];
  const client = {
    query: async (text: string) => {
      queries.push(text);
      if (/information_schema\.columns/i.test(text)) return { rows: [], rowCount: 0 };
      throw new Error(`Váratlan lekérdezés a 094 előtti sémán: ${text.slice(0, 60)}`);
    },
  };
  return { client, queries };
}

beforeEach(() => {
  _resetSchemaProbeCacheForTests();
});

describe('vizit-időpont helperek a 094 előtti sémán', () => {
  it('hasVisitAppointmentColumn → false, és a probe eredménye cache-elődik', async () => {
    const { client, queries } = clientWithoutColumn();
    expect(await hasVisitAppointmentColumn(client as never)).toBe(false);
    expect(await hasVisitAppointmentColumn(client as never)).toBe(false);
    expect(queries.filter((q) => /information_schema/i.test(q))).toHaveLength(1);
  });

  it('adoptAppointmentForPhaseVisit no-op (false), nem ír', async () => {
    const { client, queries } = clientWithoutColumn();
    expect(await adoptAppointmentForPhaseVisit(client as never, 'phase-1', 'appt-1')).toBe(false);
    expect(queries.some((q) => /UPDATE episode_visits/i.test(q))).toBe(false);
  });

  it('normalizeVisitOrder no-op (false)', async () => {
    const { client } = clientWithoutColumn();
    expect(await normalizeVisitOrder(client as never, 'ep-1')).toBe(false);
  });

  it('listUnattachedAppointments üres lista', async () => {
    const { client } = clientWithoutColumn();
    expect(await listUnattachedAppointments(client as never, 'ep-1')).toEqual([]);
  });
});

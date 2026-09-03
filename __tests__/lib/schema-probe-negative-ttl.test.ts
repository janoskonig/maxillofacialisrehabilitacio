/**
 * Schema-probe: a negatív találat (nincs oszlop) lejár, a pozitív örök.
 *
 * Élesben a kézi `npm run migrate` a futó folyamat mellett hozza létre az
 * oszlopot; a korábbi „örök" negatív cache miatt a funkció a következő
 * deployig halott maradt volna. Most legfeljebb 60 mp múlva újraprobe-ol.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetSchemaProbeCacheForTests, probeColumnExists } from '@/lib/schema-probe';

function dbWithColumnPresence(present: { value: boolean }) {
  let probes = 0;
  const db = {
    query: async () => {
      probes++;
      return { rows: present.value ? [{ '?column?': 1 }] : [] };
    },
  };
  return { db, probeCount: () => probes };
}

beforeEach(() => {
  _resetSchemaProbeCacheForTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-03T06:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('probeColumnExists — negatív TTL', () => {
  it('a negatív találat 60 mp-ig cache-elt, utána újraprobe-ol és a pozitívat örökre megjegyzi', async () => {
    const present = { value: false };
    const { db, probeCount } = dbWithColumnPresence(present);

    expect(await probeColumnExists(db as never, 'episode_visits', 'appointment_id')).toBe(false);
    expect(await probeColumnExists(db as never, 'episode_visits', 'appointment_id')).toBe(false);
    expect(probeCount()).toBe(1); // cache-ből

    // Kézi migráció a futó folyamat mellett: az oszlop megjelenik.
    present.value = true;
    vi.advanceTimersByTime(30 * 1000);
    expect(await probeColumnExists(db as never, 'episode_visits', 'appointment_id')).toBe(false); // még a TTL-en belül
    expect(probeCount()).toBe(1);

    vi.advanceTimersByTime(31 * 1000);
    expect(await probeColumnExists(db as never, 'episode_visits', 'appointment_id')).toBe(true); // újraprobe
    expect(probeCount()).toBe(2);

    // Pozitív: örök cache, a lejárat nem érinti.
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(await probeColumnExists(db as never, 'episode_visits', 'appointment_id')).toBe(true);
    expect(probeCount()).toBe(2);
  });

  it('a párhuzamos első hívások egy probe-on osztoznak', async () => {
    const { db, probeCount } = dbWithColumnPresence({ value: true });
    const [a, b, c] = await Promise.all([
      probeColumnExists(db as never, 't', 'c'),
      probeColumnExists(db as never, 't', 'c'),
      probeColumnExists(db as never, 't', 'c'),
    ]);
    expect([a, b, c]).toEqual([true, true, true]);
    expect(probeCount()).toBe(1);
  });
});

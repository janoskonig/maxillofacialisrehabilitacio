/**
 * WP-2.2 — „A terv változásai" (PlanHistoryLog) komponens-teszt.
 *
 * happy-dom + mock fetch:
 * - LUSTA betöltés: a lista csak a <details> kinyitásakor fetchel, nem
 *   minden kartonnyitásnál;
 * - a fejléc N-je a GET count mezőjéből jön;
 * - a sorok formátuma: idő · név · összefoglaló — reason;
 * - „Továbbiak betöltése": lapozás offsettel, a sorok hozzáfűződnek;
 * - üres napló és hibaág.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PlanHistoryLog } from '@/components/PlanHistoryLog';
import type { PlanHistoryEntry } from '@/lib/plan-history';

const EPISODE_ID = 'ep-wp22';

function makeEntry(overrides: Partial<PlanHistoryEntry> & { id: string }): PlanHistoryEntry {
  return {
    createdAt: '2026-08-20T14:12:00.000Z',
    changedBy: 'Dr. Kiss Anna',
    changeType: 'delete',
    oldStatus: 'pending',
    newStatus: 'deleted',
    workPhaseCode: 'koronaproba',
    phaseLabel: 'Koronapróba',
    reason: null,
    summary: 'elhagyta: Koronapróba',
    ...overrides,
  };
}

function installFetchMock(opts: { entries: PlanHistoryEntry[]; failFirst?: boolean } = { entries: [] }) {
  let failNext = opts.failFirst ?? false;
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const match = url.match(
      new RegExp(`/api/episodes/${EPISODE_ID}/plan-history\\?limit=(\\d+)&offset=(\\d+)`)
    );
    if (!match) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response);
    }
    if (failNext) {
      failNext = false;
      return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) } as Response);
    }
    const limit = Number(match[1]);
    const offset = Number(match[2]);
    const page = opts.entries.slice(offset, offset + limit);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          entries: page,
          count: opts.entries.length,
          limit,
          offset,
          hasMore: offset + page.length < opts.entries.length,
        }),
    } as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PlanHistoryLog — lusta betöltés', () => {
  it('lecsukva NEM fetchel; kinyitáskor tölt, és a fejléc megkapja az N-t', async () => {
    const fetchMock = installFetchMock({
      entries: [makeEntry({ id: 'e1' }), makeEntry({ id: 'e2', summary: 'hozzáadta: Lenyomat' })],
    });
    render(<PlanHistoryLog episodeId={EPISODE_ID} />);

    // Lecsukott állapot: cím látszik, fetch még nem történt.
    expect(screen.getByText('A terv változásai')).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('A terv változásai'));

    await waitFor(() => {
      expect(screen.getByText('A terv változásai (2)')).toBeDefined();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      `/api/episodes/${EPISODE_ID}/plan-history?limit=20&offset=0`
    );
  });
});

describe('PlanHistoryLog — sorok renderelése', () => {
  it('idő · név · összefoglaló — reason formátumban jelenik meg (törölt fázis snapshotból)', async () => {
    installFetchMock({
      entries: [
        makeEntry({
          id: 'e1',
          summary: 'elhagyta: Koronapróba',
          reason: 'Manuálisan törölve (2 foglalás lemondva)',
        }),
      ],
    });
    render(<PlanHistoryLog episodeId={EPISODE_ID} />);
    fireEvent.click(screen.getByText('A terv változásai'));

    await waitFor(() => {
      expect(screen.getByText('Dr. Kiss Anna')).toBeDefined();
    });
    // A törölt fázis neve a snapshotból olvasható marad.
    expect(screen.getByText('elhagyta: Koronapróba')).toBeDefined();
    expect(screen.getByText(/— Manuálisan törölve \(2 foglalás lemondva\)/)).toBeDefined();
    // Az időbélyeg kompakt (ÉÉÉÉ-HH-NN ÓÓ:PP) — a pontos óra a helyi zónától függ.
    expect(screen.getByText(/^2026-08-\d{2} \d{2}:\d{2}$/)).toBeDefined();
  });

  it('üres napló: barátságos üres-szöveg, visszavonás-gomb pedig sehol', async () => {
    installFetchMock({ entries: [] });
    render(<PlanHistoryLog episodeId={EPISODE_ID} />);
    fireEvent.click(screen.getByText('A terv változásai'));

    await waitFor(() => {
      expect(screen.getByText('Még nincs naplózott változás.')).toBeDefined();
    });
    expect(screen.queryByText(/visszavon/i)).toBeNull();
  });
});

describe('PlanHistoryLog — lapozás', () => {
  it('„Továbbiak betöltése": a következő oldal hozzáfűződik, a gomb a végén eltűnik', async () => {
    // 22 bejegyzés → első oldal 20, második 2.
    const entries = Array.from({ length: 22 }, (_, i) =>
      makeEntry({ id: `e${i}`, summary: `bejegyzés-${i}` })
    );
    const fetchMock = installFetchMock({ entries });
    render(<PlanHistoryLog episodeId={EPISODE_ID} />);
    fireEvent.click(screen.getByText('A terv változásai'));

    await waitFor(() => {
      expect(screen.getByText('bejegyzés-0')).toBeDefined();
    });
    expect(screen.getByText('bejegyzés-19')).toBeDefined();
    expect(screen.queryByText('bejegyzés-20')).toBeNull();

    fireEvent.click(screen.getByText('Továbbiak betöltése'));

    await waitFor(() => {
      expect(screen.getByText('bejegyzés-21')).toBeDefined();
    });
    // Az első oldal sorai megmaradtak (append, nem csere).
    expect(screen.getByText('bejegyzés-0')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('offset=20');
    // Nincs több oldal → a gomb eltűnik.
    expect(screen.queryByText('Továbbiak betöltése')).toBeNull();
  });
});

describe('PlanHistoryLog — hibaág', () => {
  it('sikertelen betöltésnél hibaszöveg + Újra gomb, ami újra próbál', async () => {
    installFetchMock({ entries: [makeEntry({ id: 'e1' })], failFirst: true });
    render(<PlanHistoryLog episodeId={EPISODE_ID} />);
    fireEvent.click(screen.getByText('A terv változásai'));

    await waitFor(() => {
      expect(screen.getByText('A változásnapló betöltése sikertelen.')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Újra'));
    await waitFor(() => {
      expect(screen.getByText('elhagyta: Koronapróba')).toBeDefined();
    });
  });
});

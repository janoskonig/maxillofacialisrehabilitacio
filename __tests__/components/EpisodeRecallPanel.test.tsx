/**
 * WP-3.3 — „Gondozás" kártya (EpisodeRecallPanel)
 *
 * Könnyű komponens-teszt (happy-dom) mock fetch-csel:
 * - üres állapotban is renderel (cím + rizikó-választó + kézi felvétel);
 * - a kézi űrlap submitje POST-ol a recall-tasks végpontra;
 * - a lejárt sor kiemelt, az állapotszövegek helyesek;
 * - a rizikó-váltó PATCH-eli az epizódot (recallRiskLevel);
 * - a kadenciából kikerült auto sor törlésre FELAJÁNLOTT (halk sáv), és a
 *   Törlés gomb DELETE-et hív — automatikus törlés nincs.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { EpisodeRecallPanel } from '@/components/EpisodeRecallPanel';

// A foglalási szekció nehéz komponens (naptár, slot-lekérések) — itt csak azt
// ellenőrizzük, hogy a „Foglalás" a meglévő recall-foglalási utat nyitja meg.
vi.mock('@/components/AppointmentBookingSection', () => ({
  AppointmentBookingSection: (props: { recallTaskId?: string | null }) => (
    <div data-testid="booking-section">booking:{props.recallTaskId}</div>
  ),
}));

const EPISODE_ID = 'ep1';
const DAY_MS = 24 * 60 * 60 * 1000;

interface MockTask {
  id: string;
  episodeId: string;
  intervalDays: number;
  source: string;
  label: string | null;
  dueAt: string;
  completedAt: string | null;
  appointmentId: string | null;
  appointmentStart: string | null;
  appointmentStatus: string | null;
  dentistEmail: string | null;
}

function makeTask(overrides: Partial<MockTask>): MockTask {
  return {
    id: 't1',
    episodeId: EPISODE_ID,
    intervalDays: 180,
    source: 'auto',
    label: null,
    dueAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    completedAt: null,
    appointmentId: null,
    appointmentStart: null,
    appointmentStatus: null,
    dentistEmail: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function installFetchMock(opts: { tasks?: MockTask[]; riskLevel?: string | null } = {}) {
  // A PATCH-elt rizikószintet a mock megjegyzi, hogy a mentés utáni reload
  // (GET /api/episodes/:id) már az új értéket adja vissza — mint a szerver.
  let currentRisk: string | null = opts.riskLevel ?? null;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === `/api/episodes/${EPISODE_ID}/recall-tasks` && method === 'GET') {
      return jsonResponse({ recallTasks: opts.tasks ?? [] });
    }
    if (url === `/api/episodes/${EPISODE_ID}/recall-tasks` && method === 'POST') {
      return jsonResponse({ recallTask: makeTask({ id: 'új', source: 'manual' }) }, 201);
    }
    if (url === `/api/episodes/${EPISODE_ID}` && method === 'GET') {
      return jsonResponse({ episode: { id: EPISODE_ID, recallRiskLevel: currentRisk } });
    }
    if (url === `/api/episodes/${EPISODE_ID}` && method === 'PATCH') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      currentRisk = body.recallRiskLevel ?? null;
      return jsonResponse({
        episode: { id: EPISODE_ID, recallRiskLevel: currentRisk },
        recall: { ensuredCount: 0, obsoleteAutoTasks: [] },
      });
    }
    if (/\/recall-tasks\/[^/]+$/.test(url) && method === 'DELETE') {
      return jsonResponse({ ok: true });
    }
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EpisodeRecallPanel — üres állapot', () => {
  it('nulla sornál is renderel: cím, rizikó-választó, üres-szöveg és kézi felvétel', async () => {
    installFetchMock({ tasks: [] });
    render(<EpisodeRecallPanel episodeId={EPISODE_ID} patientId="p1" />);

    await waitFor(() => {
      expect(screen.getByText('Gondozás')).toBeDefined();
    });

    // Rizikócsoport-választó a fejlécben + a „csak javaslat" mondat
    expect(screen.getByText('Alacsony')).toBeDefined();
    expect(screen.getByText('Közepes')).toBeDefined();
    expect(screen.getByText('Magas')).toBeDefined();
    expect(screen.getByText(/csak a javasolt kontroll-kadenciát állítja/)).toBeDefined();

    // Üres állapot — az orvos így is fel tud venni kézi sort
    expect(screen.getByText(/még nincs visszarendelés/)).toBeDefined();
    expect(screen.getByText('Visszarendelés hozzáadása')).toBeDefined();

    // Az alcím nem köti magát a 6/12 hónapos megkötéshez
    expect(screen.queryByText(/6 és 12 hónapos/)).toBeNull();
  });

  it('rizikószint nélkül (NULL) a mai viselkedés — Alacsony — jelenik meg kiválasztottként', async () => {
    installFetchMock({ tasks: [], riskLevel: null });
    render(<EpisodeRecallPanel episodeId={EPISODE_ID} patientId="p1" />);

    await waitFor(() => {
      expect(screen.getByText('Gondozás')).toBeDefined();
    });

    expect(screen.getByText('Alacsony').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Magas').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('EpisodeRecallPanel — kézi visszarendelés', () => {
  it('az űrlap submitje POST-ol a recall-tasks végpontra nappal és címkével', async () => {
    const fetchMock = installFetchMock({ tasks: [] });
    render(<EpisodeRecallPanel episodeId={EPISODE_ID} patientId="p1" />);

    await waitFor(() => {
      expect(screen.getByText('Visszarendelés hozzáadása')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Visszarendelés hozzáadása'));
    fireEvent.change(screen.getByPlaceholderText('pl. 14'), { target: { value: '14' } });
    fireEvent.change(screen.getByPlaceholderText('pl. 2 hetes sebgyógyulási kontroll'), {
      target: { value: 'Varratszedés utáni kontroll' },
    });
    fireEvent.click(screen.getByText('Hozzáadás'));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url) === `/api/episodes/${EPISODE_ID}/recall-tasks` &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(post).toBeDefined();
      const body = JSON.parse(String((post![1] as RequestInit).body));
      expect(body).toEqual({ intervalDays: 14, label: 'Varratszedés utáni kontroll' });
    });

    // Sikeres mentés után az űrlap lecsukódik
    await waitFor(() => {
      expect(screen.queryByText('Hozzáadás')).toBeNull();
    });
  });

  it('nem-pozitív napszámmal nem POST-ol, hanem hibát mutat', async () => {
    const fetchMock = installFetchMock({ tasks: [] });
    render(<EpisodeRecallPanel episodeId={EPISODE_ID} patientId="p1" />);

    await waitFor(() => {
      expect(screen.getByText('Visszarendelés hozzáadása')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Visszarendelés hozzáadása'));
    fireEvent.change(screen.getByPlaceholderText('pl. 14'), { target: { value: '0' } });
    // A natív required/min HTML-validáció happy-domban nem fut — a submit a
    // komponens saját őrét teszteli.
    fireEvent.submit(screen.getByText('Hozzáadás').closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/pozitív egész napszám/)).toBeDefined();
    });
    const post = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(post).toBeUndefined();
  });
});

describe('EpisodeRecallPanel — lista és állapotok', () => {
  it('egy időrendi lista: lejárt sor kiemelve, állapotok (Nincs foglalva / Foglalva / Teljesült)', async () => {
    const past = new Date(Date.now() - 10 * DAY_MS).toISOString();
    installFetchMock({
      tasks: [
        makeTask({ id: 'lejart', intervalDays: 30, label: '1 hónapos kontroll', dueAt: past }),
        makeTask({
          id: 'foglalt',
          intervalDays: 180,
          label: '6 hónapos kontroll',
          appointmentId: 'apt1',
          appointmentStart: new Date(Date.now() + 20 * DAY_MS).toISOString(),
        }),
        makeTask({
          id: 'kesz',
          intervalDays: 14,
          label: '2 hetes sebgyógyulási kontroll',
          dueAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
          completedAt: new Date(Date.now() - 25 * DAY_MS).toISOString(),
        }),
        makeTask({ id: 'jovo', intervalDays: 365, label: '12 hónapos kontroll' }),
      ],
      riskLevel: 'high',
    });
    const { container } = render(<EpisodeRecallPanel episodeId={EPISODE_ID} patientId="p1" />);

    await waitFor(() => {
      expect(screen.getByText('Gondozás')).toBeDefined();
    });

    // Rövid és hosszú távú sor EGY listában, címkével
    expect(screen.getByText('1 hónapos kontroll')).toBeDefined();
    expect(screen.getByText('12 hónapos kontroll')).toBeDefined();

    // Lejárt sor kiemelve (csak a foglalatlan, nem teljesült múltbeli)
    expect(screen.getAllByText('Lejárt').length).toBe(1);
    expect(container.querySelectorAll('.border-red-300').length).toBe(1);

    // Állapotszövegek
    expect(screen.getAllByText('Nincs foglalva').length).toBe(2); // lejárt + jövőbeli
    expect(screen.getByText(/Foglalva:/)).toBeDefined();
    expect(screen.getByText(/Teljesült:/)).toBeDefined();

    // Foglalás gomb csak a szabad sorokon (foglalt/teljesült sorokon nincs)
    expect(screen.getAllByText('Foglalás').length).toBe(2);
  });

  it('a Foglalás gomb a meglévő recall-foglalási utat nyitja a sor task-id-jával', async () => {
    installFetchMock({
      tasks: [makeTask({ id: 'recall-task-9', label: '6 hónapos kontroll' })],
    });
    render(<EpisodeRecallPanel episodeId={EPISODE_ID} patientId="p1" />);

    await waitFor(() => {
      expect(screen.getByText('Foglalás')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Foglalás'));

    expect(screen.getByTestId('booking-section').textContent).toBe('booking:recall-task-9');
  });
});

describe('EpisodeRecallPanel — rizikócsoport-váltás', () => {
  it('a választó PATCH-eli az epizód recallRiskLevel mezőjét', async () => {
    const fetchMock = installFetchMock({ tasks: [], riskLevel: 'low' });
    render(<EpisodeRecallPanel episodeId={EPISODE_ID} patientId="p1" />);

    await waitFor(() => {
      expect(screen.getByText('Magas')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Magas'));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url) === `/api/episodes/${EPISODE_ID}` &&
          (init as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({ recallRiskLevel: 'high' });
    });

    await waitFor(() => {
      expect(screen.getByText('Magas').getAttribute('aria-pressed')).toBe('true');
    });
  });

  it('a kadenciából kikerült szabad auto sort halk sávban törlésre ajánlja; a Törlés DELETE-et hív, magától nem töröl', async () => {
    // low kadencia (180/365) mellett egy 30 napos auto sor felesleges…
    const fetchMock = installFetchMock({
      tasks: [
        makeTask({ id: 'obsolete-30', intervalDays: 30, label: '1 hónapos kontroll' }),
        makeTask({ id: 'auto-180', intervalDays: 180, label: '6 hónapos kontroll' }),
        // …de a kézi sor sosem kerül az ajánlatba, akkor sem, ha nincs a kadenciában
        makeTask({ id: 'manual-14', intervalDays: 14, source: 'manual', label: 'Kézi kontroll' }),
      ],
      riskLevel: 'low',
    });
    render(<EpisodeRecallPanel episodeId={EPISODE_ID} patientId="p1" />);

    await waitFor(() => {
      expect(screen.getByText(/1 automatikus visszarendelés feleslegessé vált/)).toBeDefined();
    });

    // Betöltéskor magától semmit nem törölt
    expect(
      fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE'),
    ).toBeUndefined();

    fireEvent.click(screen.getByText('Törlés'));

    await waitFor(() => {
      const deletes = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(deletes.map(([url]) => String(url))).toEqual([
        `/api/episodes/${EPISODE_ID}/recall-tasks/obsolete-30`,
      ]);
    });
  });
});

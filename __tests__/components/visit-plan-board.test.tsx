/**
 * WP-4.3 — vizit-kártyás („puzzle") kezelési terv UI (EpisodeStepsManager).
 *
 * Könnyű komponens-tesztek (happy-dom) mock fetch-csel:
 * - az alkalom-kártyák a GET work-phases (visits[] + sorok) alakjából
 *   renderelődnek (címke, státusz-chip, összidő, days_offset);
 * - az „Áthelyezés másik alkalomba" menü PATCH visitId-t hív (nem-drag út);
 * - a fel/le átrendezés PATCH orderedVisitIds-t hív;
 * - az „Új alkalom" zóna POST /visits-t hív;
 * - a merge-csoport EGY kockaként jelenik meg (a gyerek nem külön kocka);
 * - üres terv állapot.
 *
 * A nehéz gyerek-komponensek (validáció, napló, delegálás) mockolva — a
 * foglalási motor patientId nélkül eleve inaktív.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ToastProvider } from '@/contexts/ToastContext';
import { EpisodeStepsManager } from '@/components/EpisodeStepsManager';

vi.mock('@/components/PlanValidationPanel', () => ({
  PlanValidationPanel: () => <div data-testid="plan-validation" />,
}));
vi.mock('@/components/PlanHistoryLog', () => ({
  PlanHistoryLog: () => <div data-testid="plan-history" />,
}));
vi.mock('@/components/WorkPhaseTaskDelegateBlock', () => ({
  WorkPhaseTaskDelegateBlock: () => <div data-testid="delegate-block" />,
}));
vi.mock('@/components/PlanStartDateControl', () => ({
  PlanStartDateControl: () => <div data-testid="plan-start" />,
}));

const EPISODE_ID = 'ep1';

interface MockVisit {
  id: string;
  seq: number;
  label: string | null;
  daysOffset: number | null;
  plannedDurationMinutes: number | null;
}

interface MockPhaseRow {
  id: string;
  episodeId: string;
  workPhaseCode: string;
  pathwayOrderIndex: number;
  pool: string;
  durationMinutes: number;
  defaultDaysOffset: number;
  status: string;
  appointmentId: string | null;
  createdAt: string;
  completedAt: string | null;
  sourceEpisodePathwayId: string | null;
  seq: number;
  customLabel: string | null;
  toothTreatmentId: string | null;
  mergedIntoWorkPhaseId: string | null;
  visitId: string | null;
  jaw: string | null;
  teeth: string[];
}

function makeVisit(overrides: Partial<MockVisit>): MockVisit {
  return {
    id: 'v1',
    seq: 0,
    label: null,
    daysOffset: null,
    plannedDurationMinutes: null,
    ...overrides,
  };
}

function makePhase(overrides: Partial<MockPhaseRow>): MockPhaseRow {
  return {
    id: 'w1',
    episodeId: EPISODE_ID,
    workPhaseCode: 'lenyomat',
    pathwayOrderIndex: 0,
    pool: 'work',
    durationMinutes: 30,
    defaultDaysOffset: 7,
    status: 'pending',
    appointmentId: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    sourceEpisodePathwayId: null,
    seq: 0,
    customLabel: null,
    toothTreatmentId: null,
    mergedIntoWorkPhaseId: null,
    visitId: 'v1',
    jaw: null,
    teeth: [],
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

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

function installFetchMock(opts: {
  visits?: MockVisit[];
  workPhases?: MockPhaseRow[];
  /** Review-javítás teszthez: a work-phase PATCH 500-zal bukjon. */
  failWorkPhasePatch?: boolean;
} = {}) {
  const calls: FetchCall[] = [];
  let createdVisitCounter = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    let body: unknown = null;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : null;
    } catch {
      body = null;
    }
    calls.push({ url, method, body });

    if (url === `/api/episodes/${EPISODE_ID}/work-phases` && method === 'GET') {
      return jsonResponse({
        workPhases: opts.workPhases ?? [],
        visits: opts.visits ?? [],
        lostAppointmentWorkPhaseIds: [],
        autoRepair: null,
      });
    }
    if (url === '/api/step-catalog') {
      return jsonResponse({ items: [{ stepCode: 'lenyomat', labelHu: 'Lenyomatvétel' }] });
    }
    if (url === `/api/episodes/${EPISODE_ID}` && method === 'GET') {
      return jsonResponse({ episode: { id: EPISODE_ID, episodePathways: [] } });
    }
    if (url === `/api/episodes/${EPISODE_ID}/linked-tooth-treatments`) {
      return jsonResponse({ treatments: [] });
    }
    if (url === `/api/episodes/${EPISODE_ID}/step-projections`) {
      return jsonResponse({ steps: [], summary: null });
    }
    if (url === `/api/episodes/${EPISODE_ID}/visits` && method === 'POST') {
      createdVisitCounter += 1;
      return jsonResponse(
        {
          visit: {
            id: `v-new-${createdVisitCounter}`,
            seq: (opts.visits?.length ?? 0) + createdVisitCounter - 1,
            label: null,
            daysOffset: null,
            plannedDurationMinutes: null,
          },
        },
        201
      );
    }
    if (url === `/api/episodes/${EPISODE_ID}/visits` && method === 'PATCH') {
      const b = body as { orderedVisitIds?: string[] };
      const reordered = (b.orderedVisitIds ?? []).map((id, i) => {
        const v = (opts.visits ?? []).find((x) => x.id === id);
        return { ...(v ?? makeVisit({ id })), seq: i };
      });
      return jsonResponse({ visits: reordered });
    }
    if (/\/visits\/[^/]+$/.test(url) && method === 'PATCH') {
      const visitId = url.split('/').pop() as string;
      const v = (opts.visits ?? []).find((x) => x.id === visitId) ?? makeVisit({ id: visitId });
      const b = body as { label?: string | null; daysOffset?: number | null };
      return jsonResponse({
        visit: {
          ...v,
          label: b.label !== undefined ? b.label : v.label,
          daysOffset: b.daysOffset !== undefined ? b.daysOffset : v.daysOffset,
        },
      });
    }
    if (/\/visits\/[^/]+$/.test(url) && method === 'DELETE') {
      return jsonResponse({ ok: true });
    }
    if (/\/work-phases\/[^/]+$/.test(url) && method === 'PATCH') {
      if (opts.failWorkPhasePatch) {
        return jsonResponse({ error: 'Szimulált szerver-hiba' }, 500);
      }
      const wpId = url.split('/').pop() as string;
      const row = (opts.workPhases ?? []).find((w) => w.id === wpId);
      return jsonResponse({ workPhase: row ?? makePhase({ id: wpId }) });
    }
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

function renderManager() {
  return render(
    <ToastProvider>
      <EpisodeStepsManager episodeId={EPISODE_ID} carePathwayId={null} episodePathways={[]} />
    </ToastProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('WP-4.3 vizit-kártyás kezelési terv', () => {
  it('az alkalom-kártyák a GET visits[]+sorok alakjából renderelődnek (címke, chip, összidő, eltolás)', async () => {
    installFetchMock({
      visits: [
        makeVisit({ id: 'v1', seq: 0, label: 'Előkészítés', daysOffset: null }),
        makeVisit({ id: 'v2', seq: 1, daysOffset: 14 }),
      ],
      workPhases: [
        makePhase({ id: 'w1', visitId: 'v1', status: 'pending', durationMinutes: 30 }),
        makePhase({
          id: 'w2',
          visitId: 'v1',
          workPhaseCode: 'probak',
          customLabel: 'Vázpróba',
          status: 'pending',
          durationMinutes: 15,
          seq: 1,
        }),
        makePhase({
          id: 'w3',
          visitId: 'v2',
          workPhaseCode: 'atadas',
          customLabel: 'Átadás',
          status: 'scheduled',
          durationMinutes: 40,
          seq: 2,
          jaw: 'felso',
        }),
      ],
    });
    renderManager();

    expect(await screen.findByText('1. alkalom')).toBeTruthy();
    expect(screen.getByText('2. alkalom')).toBeTruthy();
    // Vizit-címke: az 1. kártyán a label, a 2.-on a fázis címkéjéből képzett
    expect(screen.getByText('Előkészítés')).toBeTruthy();
    // Összidő: 30 + 15 = 45 perc az 1. kártya fejlécében
    expect(screen.getByText('45 perc')).toBeTruthy();
    // Státusz-chipek a tagok állapotából (a „Várakozik" a kockák
    // állapot-szövegeként is megjelenik, ezért getAllByText)
    expect(screen.getAllByText('Várakozik').length).toBeGreaterThan(0);
    expect(screen.getByText('Foglalva')).toBeTruthy();
    // days_offset a fejlécben („ennyi nappal az előző alkalom után")
    expect(screen.getByText('az előző után 14 nappal')).toBeTruthy();
    expect(screen.getByText('első alkalom')).toBeTruthy();
    // Állcsont-hatókör a kockán
    expect(screen.getByText('felső állcsont')).toBeTruthy();
    // A kockák látszanak; az „Átadás" a 2. kártya származtatott címeként
    // (label híján a fázis címkéjéből) ÉS kockaként is megjelenik
    expect(screen.getByText('Lenyomatvétel')).toBeTruthy();
    expect(screen.getByText('Vázpróba')).toBeTruthy();
    expect(screen.getAllByText('Átadás')).toHaveLength(2);
  });

  it('az „Áthelyezés másik alkalomba" menü PATCH visitId-t hív', async () => {
    const { calls } = installFetchMock({
      visits: [
        makeVisit({ id: 'v1', seq: 0 }),
        makeVisit({ id: 'v2', seq: 1, label: 'Második' }),
      ],
      workPhases: [
        makePhase({ id: 'w1', visitId: 'v1' }),
        makePhase({ id: 'w2', visitId: 'v2', customLabel: 'Átadás', seq: 1 }),
      ],
    });
    renderManager();
    await screen.findByText('1. alkalom');

    // A w1 kockájának Áthelyezés gombja
    const moveButtons = screen.getAllByRole('button', { name: /Áthelyezés/ });
    fireEvent.click(moveButtons[0]);
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByText(/2\. alkalom — Második/));

    await waitFor(() => {
      const patch = calls.find(
        (c) => c.url === `/api/episodes/${EPISODE_ID}/work-phases/w1` && c.method === 'PATCH'
      );
      expect(patch).toBeTruthy();
      expect(patch?.body).toEqual({ visitId: 'v2' });
    });
  });

  it('a menü „Új alkalom" pontja POST /visits után PATCH-eli a kockát az új vizitbe', async () => {
    const { calls } = installFetchMock({
      visits: [makeVisit({ id: 'v1', seq: 0 })],
      workPhases: [
        makePhase({ id: 'w1', visitId: 'v1' }),
        makePhase({ id: 'w2', visitId: 'v1', customLabel: 'Vázpróba', seq: 1 }),
      ],
    });
    renderManager();
    await screen.findByText('1. alkalom');

    const moveButtons = screen.getAllByRole('button', { name: /Áthelyezés/ });
    fireEvent.click(moveButtons[0]);
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Új alkalom/ }));

    await waitFor(() => {
      const post = calls.find(
        (c) => c.url === `/api/episodes/${EPISODE_ID}/visits` && c.method === 'POST'
      );
      expect(post).toBeTruthy();
      const patch = calls.find(
        (c) => c.url === `/api/episodes/${EPISODE_ID}/work-phases/w1` && c.method === 'PATCH'
      );
      expect(patch?.body).toEqual({ visitId: 'v-new-1' });
    });
  });

  it('a fel/le gombos átrendezés PATCH orderedVisitIds-t hív', async () => {
    const { calls } = installFetchMock({
      visits: [
        makeVisit({ id: 'v1', seq: 0 }),
        makeVisit({ id: 'v2', seq: 1 }),
      ],
      workPhases: [
        makePhase({ id: 'w1', visitId: 'v1' }),
        makePhase({ id: 'w2', visitId: 'v2', customLabel: 'Átadás', seq: 1 }),
      ],
    });
    renderManager();
    await screen.findByText('1. alkalom');

    const downButtons = screen.getAllByRole('button', { name: 'Alkalom lejjebb' });
    fireEvent.click(downButtons[0]);

    await waitFor(() => {
      const patch = calls.find(
        (c) => c.url === `/api/episodes/${EPISODE_ID}/visits` && c.method === 'PATCH'
      );
      expect(patch).toBeTruthy();
      expect(patch?.body).toEqual({ orderedVisitIds: ['v2', 'v1'] });
    });
  });

  it('az „Új alkalom" zóna gombja POST /visits-t hív', async () => {
    const { calls } = installFetchMock({
      visits: [makeVisit({ id: 'v1', seq: 0 })],
      workPhases: [makePhase({ id: 'w1', visitId: 'v1' })],
    });
    renderManager();
    await screen.findByText('1. alkalom');

    fireEvent.click(screen.getByRole('button', { name: /Új alkalom/ }));

    await waitFor(() => {
      const post = calls.find(
        (c) => c.url === `/api/episodes/${EPISODE_ID}/visits` && c.method === 'POST'
      );
      expect(post).toBeTruthy();
    });
    // Az új (üres) alkalom kártyaként megjelenik
    expect(await screen.findByText('2. alkalom')).toBeTruthy();
  });

  it('a merge-csoport EGY kockaként jelenik meg (a gyerek nem külön kocka)', async () => {
    installFetchMock({
      visits: [makeVisit({ id: 'v1', seq: 0 })],
      workPhases: [
        makePhase({ id: 'w1', visitId: 'v1', customLabel: 'Előkészítés blokk' }),
        makePhase({
          id: 'w2',
          visitId: 'v1',
          customLabel: 'Lenyomat al-fázis',
          mergedIntoWorkPhaseId: 'w1',
          seq: 1,
        }),
      ],
    });
    renderManager();
    await screen.findByText('1. alkalom');

    // A szülő kocka jelzi az összevonást; a gyerek a kockán belül listázódik
    expect(screen.getByText('+1 összevonva')).toBeTruthy();
    expect(screen.getByText('Lenyomat al-fázis')).toBeTruthy();
    // A gyereknek nincs saját „Áthelyezés" menüje (a csoport együtt mozog):
    // egy primary kocka van, tehát pontosan egy Áthelyezés gomb.
    expect(screen.getAllByRole('button', { name: /Áthelyezés/ })).toHaveLength(1);
  });

  it('üres terv: üres állapot szöveg + Új alkalom lehetőség', async () => {
    installFetchMock({ visits: [], workPhases: [] });
    renderManager();

    expect(await screen.findByText(/A kezelési terv még üres/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Új alkalom/ })).toBeTruthy();
    // Nincs alkalom-kártya
    expect(screen.queryByText('1. alkalom')).toBeNull();
  });

  it('az alkalom szerkesztője PATCH /visits/:visitId-t hív (label + daysOffset)', async () => {
    const { calls } = installFetchMock({
      visits: [
        makeVisit({ id: 'v1', seq: 0 }),
        makeVisit({ id: 'v2', seq: 1, daysOffset: 7 }),
      ],
      workPhases: [
        makePhase({ id: 'w1', visitId: 'v1' }),
        makePhase({ id: 'w2', visitId: 'v2', customLabel: 'Átadás', seq: 1 }),
      ],
    });
    renderManager();
    await screen.findByText('1. alkalom');

    const editButtons = screen.getAllByRole('button', { name: 'Alkalom szerkesztése' });
    fireEvent.click(editButtons[1]);

    const labelInput = screen.getByLabelText('Címke:');
    fireEvent.change(labelInput, { target: { value: 'Átadó vizit' } });
    const offsetInput = screen.getByLabelText('Az előző alkalom után:');
    fireEvent.change(offsetInput, { target: { value: '21' } });
    fireEvent.click(screen.getByRole('button', { name: /Mentés/ }));

    await waitFor(() => {
      const patch = calls.find(
        (c) => c.url === `/api/episodes/${EPISODE_ID}/visits/v2` && c.method === 'PATCH'
      );
      expect(patch).toBeTruthy();
      expect(patch?.body).toEqual({ label: 'Átadó vizit', daysOffset: 21 });
    });
  });

  it('vizit nélküli (backfill előtti) sor a besorolatlan szakaszban jelenik meg', async () => {
    installFetchMock({
      visits: [makeVisit({ id: 'v1', seq: 0 })],
      workPhases: [
        makePhase({ id: 'w1', visitId: 'v1' }),
        makePhase({ id: 'w2', visitId: null, customLabel: 'Árva fázis', seq: 1 }),
      ],
    });
    renderManager();
    await screen.findByText('1. alkalom');

    expect(screen.getByText(/Alkalomhoz nem rendelt munkafázisok/)).toBeTruthy();
    expect(screen.getByText('Árva fázis')).toBeTruthy();
  });
});

describe('optimista hibaág (review-javítás)', () => {
  it('sikertelen áthelyezésnél a kocka visszaáll és a lista újratöltődik', async () => {
    const { calls } = installFetchMock({
      visits: [
        makeVisit({ id: 'v1', seq: 0 }),
        makeVisit({ id: 'v2', seq: 1, label: 'Második' }),
      ],
      workPhases: [
        makePhase({ id: 'w1', visitId: 'v1' }),
        makePhase({ id: 'w2', visitId: 'v2', customLabel: 'Átadás', seq: 1 }),
      ],
      failWorkPhasePatch: true,
    });
    renderManager();
    await screen.findByText('1. alkalom');
    const getsBefore = calls.filter(
      (c) => c.url === `/api/episodes/${EPISODE_ID}/work-phases` && c.method === 'GET'
    ).length;

    const moveButtons = screen.getAllByRole('button', { name: /Áthelyezés/ });
    fireEvent.click(moveButtons[0]);
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByText(/2\. alkalom — Második/));

    // Visszatöltés: a GET újra lefut, és a kocka az 1. alkalomban marad.
    await waitFor(() => {
      const getsAfter = calls.filter(
        (c) => c.url === `/api/episodes/${EPISODE_ID}/work-phases` && c.method === 'GET'
      ).length;
      expect(getsAfter).toBeGreaterThan(getsBefore);
    });
    const card1 = screen.getByText('1. alkalom').closest('[data-visit-card]') ?? document.body;
    expect(within(card1 as HTMLElement).getAllByText('Lenyomatvétel').length).toBeGreaterThan(0);
  });
});

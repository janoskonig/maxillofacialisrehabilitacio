/**
 * Puzzle v2 — kéthasábos, vizit-alapú kezelési terv (EpisodeStepsManager).
 *
 * Könnyű komponens-tesztek (happy-dom) mock fetch-csel:
 * - az alkalom-sorok a GET work-phases (visits[] + sorok) alakjából
 *   renderelődnek (címke, státusz-chip, összidő, vizitköz-összekötő);
 * - a paletta kattintása az AKTÍV alkalomba POST-ol (visitId), üres tervnél
 *   új alkalmat nyit (daysOffset = 7) — egyetlen kérés, optimista kocka;
 * - a kocka menüje: áthelyezés (PATCH visitId), új alkalom (POST visits →
 *   PATCH), elhagyás (DELETE);
 * - vizitköz-összekötő: PATCH /visits/:id daysOffset;
 * - alkalom-menü átrendezés: PATCH orderedVisitIds; „Új alkalom" zóna: POST;
 * - az összevont gyerek lánc-ikonos kocka, nem külön foglalható sor;
 * - sikertelen áthelyezésnél a kocka visszaáll és a lista újratöltődik.
 *
 * A nehéz gyerek-komponensek (validáció, napló, delegálás) mockolva — a
 * foglalási motor patientId nélkül eleve inaktív.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ToastProvider } from '@/contexts/ToastContext';
import { EpisodeStepsManager } from '@/components/EpisodeStepsManager';
import { _resetPlanBoardCachesForTests } from '@/components/visit-plan/usePlanBoard';

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
  appointmentId?: string | null;
  appointmentStart?: string | null;
  appointmentEnd?: string | null;
  appointmentStatus?: string | null;
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
  return { id: 'v1', seq: 0, label: null, daysOffset: 7, plannedDurationMinutes: null, ...overrides };
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

const CATALOG = [
  { stepCode: 'lenyomat', labelHu: 'Lenyomatvétel', isActive: true, paletteOrder: null, defaultDurationMinutes: null, defaultPool: null },
  { stepCode: 'gen_csonkpreparalas', labelHu: 'Csonkpreparálás', isActive: true, paletteOrder: 50, defaultDurationMinutes: 60, defaultPool: 'work' },
  { stepCode: 'gen_atadas', labelHu: 'Átadás', isActive: true, paletteOrder: 170, defaultDurationMinutes: 30, defaultPool: 'work' },
];

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
  body: Record<string, unknown> | null;
}

function installFetchMock(opts: {
  visits?: MockVisit[];
  workPhases?: MockPhaseRow[];
  unattached?: Array<{ id: string; startTime: string; endTime?: string | null; pool?: string; stepCode?: string | null; dentistEmail?: string | null }>;
  failWorkPhasePatch?: boolean;
} = {}) {
  const calls: FetchCall[] = [];
  let counter = 0;
  // Állapottartó mock: a mutációk a GET-ben is látszanak (a tábla csendes
  // egyeztető újratöltése különben visszaállítaná a kiinduló adatot).
  const state = {
    visits: [...(opts.visits ?? [])] as MockVisit[],
    workPhases: [...(opts.workPhases ?? [])] as MockPhaseRow[],
    unattached: [...(opts.unattached ?? [])],
  };
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    let body: Record<string, unknown> | null = null;
    try {
      body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    calls.push({ url, method, body });

    if (url === `/api/episodes/${EPISODE_ID}/work-phases` && method === 'GET') {
      return jsonResponse({
        workPhases: state.workPhases,
        visits: state.visits,
        unattachedAppointments: state.unattached,
        lostAppointmentWorkPhaseIds: [],
        autoRepair: null,
      });
    }
    if (url === `/api/episodes/${EPISODE_ID}/work-phases` && method === 'POST') {
      counter += 1;
      const b = body ?? {};
      const createdVisit: MockVisit | null = b.visitId
        ? null
        : { id: `v-new-${counter}`, seq: state.visits.length, label: null, daysOffset: (b.daysOffset as number | undefined) ?? 7, plannedDurationMinutes: null };
      if (createdVisit) state.visits.push(createdVisit);
      const code = typeof b.workPhaseCode === 'string' ? b.workPhaseCode : `adhoc_${counter}`;
      const row = makePhase({
        id: `w-new-${counter}`,
        workPhaseCode: code,
        customLabel: typeof b.label === 'string' ? b.label : null,
        durationMinutes: typeof b.durationMinutes === 'number' ? b.durationMinutes : code === 'gen_csonkpreparalas' ? 60 : 30,
        visitId: (b.visitId as string | undefined) ?? createdVisit?.id ?? null,
        seq: 99 + counter,
      });
      state.workPhases.push(row);
      return jsonResponse({ workPhase: row, visit: createdVisit }, 201);
    }
    if (url === '/api/step-catalog') {
      return jsonResponse({ items: CATALOG });
    }
    if (url === `/api/episodes/${EPISODE_ID}/linked-tooth-treatments`) {
      return jsonResponse({ treatments: [] });
    }
    if (url === `/api/episodes/${EPISODE_ID}/step-projections`) {
      return jsonResponse({ steps: [], summary: null });
    }
    if (url === `/api/episodes/${EPISODE_ID}/visits` && method === 'POST') {
      counter += 1;
      const visit: MockVisit = {
        id: `v-new-${counter}`,
        seq: state.visits.length,
        label: null,
        daysOffset: (body?.daysOffset as number | undefined) ?? 7,
        plannedDurationMinutes: null,
      };
      state.visits.push(visit);
      return jsonResponse({ visit }, 201);
    }
    if (url === `/api/episodes/${EPISODE_ID}/visits` && method === 'PATCH') {
      const ids = (body?.orderedVisitIds as string[] | undefined) ?? [];
      state.visits = ids.map((id, i) => ({ ...(state.visits.find((x) => x.id === id) ?? makeVisit({ id })), seq: i }));
      return jsonResponse({ visits: state.visits });
    }
    if (/\/visits\/[^/]+$/.test(url) && method === 'PATCH') {
      const visitId = url.split('/').pop() as string;
      const v = state.visits.find((x) => x.id === visitId) ?? makeVisit({ id: visitId });
      const updated = {
        ...v,
        label: body && 'label' in body ? (body.label as string | null) : v.label,
        daysOffset: body && 'daysOffset' in body ? (body.daysOffset as number | null) : v.daysOffset,
      };
      state.visits = state.visits.map((x) => (x.id === visitId ? updated : x));
      return jsonResponse({ visit: updated });
    }
    if (/\/visits\/[^/]+$/.test(url) && method === 'DELETE') {
      const visitId = url.split('/').pop() as string;
      state.visits = state.visits.filter((x) => x.id !== visitId);
      return jsonResponse({ ok: true });
    }
    if (/\/visits\/[^/]+\/attach-appointment$/.test(url) && method === 'POST') {
      const visitId = url.split('/')[url.split('/').length - 2];
      const apptId = body?.appointmentId as string;
      const appt = state.unattached.find((a) => a.id === apptId);
      state.visits = state.visits.map((v) =>
        v.id === visitId ? { ...v, appointmentId: apptId, appointmentStart: appt?.startTime ?? null, appointmentStatus: null } : v
      );
      state.unattached = state.unattached.filter((a) => a.id !== apptId);
      return jsonResponse({ visits: state.visits, primaryWorkPhaseId: null });
    }
    if (/\/visits\/[^/]+\/detach-appointment$/.test(url) && method === 'POST') {
      const visitId = url.split('/')[url.split('/').length - 2];
      state.visits = state.visits.map((v) =>
        v.id === visitId ? { ...v, appointmentId: null, appointmentStart: null, appointmentStatus: null } : v
      );
      return jsonResponse({ visits: state.visits });
    }
    if (/\/work-phases\/[^/]+$/.test(url) && method === 'PATCH') {
      if (opts.failWorkPhasePatch) {
        return jsonResponse({ error: 'Szimulált szerver-hiba' }, 500);
      }
      const wpId = url.split('/').pop() as string;
      const row = state.workPhases.find((w) => w.id === wpId) ?? makePhase({ id: wpId });
      const updated = {
        ...row,
        ...(body && typeof body.visitId === 'string' ? { visitId: body.visitId, mergedIntoWorkPhaseId: null } : {}),
        ...(body && typeof body.status === 'string' ? { status: body.status } : {}),
      };
      // A szerver a mozgatott sort a cél-alkalom végére teszi.
      state.workPhases = [...state.workPhases.filter((w) => w.id !== wpId), updated];
      return jsonResponse({ workPhase: updated });
    }
    if (/\/work-phases\/[^/]+$/.test(url) && method === 'DELETE') {
      const wpId = url.split('/').pop() as string;
      state.workPhases = state.workPhases.filter((w) => w.id !== wpId);
      return jsonResponse({ ok: true, cancelledAppointments: 0 });
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

function palette() {
  return screen.getByTestId('phase-palette');
}

function paletteButton(label: string): HTMLElement {
  const el = within(palette()).getByText(label).closest('button');
  if (!el) throw new Error(`nincs paletta-gomb: ${label}`);
  return el;
}

async function openPillMenu(label: string) {
  fireEvent.click(screen.getByRole('button', { name: `${label} — műveletek` }));
  return await screen.findByRole('menu');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  _resetPlanBoardCachesForTests();
});

const TWO_VISITS = {
  visits: [
    makeVisit({ id: 'v1', seq: 0, label: 'Előkészítés', daysOffset: 7 }),
    makeVisit({ id: 'v2', seq: 1, daysOffset: 14 }),
  ],
  workPhases: [
    makePhase({ id: 'w1', visitId: 'v1', status: 'pending', durationMinutes: 30 }),
    makePhase({ id: 'w2', visitId: 'v1', workPhaseCode: 'probak', customLabel: 'Vázpróba', durationMinutes: 15, seq: 1 }),
    makePhase({ id: 'w3', visitId: 'v2', workPhaseCode: 'gen_atadas', status: 'scheduled', durationMinutes: 40, seq: 2, jaw: 'felso' }),
  ],
};

describe('Puzzle v2 — kéthasábos vizit-tábla', () => {
  it('az alkalom-sorok a GET visits[]+sorok alakjából renderelődnek (címke, chip, összidő, vizitköz)', async () => {
    installFetchMock(TWO_VISITS);
    renderManager();

    const row1 = await screen.findByTestId('visit-row-v1');
    const row2 = screen.getByTestId('visit-row-v2');
    // Címke: az 1. soron a label, a 2.-on a fázis címkéjéből képzett
    expect(within(row1).getByText('Előkészítés')).toBeTruthy();
    expect(within(row2).getByTitle('Átadás')).toBeTruthy();
    // Összidő: 30 + 15 = 45′ az 1. sor fejlécében
    expect(within(row1).getByTestId('visit-total-minutes').textContent).toBe('45′');
    // Státusz-chipek
    expect(within(row1).getByText('Várakozik')).toBeTruthy();
    expect(within(row2).getByText('Foglalva')).toBeTruthy();
    // Vizitköz-összekötő csak a 2. alkalom ELŐTT (1 db), a v2 days_offset-jével
    const gaps = screen.getAllByTestId('visit-gap');
    expect(gaps).toHaveLength(1);
    expect(within(gaps[0]).getByRole('button', { name: 'Vizitköz: 2 hét' })).toBeTruthy();
    // Kockák + hatókör
    expect(within(row1).getByTestId('phase-pill-w1')).toBeTruthy();
    expect(within(row1).getByTestId('phase-pill-w2')).toBeTruthy();
    expect(within(row2).getByText('felső állcsont')).toBeTruthy();
    // Paletta: csak a sorrenddel bíró (generikus) elemek látszanak keresés nélkül
    expect(within(palette()).getByText('Csonkpreparálás')).toBeTruthy();
    expect(within(palette()).queryByText('Lenyomatvétel')).toBeNull();
  });

  it('a paletta kattintása az AKTÍV (utolsó nyitott) alkalomba POST-ol visitId-vel, a kocka azonnal megjelenik', async () => {
    const { calls } = installFetchMock(TWO_VISITS);
    renderManager();
    await screen.findByTestId('visit-row-v2');

    fireEvent.click(paletteButton('Csonkpreparálás'));

    // Optimista kocka a 2. (aktív) alkalomban — még a válasz előtt is ott van
    const row2 = screen.getByTestId('visit-row-v2');
    expect(await within(row2).findByText('Csonkpreparálás')).toBeTruthy();

    await waitFor(() => {
      const post = calls.find(
        (c) => c.url === `/api/episodes/${EPISODE_ID}/work-phases` && c.method === 'POST'
      );
      expect(post).toBeTruthy();
      expect(post?.body).toEqual({ workPhaseCode: 'gen_csonkpreparalas', visitId: 'v2' });
    });
    // Nincs utólagos PATCH visitId (egy kérés); az egyeztető újratöltés a
    // válasz UTÁN, a háttérben megy (a kocka már előtte látszott).
    const patches = calls.filter((c) => /\/work-phases\/[^/]+$/.test(c.url) && c.method === 'PATCH');
    expect(patches).toHaveLength(0);
    // A szerver-id átveszi a helyet
    await waitFor(() => expect(screen.getByTestId('phase-pill-w-new-1')).toBeTruthy());
  });

  it('üres tervnél a paletta kattintása ÚJ alkalmat nyit (daysOffset = 7, egy kérés)', async () => {
    const { calls } = installFetchMock({ visits: [], workPhases: [] });
    renderManager();
    await screen.findByText(/A kezelési terv még üres/);

    fireEvent.click(paletteButton('Átadás'));

    await waitFor(() => {
      const post = calls.find(
        (c) => c.url === `/api/episodes/${EPISODE_ID}/work-phases` && c.method === 'POST'
      );
      expect(post?.body).toEqual({ workPhaseCode: 'gen_atadas', daysOffset: 7 });
    });
    const row = await screen.findByTestId('visit-row-v-new-1');
    expect(within(row).getByRole('button', { name: 'Átadás — műveletek' })).toBeTruthy();
    expect(screen.queryByText(/A kezelési terv még üres/)).toBeNull();
  });

  it('az egyedi fázis (szabad szöveg) Enterre POST-ol label-lel az aktív alkalomba', async () => {
    const { calls } = installFetchMock(TWO_VISITS);
    renderManager();
    await screen.findByTestId('visit-row-v2');

    const input = screen.getByPlaceholderText('Egyedi fázis… (Enter)');
    fireEvent.change(input, { target: { value: 'Ideiglenes korona' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    await waitFor(() => {
      const post = calls.find(
        (c) => c.url === `/api/episodes/${EPISODE_ID}/work-phases` && c.method === 'POST'
      );
      expect(post?.body).toEqual({ label: 'Ideiglenes korona', pool: 'work', durationMinutes: 30, visitId: 'v2' });
    });
    expect(within(screen.getByTestId('visit-row-v2')).getByText('Ideiglenes korona')).toBeTruthy();
  });

  it('a kocka menüjének „Áthelyezés" pontja PATCH visitId-t hív, a kocka átkerül', async () => {
    const { calls } = installFetchMock(TWO_VISITS);
    renderManager();
    await screen.findByTestId('visit-row-v1');

    const menu = await openPillMenu('Átadás');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Áthelyezés másik alkalomba/ }));
    fireEvent.click(await within(menu).findByRole('menuitem', { name: /1\. alkalom — Előkészítés/ }));

    // Optimista: azonnal az 1. sorban
    expect(within(screen.getByTestId('visit-row-v1')).getByTestId('phase-pill-w3')).toBeTruthy();
    await waitFor(() => {
      const patch = calls.find(
        (c) => c.url === `/api/episodes/${EPISODE_ID}/work-phases/w3` && c.method === 'PATCH'
      );
      expect(patch?.body).toEqual({ visitId: 'v1' });
    });
    // Puzzle v2: a kiürült 2. alkalom MEGMARAD (üres alkalom nem tűnik el magától)
    expect(screen.getByTestId('visit-row-v2')).toBeTruthy();
    expect(within(screen.getByTestId('visit-row-v2')).queryByTestId('phase-pill-w3')).toBeNull();
  });

  it('a menü „Új alkalom" pontja POST /visits (daysOffset 7) után PATCH-eli a kockát az új alkalomba', async () => {
    const { calls } = installFetchMock({
      visits: [makeVisit({ id: 'v1', seq: 0 })],
      workPhases: [
        makePhase({ id: 'w1', visitId: 'v1' }),
        makePhase({ id: 'w2', visitId: 'v1', customLabel: 'Vázpróba', seq: 1 }),
      ],
    });
    renderManager();
    await screen.findByTestId('visit-row-v1');

    const menu = await openPillMenu('Lenyomatvétel');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Áthelyezés másik alkalomba/ }));
    fireEvent.click(await within(menu).findByRole('menuitem', { name: /Új alkalom/ }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === `/api/episodes/${EPISODE_ID}/visits` && c.method === 'POST');
      expect(post?.body).toEqual({ daysOffset: 7 });
      const patch = calls.find(
        (c) => c.url === `/api/episodes/${EPISODE_ID}/work-phases/w1` && c.method === 'PATCH'
      );
      expect(patch?.body).toEqual({ visitId: 'v-new-1' });
    });
    const newRow = await screen.findByTestId('visit-row-v-new-1');
    expect(within(newRow).getByTestId('phase-pill-w1')).toBeTruthy();
    // Az új alkalom előtt megjelenik a vizitköz (alap: 1 hét)
    expect(screen.getByRole('button', { name: 'Vizitköz: 1 hét' })).toBeTruthy();
  });

  it('a vizitköz-összekötő gyors-választója PATCH /visits/:id daysOffset-et hív', async () => {
    const { calls } = installFetchMock(TWO_VISITS);
    renderManager();
    await screen.findByTestId('visit-row-v2');

    fireEvent.click(screen.getByRole('button', { name: 'Vizitköz: 2 hét' }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: '1 hét' }));

    await waitFor(() => {
      const patch = calls.find(
        (c) => c.url === `/api/episodes/${EPISODE_ID}/visits/v2` && c.method === 'PATCH'
      );
      expect(patch?.body).toEqual({ daysOffset: 7 });
    });
    expect(screen.getByRole('button', { name: 'Vizitköz: 1 hét' })).toBeTruthy();
  });

  it('az alkalom menüjének „Hátrébb" pontja PATCH orderedVisitIds-t hív', async () => {
    const { calls } = installFetchMock(TWO_VISITS);
    renderManager();
    const row1 = await screen.findByTestId('visit-row-v1');

    fireEvent.click(within(row1).getByRole('button', { name: 'Alkalom műveletei' }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Hátrébb/ }));

    await waitFor(() => {
      const patch = calls.find((c) => c.url === `/api/episodes/${EPISODE_ID}/visits` && c.method === 'PATCH');
      expect(patch?.body).toEqual({ orderedVisitIds: ['v2', 'v1'] });
    });
  });

  it('az „Új alkalom" zóna gombja POST /visits-t hív (daysOffset 7) és új sor jelenik meg', async () => {
    const { calls } = installFetchMock(TWO_VISITS);
    renderManager();
    await screen.findByTestId('visit-row-v1');

    fireEvent.click(within(screen.getByTestId('new-visit-zone')).getByRole('button', { name: /Új alkalom/ }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === `/api/episodes/${EPISODE_ID}/visits` && c.method === 'POST');
      expect(post?.body).toEqual({ daysOffset: 7 });
    });
    expect(await screen.findByTestId('visit-row-v-new-1')).toBeTruthy();
  });

  it('a kocka „Elhagyom" pontja DELETE-et hív, a kocka azonnal eltűnik', async () => {
    const { calls } = installFetchMock(TWO_VISITS);
    renderManager();
    await screen.findByTestId('visit-row-v1');

    const menu = await openPillMenu('Vázpróba');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Elhagyom a tervből/ }));

    expect(screen.queryByTestId('phase-pill-w2')).toBeNull();
    await waitFor(() => {
      const del = calls.find(
        (c) => c.url === `/api/episodes/${EPISODE_ID}/work-phases/w2` && c.method === 'DELETE'
      );
      expect(del).toBeTruthy();
    });
    // Az 1. alkalom összideje már csak a maradék kocka: 30′
    expect(within(screen.getByTestId('visit-row-v1')).getByTestId('visit-total-minutes').textContent).toBe('30′');
  });

  it('a blokk alá vont tagja is kocka a primary mellett, nem számít az összidőbe', async () => {
    installFetchMock({
      visits: [makeVisit({ id: 'v1', seq: 0 })],
      workPhases: [
        makePhase({ id: 'w1', visitId: 'v1', durationMinutes: 45 }),
        makePhase({ id: 'w2', visitId: 'v1', customLabel: 'Harapásregisztráció', durationMinutes: 40, mergedIntoWorkPhaseId: 'w1', seq: 1 }),
      ],
    });
    renderManager();
    const row = await screen.findByTestId('visit-row-v1');
    expect(within(row).getByTestId('phase-pill-w2')).toBeTruthy();
    expect(within(row).getByTestId('visit-total-minutes').textContent).toBe('45′');
  });

  it('vizit nélküli (backfill előtti) sor a besorolatlan szakaszban jelenik meg', async () => {
    installFetchMock({
      visits: [makeVisit({ id: 'v1', seq: 0 })],
      workPhases: [
        makePhase({ id: 'w1', visitId: 'v1' }),
        makePhase({ id: 'w9', visitId: null, customLabel: 'Árva fázis', seq: 5 }),
      ],
    });
    renderManager();
    await screen.findByTestId('visit-row-v1');
    expect(screen.getByText(/Alkalomhoz nem rendelt kezelések/)).toBeTruthy();
    expect(screen.getByText('Árva fázis')).toBeTruthy();
  });
});

describe('optimista hibaág', () => {
  it('sikertelen áthelyezésnél a kocka visszaáll a forrás-alkalomba és a lista újratöltődik', async () => {
    const { calls } = installFetchMock({ ...TWO_VISITS, failWorkPhasePatch: true });
    renderManager();
    await screen.findByTestId('visit-row-v1');

    const menu = await openPillMenu('Átadás');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Áthelyezés másik alkalomba/ }));
    fireEvent.click(await within(menu).findByRole('menuitem', { name: /1\. alkalom — Előkészítés/ }));

    await waitFor(() => {
      const gets = calls.filter(
        (c) => c.url === `/api/episodes/${EPISODE_ID}/work-phases` && c.method === 'GET'
      );
      expect(gets.length).toBeGreaterThanOrEqual(2);
    });
    const row2 = await screen.findByTestId('visit-row-v2');
    expect(within(row2).getByTestId('phase-pill-w3')).toBeTruthy();
    expect(within(screen.getByTestId('visit-row-v1')).queryByTestId('phase-pill-w3')).toBeNull();
  });
});


describe('Puzzle v2 — a váz: az alkalom időpontja', () => {
  it('foglalt, üres alkalom: a fejlécben az időpont chipje, a törzsben „tartalom nélkül" jelzés; a lista nem törli', async () => {
    installFetchMock({
      visits: [
        makeVisit({ id: 'v1', seq: 0, appointmentId: 'a1', appointmentStart: '2026-09-03T08:00:00Z', appointmentStatus: null }),
      ],
      workPhases: [],
    });
    renderManager();
    const row = await screen.findByTestId('visit-row-v1');
    expect(within(row).getByTestId('visit-appointment-chip')).toBeTruthy();
    expect(within(row).getByText(/Foglalt időpont tartalom nélkül/)).toBeTruthy();
    expect(within(row).getByText('Foglalva')).toBeTruthy();
  });

  it('alkalom nélküli foglalt időpont sávja: hozzárendelés egy alkalomhoz POST attach-appointment-et hív', async () => {
    const { calls } = installFetchMock({
      visits: [makeVisit({ id: 'v1', seq: 0 })],
      workPhases: [makePhase({ id: 'w1', visitId: 'v1' })],
      unattached: [{ id: 'a9', startTime: '2026-09-03T08:00:00Z', pool: 'work' }],
    });
    renderManager();
    await screen.findByTestId('visit-row-v1');
    const strip = screen.getByTestId('unattached-appointments');
    fireEvent.click(within(strip).getByRole('button', { name: /hozzárendelése alkalomhoz/ }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /1\. alkalom/ }));
    await waitFor(() => {
      const post = calls.find(
        (c) => c.url === `/api/episodes/${EPISODE_ID}/visits/v1/attach-appointment` && c.method === 'POST'
      );
      expect(post?.body).toEqual({ appointmentId: 'a9' });
    });
  });

  it('a kocka áthelyezésekor a forrás-alkalom időpontja a helyén marad (a kocka várakozó lesz), az alkalom nem tűnik el', async () => {
    const { calls } = installFetchMock({
      visits: [
        makeVisit({ id: 'v1', seq: 0, appointmentId: 'a1', appointmentStart: '2026-09-03T08:00:00Z', appointmentStatus: null }),
        makeVisit({ id: 'v2', seq: 1 }),
      ],
      workPhases: [
        makePhase({ id: 'w1', visitId: 'v1', status: 'scheduled', appointmentId: 'a1' }),
        makePhase({ id: 'w2', visitId: 'v2', customLabel: 'Vázpróba', seq: 1 }),
      ],
    });
    renderManager();
    await screen.findByTestId('visit-row-v1');
    const menu = await openPillMenu('Lenyomatvétel');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Áthelyezés másik alkalomba/ }));
    fireEvent.click(await within(menu).findByRole('menuitem', { name: /2\. alkalom/ }));
    await waitFor(() => {
      const patch = calls.find((c) => c.url === `/api/episodes/${EPISODE_ID}/work-phases/w1` && c.method === 'PATCH');
      expect(patch?.body).toEqual({ visitId: 'v2' });
    });
    // A forrás-alkalom megmaradt, az időpont chipjével (a váz), tartalom nélkül.
    const row1 = screen.getByTestId('visit-row-v1');
    expect(within(row1).getByTestId('visit-appointment-chip')).toBeTruthy();
    expect(within(row1).queryByTestId('phase-pill-w1')).toBeNull();
    expect(within(screen.getByTestId('visit-row-v2')).getByTestId('phase-pill-w1')).toBeTruthy();
  });
});

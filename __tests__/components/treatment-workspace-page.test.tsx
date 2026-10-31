import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AftercareWorkspace, Prosthesis } from '@/lib/aftercare/model';
import type { TimelineEpisode } from '@/components/TreatmentPlanGantt/types';
import { careWorkspace, prosthesis, timelineEpisode, timelineStep } from '../fixtures/treatment-workspace';
import PatientStagesPage from '@/app/patients/[id]/stages/page';

const mocks = vi.hoisted(() => ({ router: { push: vi.fn() }, toast: vi.fn(), confirm: vi.fn(), user: vi.fn(), timeline: [] as TimelineEpisode[] }));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router, useParams: () => ({ id: 'patient' }) }));
vi.mock('@/components/TreatmentPlanGantt/useTimelineData', () => ({ useTimelineData: () => ({ episodes: mocks.timeline, meta: null, error: null }) }));
vi.mock('@/components/PatientTreatmentJourney', () => ({ PatientTreatmentJourney: ({ episode }: { episode: TimelineEpisode }) => <div data-testid="journey">{episode.episodeId}</div> }));
vi.mock('@/components/aftercare/PatientAftercare', () => ({ PatientAftercare: ({ selectedEpisodeId, initialAppointmentId }: { selectedEpisodeId: string; initialAppointmentId?: string }) => <div data-testid="aftercare">{selectedEpisodeId}:{initialAppointmentId}</div> }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.user }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: mocks.toast, confirm: mocks.confirm }) }));
vi.mock('@/components/layout/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/components/PatientHeaderBar', () => ({ PatientHeaderBar: () => <div>Betegfejléc</div> }));
vi.mock('@/components/PatientTabsNav', () => ({ PatientTabsNav: () => <nav>Fülek</nav> }));
vi.mock('@/components/EpisodeTreatmentPlanEditor', () => ({ EpisodeTreatmentPlanEditor: ({ episodeId, onStateChange }: { episodeId: string; onStateChange?: (state: { dirty: boolean; saving: boolean }) => void }) => <div data-testid="clinical-plan">{episodeId}<button onClick={() => onStateChange?.({ dirty: true, saving: false })}>Mark plan unsaved</button></div> }));
vi.mock('@/components/EpisodeStepsManager', () => ({ EpisodeStepsManager: ({ episodeId, presentation, onManageAppointments }: { episodeId: string; presentation: string; onManageAppointments: () => void }) => <div data-testid="plan">{episodeId}:{presentation}<button onClick={onManageAppointments}>Státusz megnyitása</button></div> }));
vi.mock('@/components/AppointmentBookingSection', () => ({ AppointmentBookingSection: ({ episodeId }: { episodeId: string }) => <div data-testid="appointments">{episodeId}</div> }));
vi.mock('@/components/PatientStageStepper', () => ({ PatientStageStepper: ({ episodeId }: { episodeId: string }) => <div data-testid="stage">{episodeId}</div> }));
vi.mock('@/components/PatientStageSelector', () => ({ PatientStageSelector: () => <div>Régi stádiumkezelés</div> }));
vi.mock('@/components/EpisodeRecallPanel', () => ({ EpisodeRecallPanel: ({ episodeId }: { episodeId: string }) => <div data-testid="recall">{episodeId}</div> }));
vi.mock('@/components/PatientQuickTaskBlock', () => ({ PatientQuickTaskBlock: () => <div data-testid="tasks" /> }));
vi.mock('@/components/PatientCareTimeline', () => ({ PatientCareTimeline: () => <div data-testid="timeline" /> }));
vi.mock('@/components/PatientEpisodeForm', () => ({ PatientEpisodeForm: () => <div data-testid="new-episode" /> }));
vi.mock('@/components/EpisodePathwayEditor', () => ({ EpisodePathwayEditor: () => <div /> }));
vi.mock('@/components/EpisodeProviderControl', () => ({ EpisodeProviderControl: () => <div /> }));
vi.mock('@/components/EpisodeObstaclesPanel', () => ({ EpisodeObstaclesPanel: ({ episodeId }: { episodeId: string }) => <div data-testid="obstacles">{episodeId}</div> }));
vi.mock('@/components/ConditionalAppointmentOffers', () => ({ ConditionalAppointmentOffers: () => <div /> }));

async function setup({ deceased = false, stage = 'STAGE_5', prostheses = [], pendingWork = false, appointments = [], episodes = [
  { id: 'upper', caseTitle: 'Felső fogpótlás', status: 'open' },
  { id: 'lower', caseTitle: 'Alsó fogpótlás', status: 'open' },
] }: { deceased?: boolean; stage?: string; prostheses?: Prosthesis[]; pendingWork?: boolean; appointments?: AftercareWorkspace['appointments']; episodes?: Array<{ id: string; caseTitle: string; status: string }> } = {}) {
  mocks.user.mockResolvedValue({ role: 'admin' });
  mocks.confirm.mockResolvedValue(true);
  mocks.timeline = episodes.map((ep) => timelineEpisode({ episodeId: ep.id, currentStageCode: stage, steps: pendingWork ? [timelineStep({ status: 'planned' })] : [] }));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const data = url.endsWith('/aftercare') ? careWorkspace({ prostheses, appointments }) : url.endsWith('/episodes') ? { episodes }
      : url.endsWith('/stages') ? { timeline: { currentStage: null }, useNewModel: true }
        : { patient: { id: 'patient', nev: 'Tesztbeteg', halalDatum: deceased ? '2026-10-01' : null } };
    return { ok: true, json: async () => data } as Response;
  }));
  await act(async () => { render(<PatientStagesPage />); });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); window.history.replaceState(null, '', '/'); });

describe('Treatment plan and appointments page', () => {
  it('loads the daily overview without mounting secondary workflows', async () => {
    await setup();
    expect(await screen.findByTestId('plan')).toHaveTextContent('upper:workspace');
    for (const id of ['appointments', 'recall', 'stage', 'tasks', 'timeline']) expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    expect(screen.queryByText(/Fogalomtár/)).not.toBeInTheDocument();
  });

  it('keeps plan, booking and follow-up on the selected active episode', async () => {
    await setup();
    await screen.findByTestId('plan');
    await act(async () => { fireEvent.change(screen.getByLabelText('Aktív kezelés'), { target: { value: 'lower' } }); });
    expect(screen.getByTestId('plan')).toHaveTextContent('lower:workspace');
    expect(screen.getByTestId('obstacles')).toHaveTextContent('lower');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Státusz megnyitása' })); });
    expect(screen.getByTestId('appointments')).toHaveTextContent('lower');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Kontroll és visszarendelés' })); });
    expect(screen.getByTestId('recall')).toHaveTextContent('lower');
  });

  it('opens booking for existing profile deep links', async () => {
    window.history.replaceState(null, '', '/#gyors-foglalas');
    await setup();
    expect(await screen.findByTestId('appointments')).toBeInTheDocument();
  });

  it('opens the treatment selected by a waiting-list link', async () => {
    window.history.replaceState(null, '', '/?episodeId=lower#akadalyok');
    await setup();
    expect(await screen.findByTestId('obstacles')).toHaveTextContent('lower');
    expect(screen.getByTestId('plan')).toHaveTextContent('lower:workspace');
  });

  it('opens stage changes and a new episode only when requested', async () => {
    await setup();
    await screen.findByTestId('plan');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Kezelés adatai' })); });
    expect(screen.getByTestId('stage')).toHaveTextContent('upper');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Új kezelési epizód' })); });
    expect(screen.getByTestId('new-episode')).toBeInTheDocument();
  });

  it('offers a clear start when there is no active treatment', async () => {
    await setup({ episodes: [] });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Új kezelés' })); });
    expect(screen.getByTestId('new-episode')).toBeInTheDocument();
    expect(screen.queryByTestId('plan')).not.toBeInTheDocument();
  });

  it('preserves the restriction on starting treatment after death', async () => {
    await setup({ deceased: true, episodes: [] });
    await screen.findByText('Az ellátás lezárult.');
    expect(screen.queryByRole('button', { name: 'Új kezelés' })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Kezelés adatai' })); });
    expect(screen.queryByRole('button', { name: 'Új kezelési epizód' })).not.toBeInTheDocument();
  });
});


describe('Stage-aware daily view', () => {
  it('opens care first in Gondozás and keeps the selected journey context', async () => {
    await setup({ stage: 'STAGE_7', prostheses: [prosthesis()] });
    expect(screen.getByTestId('aftercare')).toHaveTextContent('upper');
    expect(screen.getByTestId('journey')).toHaveTextContent('upper');
    expect(screen.queryByTestId('plan')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Kezelési alkalmak' })); });
    expect(screen.getByTestId('plan')).toBeInTheDocument();
  });
  it('switches after actual delivery even before the stage is updated', async () => {
    await setup({ prostheses: [prosthesis()] });
    expect(screen.getByTestId('aftercare')).toHaveTextContent('upper');
  });
  it('keeps both workflows available when one prosthesis is still being constructed', async () => {
    await setup({ prostheses: [prosthesis(), prosthesis({ id: 'p2', deliveryDate: null })], pendingWork: true });
    expect(screen.getByTestId('plan')).toBeInTheDocument();
    expect(screen.getByText('Készítés és gondozás párhuzamosan')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Gondozás / igazítás' })); });
    expect(screen.getByTestId('aftercare')).toHaveTextContent('upper');
  });
  it('keeps a direct care appointment link on its own episode', async () => {
    window.history.replaceState(null, '', '/?view=aftercare&appointmentId=visit');
    await setup({ appointments: [{ id: 'visit', episodeId: 'lower', startTime: '2026-10-01T10:00:00Z', occurredOn: '2026-10-01', appointmentStatus: 'completed', clinician: 'Doctor' }] });
    expect(screen.getByTestId('aftercare')).toHaveTextContent('lower:visit');
    expect(screen.getByTestId('journey')).toHaveTextContent('lower');
  });
  it('allows ongoing care for a directly selected closed episode without reopening plan editing', async () => {
    window.history.replaceState(null, '', '/?episodeId=closed&view=aftercare');
    await setup({ stage: 'STAGE_7', episodes: [{ id: 'closed', caseTitle: 'Korábbi fogpótlás', status: 'closed' }] });
    expect(screen.getByTestId('aftercare')).toHaveTextContent('closed');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Kezelési alkalmak' })); });
    expect(screen.queryByTestId('plan')).not.toBeInTheDocument();
    expect(screen.getByText(/Lezárt kezelés ·/)).toBeInTheDocument();
  });
});


it('keeps a generic old care link usable when every episode is closed', async () => {
  window.history.replaceState(null, '', '/?view=aftercare');
  await setup({ stage: 'STAGE_7', episodes: [{ id: 'closed', caseTitle: 'Korábbi fogpótlás', status: 'closed' }] });
  expect(screen.getByTestId('aftercare')).toHaveTextContent('closed');
  expect(screen.getByText('Korábbi kezelés')).toBeInTheDocument();
});


it('allows switching between closed episodes for subsequent care', async () => {
  await setup({ stage: 'STAGE_7', episodes: [
    { id: 'recent', caseTitle: 'Újabb fogpótlás', status: 'closed' },
    { id: 'older', caseTitle: 'Korábbi fogpótlás', status: 'closed' },
  ] });
  await act(async () => { fireEvent.change(screen.getByLabelText('Kezelés kiválasztása'), { target: { value: 'older' } }); });
  expect(screen.getByTestId('aftercare')).toHaveTextContent('older');
  expect(screen.getByTestId('journey')).toHaveTextContent('older');
  expect(screen.getByRole('button', { name: 'Új kezelés' })).toBeInTheDocument();
});


it('opens the upper/lower clinical plan by default during planning', async () => {
  await setup({ stage: 'STAGE_2' });
  expect(screen.getByTestId('clinical-plan')).toHaveTextContent('upper');
});

it('retains upstream unsaved-plan protection when changing episode or daily view', async () => {
  await setup({ stage: 'STAGE_2' });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark plan unsaved' })); });
  mocks.confirm.mockResolvedValue(false);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Gondozás / igazítás' })); });
  expect(screen.getByTestId('clinical-plan')).toHaveTextContent('upper');
  expect(screen.queryByTestId('aftercare')).not.toBeInTheDocument();
  await act(async () => { fireEvent.change(screen.getByLabelText('Aktív kezelés'), { target: { value: 'lower' } }); });
  expect(screen.getByTestId('clinical-plan')).toHaveTextContent('upper');
  expect(mocks.confirm).toHaveBeenCalledTimes(2);
  mocks.confirm.mockResolvedValue(true);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Gondozás / igazítás' })); });
  expect(screen.getByTestId('aftercare')).toHaveTextContent('upper');
});

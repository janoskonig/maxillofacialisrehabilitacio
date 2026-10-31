import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EpisodeObstaclesPanel } from '@/components/EpisodeObstaclesPanel';
import { ObstacleWaitingList } from '@/components/ObstacleWaitingList';
import type { WaitingObstacle } from '@/lib/episode-obstacles';

const base: WaitingObstacle = {
  id: 'quote', episodeId: 'ep-1', patientId: 'patient', patientName: 'Teszt Anna', episodeTitle: 'Felső fogpótlás',
  key: 'WAIT_QUOTE', waitingOn: 'Minta Fogtechnika', waitingSince: '2026-10-01T10:00:00Z', active: true,
  expiresAt: null, expectedUnblockDate: '2026-10-15T10:00:00Z', note: null, createdAt: '2026-10-01T10:00:00Z',
  resolvedAt: null, resolutionNote: null, assignedProviderId: null, assignedProviderName: null, currentStageLabel: null,
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(initial: WaitingObstacle[] = []) {
  let blocks = [...initial];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      const data = JSON.parse(String(init.body));
      blocks.push({ ...base, ...data, waitingSince: `${data.waitingSince}T10:00:00Z` });
    }
    if (init?.method === 'PATCH') {
      const data = JSON.parse(String(init.body));
      blocks = blocks.map((block) => url.endsWith(block.id) ? { ...block, active: false, resolvedAt: '2026-10-31T12:00:00Z', resolutionNote: data.resolutionNote } : block);
    }
    return { ok: true, json: async () => ({ blocks, obstacles: blocks, serverNow: '2026-10-31T12:00:00Z' }) } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

it('records the exact waiting party and the waiting date from the patient workflow', async () => {
  const fetchMock = setup();
  const changed = vi.fn();
  render(<EpisodeObstaclesPanel episodeId="ep-1" onChanged={changed} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Akadály rögzítése' }));
  fireEvent.change(screen.getByLabelText('Mire várunk?'), { target: { value: 'WAIT_QUOTE' } });
  fireEvent.change(screen.getByLabelText('Kitől / honnan várjuk pontosan?'), { target: { value: 'Minta Fogtechnika' } });
  fireEvent.change(screen.getByLabelText('Várakozás kezdete'), { target: { value: '2026-10-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Mentés' }));
  await screen.findByText('Minta Fogtechnika');
  expect(fetchMock).toHaveBeenCalledWith('/api/episodes/ep-1/blocks', expect.objectContaining({ method: 'POST', body: expect.stringContaining('"waitingOn":"Minta Fogtechnika"') }));
  expect(screen.getByText(/30 napja várunk/)).toBeInTheDocument();
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
});

it('resolves one obstacle while another remains active and keeps the resolved history', async () => {
  setup([base, { ...base, id: 'histology', key: 'WAIT_HISTOLOGY', waitingOn: 'Patológia' }]);
  render(<EpisodeObstaclesPanel episodeId="ep-1" />);
  await screen.findByText('Minta Fogtechnika');
  fireEvent.click(screen.getAllByRole('button', { name: 'Feloldás' })[0]);
  fireEvent.change(screen.getByLabelText('Mi oldotta fel az akadályt? (opcionális)'), { target: { value: 'Árajánlat megérkezett' } });
  fireEvent.click(screen.getByRole('button', { name: 'Akadály feloldása' }));
  await screen.findByRole('heading', { name: 'Akadályok (1)' });
  expect(screen.getByText('Patológia')).toBeInTheDocument();
  expect(screen.getByText('Korábbi akadályok (1)')).toBeInTheDocument();
  expect(screen.getByText('Árajánlat megérkezett')).toBeInTheDocument();
});

it('shows a single waiting row per treatment, sorted by wait, and searches the exact waiting party', async () => {
  setup([base, { ...base, id: 'histology', key: 'WAIT_HISTOLOGY', waitingOn: 'Patológia' },
    { ...base, id: 'other', episodeId: 'ep-2', patientId: 'other-patient', patientName: 'Teszt Béla', waitingOn: 'Minta Biztosító', waitingSince: '2026-10-20T10:00:00Z' }]);
  render(<ObstacleWaitingList />);
  await screen.findByRole('link', { name: 'Teszt Anna' });
  expect(screen.getByText('2 várakozó kezelés · 3 akadály')).toBeInTheDocument();
  expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Teszt Anna', 'Teszt Béla']);
  expect(screen.getByRole('link', { name: 'Teszt Anna' })).toHaveAttribute('href', '/patients/patient/stages?episodeId=ep-1#akadalyok');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Biztosító' } });
  expect(screen.queryByRole('link', { name: 'Teszt Anna' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Teszt Béla' })).toBeInTheDocument();
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EpisodeTreatmentPlanEditor, EpisodeTreatmentPlanDisclosure } from '@/components/EpisodeTreatmentPlanEditor';
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
const saved = { episodeId: 'ep1', treatmentPlan: null as string | null, treatmentPlanUpper: 'Eredeti terv', treatmentPlanLower: 'Alsó terv', version: 3 };
const response = (plan = saved, status = 200, code?: string) => new Response(JSON.stringify({ plan, code }), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function mount(canEdit = true) {
  render(<EpisodeTreatmentPlanEditor episodeId="ep1" canEdit={canEdit} />);
  await screen.findByText(canEdit ? 'Mentett kezelési tervek' : 'Eredeti terv');
}
describe('Episode treatment plan editor', () => {
  it('loads and explicitly saves the ep-specific draft with its version', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ ...saved, treatmentPlanUpper: 'Új terv', version: 4 }));
    vi.stubGlobal('fetch', fetch);
    await mount();
    fireEvent.change(screen.getByLabelText('Felső állcsont kezelési terve'), { target: { value: 'Új terv' } });
    expect(screen.getByText('Nem mentett módosítások')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Kezelési tervek mentése' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1][0]).toBe('/api/episodes/ep1/treatment-plan');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ treatmentPlanUpper: 'Új terv', treatmentPlanLower: 'Alsó terv', expectedVersion: 3 });
    await screen.findByText('Mentett kezelési tervek');
  });
  it('preserves a failed draft for retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Mentési hiba' }), { status: 500 })));
    await mount();
    fireEvent.change(screen.getByLabelText('Felső állcsont kezelési terve'), { target: { value: 'Saját terv' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kezelési tervek mentése' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByLabelText('Felső állcsont kezelési terve') as HTMLTextAreaElement).value).toBe('Saját terv');
  });
  it('keeps local text on conflict and displays the other saved version', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ ...saved, treatmentPlanUpper: 'Másik orvos terve', version: 4 }, 409, 'TREATMENT_PLAN_CONFLICT')).mockResolvedValueOnce(response({ ...saved, treatmentPlanUpper: 'Áttekintett közös terv', version: 5 }));
    vi.stubGlobal('fetch', fetch);
    await mount();
    const input = screen.getByLabelText('Felső állcsont kezelési terve') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Saját terv' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kezelési tervek mentése' }));
    await screen.findByText('Másik orvos terve');
    expect(input.value).toBe('Saját terv');
    fireEvent.change(input, { target: { value: 'Áttekintett közös terv' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áttekintett terv mentése' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetch.mock.calls[2][1].body).expectedVersion).toBe(4);
  });
  it('shows a read-only saved plan without edit controls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    await mount(false);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('Kezelési tervek mentése')).toBeNull();
  });
  it('loads a previous episode plan only when requested', async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    render(<EpisodeTreatmentPlanDisclosure episodeId="ep1" canEdit={false} />);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Kezelési tervek megtekintése' }));
    await screen.findByText('Eredeti terv');
  });
  it('notifies the parent about unsaved changes and allows discarding them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    const onStateChange = vi.fn();
    render(<EpisodeTreatmentPlanEditor episodeId="ep1" canEdit onStateChange={onStateChange} />);
    await screen.findByText('Mentett kezelési tervek');
    fireEvent.change(screen.getByLabelText('Felső állcsont kezelési terve'), { target: { value: 'Módosított terv' } });
    await waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith({ dirty: true, saving: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Módosítások elvetése' }));
    await waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith({ dirty: false, saving: false }));
  });
  it('edits the lower plan independently and does not guess the jaw of legacy text', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ ...saved, treatmentPlan: 'Régi közös szöveg', treatmentPlanUpper: '', treatmentPlanLower: '' }));
    vi.stubGlobal('fetch', fetch);
    render(<EpisodeTreatmentPlanEditor episodeId="ep1" canEdit />);
    await screen.findByText('Régi közös szöveg');
    const upper = screen.getByLabelText('Felső állcsont kezelési terve') as HTMLTextAreaElement;
    const lower = screen.getByLabelText('Alsó állcsont kezelési terve') as HTMLTextAreaElement;
    expect(upper.value).toBe('');
    expect(lower.value).toBe('');
    fireEvent.change(lower, { target: { value: 'Új alsó terv' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hozzáadás az alsó tervhez' }));
    expect(lower.value).toBe('Új alsó terv\n\nRégi közös szöveg');
    expect(upper.value).toBe('');
  });

});

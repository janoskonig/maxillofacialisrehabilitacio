import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PatientAftercare } from '@/components/aftercare/PatientAftercare';
import { VisitForm } from '@/components/aftercare/VisitForm';
import { FollowupForm } from '@/components/aftercare/FollowupForm';
import { encounterSchema, type AftercareWorkspace, type Prosthesis, type CareEncounter } from '@/lib/aftercare/model';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const p: Prosthesis = { id: '11111111-1111-4111-8111-111111111111', patientId: 'patient', episodeId: 'episode', jaw: 'felso',
  prosthesisType: 'obturator', label: 'Felső obturátor', deliveryDate: '2025-01-31', deliveryAppointmentId: 'delivery', baseline: {}, originalPlan: {}, createdAt: '2025-01-01' };
const data: AftercareWorkspace = { patientName: 'Test', deceased: false, episodes: [], prostheses: [p], encounters: [], requests: [],
  appointments: [{ id: '22222222-2222-4222-8222-222222222222', episodeId: 'episode', startTime: '2025-02-10T10:00:00Z', occurredOn: '2025-02-10', clinician: 'Doctor', appointmentStatus: 'completed' }] };

it('records one shared set of findings without an obligatory return appointment', () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const lower = { ...p, id: '33333333-3333-4333-8333-333333333333', jaw: 'also' as const, label: 'Alsó híd' };
  render(<VisitForm data={{ ...data, prostheses: [p, lower] }} initialAppointmentId={data.appointments[0].id} busy={false} onSave={onSave} onCancel={() => {}} />);
  fireEvent.click(screen.getByLabelText('Felső obturátor'));
  fireEvent.click(screen.getByLabelText('Alsó híd'));
  expect(screen.getAllByLabelText('Fájdalom / nyomás')).toHaveLength(1);
  fireEvent.click(screen.getByLabelText('Fájdalom / nyomás'));
  fireEvent.click(screen.getByLabelText('Instabilitás'));
  fireEvent.click(screen.getByLabelText('Nyomási pont igazítása'));
  fireEvent.click(screen.getByLabelText('Retenció igazítása'));
  fireEvent.click(screen.getByLabelText('Javult'));
  expect(screen.queryByLabelText('Hány nap múlva?')).toBeNull();
  fireEvent.submit(screen.getByRole('form', { name: 'Klinikai vizit dokumentálása' }));
  const saved = onSave.mock.calls[0][0];
  expect(saved).toMatchObject({ clinicalMinutes: null, returnAfterDays: null, links: [
    { prosthesisId: p.id, problems: ['pain_pressure', 'retention_stability'], interventions: ['pressure_relief', 'retention_adjustment'], result: 'improved', nextAction: null },
    { prosthesisId: lower.id, problems: ['pain_pressure', 'retention_stability'], interventions: ['pressure_relief', 'retention_adjustment'], result: 'improved', nextAction: null },
  ] });
  expect(encounterSchema.safeParse(saved).success).toBe(true);
});

it('records a problem-free review with one choice and no manufactured result or future appointment', () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<VisitForm data={data} initialAppointmentId={data.appointments[0].id} busy={false} onSave={onSave} onCancel={() => {}} />);
  fireEvent.click(screen.getByLabelText('Nincs panasz'));
  expect(screen.queryByText('Elvégzett munka')).toBeNull();
  fireEvent.submit(screen.getByRole('form', { name: 'Klinikai vizit dokumentálása' }));
  expect(onSave.mock.calls[0][0]).toMatchObject({ returnAfterDays: null, links: [{ problems: [], interventions: ['advice'], result: null, nextAction: null }] });
  expect(encounterSchema.safeParse(onSave.mock.calls[0][0]).success).toBe(true);
});

it('only asks for the interval when the doctor requests a new slot', () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<VisitForm data={data} initialAppointmentId={data.appointments[0].id} busy={false} onSave={onSave} onCancel={() => {}} />);
  fireEvent.click(screen.getByLabelText('Nincs panasz'));
  fireEvent.click(screen.getByLabelText('Új időpontot kérek'));
  fireEvent.change(screen.getByLabelText('Hány nap múlva?'), { target: { value: '14' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Klinikai vizit dokumentálása' }));
  expect(onSave.mock.calls[0][0]).toMatchObject({ returnAfterDays: 14, links: [{ nextAction: 'routine_review' }] });
  expect(encounterSchema.safeParse(onSave.mock.calls[0][0]).success).toBe(true);
});

it('requires an explicit follow-up interpretation and keeps unknown scores blank', () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<FollowupForm prosthesis={p} busy={false} onSave={onSave} onCancel={() => {}} />);
  fireEvent.submit(screen.getByRole('form', { name: 'Háromhavi követés' }));
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'unknown', unresolved: null, functionScore: null, comfortScore: null }));
  fireEvent.change(screen.getByLabelText('Követés állapota'), { target: { value: 'comfortable' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Háromhavi követés' }));
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'comfortable', unresolved: false, contactMethod: 'phone' }));
});

it('does not carry clinical measurements or notes into a different appointment', () => {
  const second = { ...data.appointments[0], id: '44444444-4444-4444-8444-444444444444', occurredOn: '2025-02-11', startTime: '2025-02-11T10:00:00Z' };
  render(<VisitForm data={{ ...data, appointments: [...data.appointments, second] }} busy={false} onSave={vi.fn()} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('Időpont'), { target: { value: data.appointments[0].id } });
  fireEvent.click(screen.getByText('Megjegyzés és további adatok'));
  fireEvent.change(screen.getByLabelText('Megjegyzés'), { target: { value: 'First visit note' } });
  fireEvent.change(screen.getByLabelText('Mért klinikai idő (perc)'), { target: { value: '20' } });
  fireEvent.change(screen.getByLabelText('Időpont'), { target: { value: second.id } });
  expect((screen.getByLabelText('Megjegyzés') as HTMLTextAreaElement).value).toBe('');
  expect((screen.getByLabelText('Mért klinikai idő (perc)') as HTMLInputElement).value).toBe('');
});


it('embeds the short form without fetching or repeating the patient and episode navigation', () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  render(<PatientAftercare patientId="patient" selectedEpisodeId="episode" embedded workspace={{ ...data,
    episodes: [{ id: 'episode', label: 'Felső', status: 'open' }, { id: 'other', label: 'Másik kezelés', status: 'open' }],
  }} />);
  expect(screen.getByRole('form', { name: 'Klinikai vizit dokumentálása' })).toBeTruthy();
  expect(screen.queryByText('Test')).toBeNull();
  expect(screen.queryByLabelText('Ellátási epizód')).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it('keeps the appointment picker on the selected treatment when embedded', () => {
  render(<VisitForm data={{ ...data, appointments: [...data.appointments, { ...data.appointments[0], id: 'other-visit', episodeId: 'other', clinician: 'Másik orvos' }] }} preferredEpisodeId="episode" busy={false} onSave={vi.fn()} onCancel={() => {}} />);
  expect(screen.getByLabelText('Időpont').textContent).not.toContain('Másik orvos');
  expect((screen.getByLabelText('Időpont') as HTMLSelectElement).value).toBe(data.appointments[0].id);
});


it('omits the delivery appointment from a new visit but allows explicit delivery documentation', () => {
  const delivered = { ...data, appointments: [...data.appointments, { ...data.appointments[0], id: 'delivery' }] };
  const props = { data: delivered, busy: false, onSave: vi.fn(), onCancel: () => {} };
  const { rerender } = render(<VisitForm {...props} />);
  expect((screen.getByLabelText('Időpont') as HTMLSelectElement).options).toHaveLength(2);
  expect((screen.getByLabelText('Időpont') as HTMLSelectElement).value).toBe(data.appointments[0].id);
  rerender(<VisitForm key="explicit" {...props} initialAppointmentId="delivery" />);
  expect(screen.getByRole('form', { name: 'Klinikai vizit dokumentálása' })).toBeTruthy();
});

it('resets the embedded form when a different timeline appointment is opened', () => {
  const saved: CareEncounter = { id: 'saved-encounter', version: 2, appointmentId: data.appointments[0].id,
    phase: 'aftercare', occurredOn: '2025-02-10', appointmentStatus: 'completed', clinician: 'Doctor',
    clinicalMinutes: null, constructionActivities: [], planDeviation: '', delayReason: 'none', note: 'Saved finding', returnAfterDays: null,
    links: [{ prosthesisId: p.id, problems: ['pain_pressure'], interventions: ['pressure_relief'], result: 'persists', nextAction: null, functionScore: null, comfortScore: null }] };
  const workspace = { ...data, appointments: [...data.appointments, { ...data.appointments[0], id: 'new-visit' }], encounters: [saved] };
  const props = { patientId: 'patient', selectedEpisodeId: 'episode', embedded: true, workspace };
  const { rerender } = render(<PatientAftercare {...props} initialAppointmentId="new-visit" />);
  fireEvent.change(screen.getByLabelText('Megjegyzés'), { target: { value: 'Unsaved new visit' } });
  rerender(<PatientAftercare {...props} initialAppointmentId={saved.appointmentId} />);
  expect((screen.getByLabelText('Megjegyzés') as HTMLTextAreaElement).value).toBe('Saved finding');
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PatientForm } from '@/components/PatientForm';
import { savePatient } from '@/lib/storage';
import { patientSchema } from '@/lib/types';

// A valódi PatientForm és autosave hook fut; a környező felületrészek nem
// szükségesek az implantátum önálló módosításának mentési regressziójához.
vi.mock('@/components/patient-form', async () => {
  const { ImplantatumokSection } = await import('@/components/patient-form/ImplantatumokSection');
  return {
    ImplantatumokSection,
    BetegvizsgalatSection: () => null,
    AlapadatokSection: () => null, SzemelyesAdatokSection: () => null,
    BeutaloSection: () => null, AnamnezisSection: () => null,
    MeltanyossagiSection: () => null, ArajanlatkeroSection: () => null,
    ResearchConsentSection: () => null, ConflictModal: () => null,
    DuplicateWarningCard: () => null, StickySubmitBar: () => null,
    getToothState: () => 'empty',
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('@/contexts/ToastContext', () => {
  const context = { confirm: vi.fn(), showToast: vi.fn() };
  return { useToast: () => context };
});
vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn().mockResolvedValue({ role: 'admin' }) }));
vi.mock('@/lib/storage', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/storage')>(),
  savePatient: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [], institutions: [], episodes: [], quoteRequests: [], treatmentTypes: [], matches: [] }) }));
  vi.mocked(savePatient).mockImplementation(async patient => ({ ...patient, updatedAt: '2026-11-04T09:00:00.000Z' }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('egyedül az implantátumleírás kiürítése is automatikusan ment, a pozíció és a többi szöveg megmarad', async () => {
  const patient = patientSchema.parse({ id: 'implant-save-test', nev: 'Teszt', updatedAt: '2026-11-04T08:00:00.000Z',
    meglevoImplantatumok: { '11': 'Korábbi leírás', '36': 'Másik implantátum' },
    nemIsmertPoziciokbanImplantatumRészletek: 'Régi szabadszavas megjegyzés',
  });
  render(<PatientForm patient={patient} onSave={vi.fn()} onCancel={vi.fn()} showOnlySections={['betegvizsgalat']} />);
  expect(savePatient).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('11. pozíció'), { target: { value: '' } });
  await waitFor(() => expect(savePatient).toHaveBeenCalled(), { timeout: 3000 });
  const saved = vi.mocked(savePatient).mock.calls.at(-1)![0];
  expect(saved.meglevoImplantatumok).toEqual({ '11': '', '36': 'Másik implantátum' });
  expect(saved.nemIsmertPoziciokbanImplantatumRészletek).toBe('Régi szabadszavas megjegyzés');
  expect((screen.getByRole('checkbox', { name: 'Implantátum: 11. pozíció' }) as HTMLInputElement).checked).toBe(true);
});

it.each([
  { tooth: 24, expected: { '11': 'Korábbi leírás', '24': '' } },
  { tooth: 11, expected: {} },
])('a pozíció ($tooth) kapcsolása más mező szerkesztése nélkül is automatikusan ment', async ({ tooth, expected }) => {
  const patient = patientSchema.parse({ id: 'implant-toggle-test', nev: 'Teszt', meglevoImplantatumok: { '11': 'Korábbi leírás' } });
  render(<PatientForm patient={patient} onSave={vi.fn()} onCancel={vi.fn()} showOnlySections={['betegvizsgalat']} />);
  fireEvent.click(screen.getByRole('checkbox', { name: `Implantátum: ${tooth}. pozíció` }));
  await waitFor(() => expect(savePatient).toHaveBeenCalled(), { timeout: 3000 });
  expect(vi.mocked(savePatient).mock.calls.at(-1)![0].meglevoImplantatumok).toEqual(expected);
});

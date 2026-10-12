import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PatientHeaderBar } from '@/components/PatientHeaderBar';
import type { Patient } from '@/lib/types';

vi.mock('@/components/KezeloorvosDelegationWidget', () => ({
  KezeloorvosDelegationWidget: () => null,
}));

const patient = {
  id: 'a77ba197-8715-45ed-b595-6d7420fb8020',
  nev: 'Minta Anna',
  createdBy: 'regisztralo.orvos@example.com',
  createdAt: '2026-09-01T12:00:00Z',
} as Patient;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url.includes('completeness')
      ? { score: 100, clinicalMissing: 0, researchMissing: 0, recommendedMissing: 0 }
      : { items: [] },
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('patient header registration visibility', () => {
  it('shows the recorded registrar and registration date by default', async () => {
    render(<PatientHeaderBar patient={patient} currentStage={null} />);
    await screen.findByText('Adatteljesség 100%');

    expect(screen.getByText('Más regisztrálta')).toBeTruthy();
    expect(screen.getByText('Regisztráló: regisztralo.orvos@example.com')).toBeTruthy();
    expect(screen.getByText('2026-09-01').closest('time')?.getAttribute('datetime'))
      .toBe(patient.createdAt);
  });

  it('hides registrar and registration date when access is denied, even with populated patient data', async () => {
    render(
      <PatientHeaderBar
        patient={patient}
        currentStage={null}
        canSeeRegistration={false}
      />,
    );
    await screen.findByText('Adatteljesség 100%');

    expect(screen.getByText('Minta Anna')).toBeTruthy();
    expect(screen.queryByText('Más regisztrálta')).toBeNull();
    expect(screen.queryByText(/regisztralo\.orvos@example\.com/)).toBeNull();
    expect(screen.queryByText(/Regisztráció:/)).toBeNull();
    expect(screen.queryByText('2026-09-01')).toBeNull();
    expect(screen.queryByText('Regisztráló nincs rögzítve')).toBeNull();
  });
});

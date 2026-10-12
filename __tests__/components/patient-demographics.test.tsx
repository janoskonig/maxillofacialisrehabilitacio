import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PatientDemographics } from '@/components/PatientDemographics';
import type { Patient } from '@/lib/types';

const patient = (overrides: Partial<Patient> = {}) => ({
  nev: 'Minta Anna',
  szuletesiDatum: '1978-10-12',
  ...overrides,
}) as Patient;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 12, 12));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('patient demographics', () => {
  it('shows current age before the birthday even when gender is absent', () => {
    vi.setSystemTime(new Date(2026, 9, 11, 12));
    render(<PatientDemographics patient={patient()} />);

    expect(screen.getByText('47 éves')).toBeTruthy();
    expect(screen.getByText('Szül.: 1978-10-12')).toBeTruthy();
  });

  it('increments current age on the birthday and translates gender', () => {
    render(<PatientDemographics patient={patient({ nem: 'no' })} />);

    expect(screen.getByText('Nő · 48 éves')).toBeTruthy();
  });

  it('shows the age at death and explicitly identifies it as such', () => {
    render(<PatientDemographics patient={patient({
      nem: 'ferfi',
      szuletesiDatum: '1980-06-15',
      halalDatum: '2020-06-14',
    })} />);

    expect(screen.getByText('Férfi · 39 évesen hunyt el')).toBeTruthy();
    expect(screen.getByText('Szül.: 1980-06-15 · Elhunyt: 2020-06-14')).toBeTruthy();
    expect(screen.queryByText(/46 éves/)).toBeNull();
  });

  it.each([
    { szuletesiDatum: 'invalid-date' },
    { szuletesiDatum: '2027-10-12' },
    { halalDatum: 'invalid-date' },
    { halalDatum: '1970-10-12' },
  ])('does not display invalid or negative age for %j', (overrides) => {
    const { container } = render(<PatientDemographics patient={patient(overrides)} />);

    expect(container.textContent).not.toMatch(/éves/);
    expect(container.textContent).not.toMatch(/NaN/);
  });

  it('still shows death status when birth date is missing', () => {
    render(<PatientDemographics patient={patient({ szuletesiDatum: null, halalDatum: '2020-06-14' })} />);

    expect(screen.getByText('Elhunyt: 2020-06-14')).toBeTruthy();
    expect(screen.queryByText(/éves/)).toBeNull();
  });

  it('omits the empty block when no demographic data is recorded', () => {
    const { container } = render(<PatientDemographics patient={patient({ szuletesiDatum: null })} />);

    expect(container.childElementCount).toBe(0);
  });
});

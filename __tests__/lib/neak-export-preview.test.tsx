import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NeakExportPreview } from '@/components/NeakExportPreview';
import { buildNeakExportPlan } from '@/lib/neak-export';
import type { Patient } from '@/lib/types';
import { buildTreatmentExportContent } from '@/lib/neak-treatment-content';
import { buildDentalExportContent } from '@/lib/neak-dental-content';
import { neakClinicalPatient, neakClinicalSources } from '../fixtures/neak-clinical';

const patient = {
  nev: 'Teszt Elek', nem: 'férfi', szuletesiDatum: '1980-01-01', taj: '123456789',
  kezelesreErkezesIndoka: 'rehabilitáció', diagnozis: 'teszt', meglevoFogak: ['11'],
} as unknown as Patient;
const doc = { id: 'op', tags: ['op'], filename: 'panorama.jpg', fileSize: 1024 };
afterEach(cleanup);

describe('NEAK export preview', () => {
  it('shows missing fields and documents, blocks download and offers upload', () => {
    const onDownload = vi.fn();
    const onUpload = vi.fn();
    render(<NeakExportPreview plan={buildNeakExportPlan({ ...patient, nev: '' }, [])} loading={false} onDownload={onDownload} onClose={vi.fn()} onUpload={onUpload} />);
    expect(screen.getByText('Név')).toBeTruthy();
    expect(screen.getByText('OP röntgenfelvétel: 0 / 1 db')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'NEAK csomag letöltése' }));
    expect(onDownload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dokumentum feltöltése' }));
    expect(onUpload).toHaveBeenCalledOnce();
  });
  it('lists selected attachments and requires an explicit download click', () => {
    const onDownload = vi.fn();
    render(<NeakExportPreview plan={buildNeakExportPlan(patient, [doc])} loading={false} onDownload={onDownload} onClose={vi.fn()} />);
    expect(screen.getByText(/panorama.jpg/)).toBeTruthy();
    expect(screen.getByText(/születési helyet és az anyja nevét/)).toBeTruthy();
    expect(onDownload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'NEAK csomag letöltése' }));
    expect(onDownload).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Dokumentum feltöltése' })).toBeNull();
  });
  it('prevents a second download while generating the package', () => {
    const onDownload = vi.fn();
    render(<NeakExportPreview plan={buildNeakExportPlan(patient, [doc])} loading onDownload={onDownload} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Csomag összeállítása…' }));
    expect(onDownload).not.toHaveBeenCalled();
  });
  it('shows the actual clinical content before download', () => {
    const plan = {
      ...buildNeakExportPlan(patient, [doc]),
      treatmentContent: buildTreatmentExportContent(neakClinicalPatient, neakClinicalSources),
      dentalContent: buildDentalExportContent(neakClinicalPatient),
    };
    render(<NeakExportPreview plan={plan} loading={false} onDownload={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/15\. fog: Tömés/)).toBeTruthy();
    expect(screen.getByText(/Mobilitás: 2/)).toBeTruthy();
    expect(screen.getByText(/Teljes lemezes fogpótlás; állapot: tervezett/)).toBeTruthy();
  });
});

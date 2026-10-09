import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LabQuoteSendModal } from '@/components/patient-form/LabQuoteSendModal';
import { LAB_QUOTE_TARGETS } from '@/lib/email/lab-quote-target-catalog';

const fetchMock = vi.fn();
const props = {
  isOpen: true, onClose: vi.fn(), patientId: 'patient-1', patientName: 'Teszt Beteg',
  quote: { id: 'quote-1', szoveg: 'Kérés', datuma: '2026-10-20' },
  onSent: vi.fn(), showToast: vi.fn(() => 'toast'),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => ({
    ok: true,
    json: async () => options?.method === 'POST' ? { recipients: ['idssote@gmail.com'] } : {
      targets: LAB_QUOTE_TARGETS, suggestions: [], defaultTo: 'legacy@example.com',
    },
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openModal() {
  render(<LabQuoteSendModal {...props} />);
  await waitFor(() => expect((screen.getByLabelText('Mire kérünk ajánlatot?') as HTMLSelectElement).disabled).toBe(false));
}

describe('quote target selection', () => {
  it('defaults fogtechnika to Interdental and includes the upload link', async () => {
    await openModal();
    fireEvent.click(screen.getByRole('button', { name: 'Küldés' }));
    await waitFor(() => expect(props.onSent).toHaveBeenCalled());
    const request = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(JSON.parse(request[1].body)).toEqual({ recipients: ['idssote@gmail.com'], targetId: 'fogtechnika', includeUploadLink: true });
  });

  it('clears the previous address for a target whose email is not yet known', async () => {
    await openModal();
    fireEvent.change(screen.getByLabelText('Mire kérünk ajánlatot?'), { target: { value: 'neoss' } });
    expect((screen.getByRole('button', { name: 'Küldés' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('idssote@gmail.com')).toBeNull();
    fireEvent.change(screen.getByLabelText('Neoss ügyfélszolgálat e-mail címe'), { target: { value: 'neoss@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Küldés' }));
    await waitFor(() => expect(props.onSent).toHaveBeenCalled());
    const request = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(JSON.parse(request[1].body)).toMatchObject({ recipients: ['neoss@example.com'], targetId: 'neoss' });
  });

  it('selects the confirmed nurse address for other implant equipment', async () => {
    await openModal();
    fireEvent.change(screen.getByLabelText('Mire kérünk ajánlatot?'), { target: { value: 'implantacio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Küldés' }));
    await waitFor(() => expect(props.onSent).toHaveBeenCalled());
    const request = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(JSON.parse(request[1].body)).toMatchObject({ recipients: ['toth-balazs.zsuzsanna@semmelweis.hu'], targetId: 'implantacio' });
  });

  it('persists a confirmed service address for later requests', async () => {
    await openModal();
    fireEvent.change(screen.getByLabelText('Mire kérünk ajánlatot?'), { target: { value: 'neoss' } });
    fireEvent.change(screen.getByLabelText('Neoss ügyfélszolgálat e-mail címe'), { target: { value: 'neoss@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cím mentése' }));
    await waitFor(() => expect(props.showToast).toHaveBeenCalledWith('Célcsoport e-mail címe elmentve', 'success'));
    const request = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')!;
    expect(JSON.parse(request[1].body)).toEqual({ targetId: 'neoss', email: 'neoss@example.com' });
  });
});

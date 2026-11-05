import { useState, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ArajanlatkeroSection } from '@/components/patient-form/ArajanlatkeroSection';
import { formatDateForInput } from '@/lib/dateUtils';

vi.mock('@/components/DatePicker', () => ({
  DatePicker: ({ selected, onChange, disabled }: {
    selected: Date | null; onChange: (date: Date | null) => void; disabled?: boolean;
  }) => <input type="date" value={selected ? formatDateForInput(selected.toString()) : ''}
    onChange={event => onChange(event.target.value ? new Date(`${event.target.value}T00:00:00`) : null)} disabled={disabled} />,
}));
vi.mock('@/components/patient-form/LabQuoteSendModal', () => ({
  LabQuoteSendModal: ({ isOpen, quote, onSent, onClose }: {
    isOpen: boolean; quote: { id: string } | null;
    onSent: (id: string, result: unknown) => void; onClose: () => void;
  }) => isOpen && quote ? <button type="button" onClick={() => {
    onSent(quote.id, { sentAt: '2026-11-05T10:00:00Z', sentBy: 'doctor@example.com', recipients: ['partner@example.com'] });
    onClose();
  }}>Küldés</button> : null,
}));

type Props = ComponentProps<typeof ArajanlatkeroSection>;
const quote = { id: 'q1', szoveg: 'Eredeti árajánlatkérés', datuma: '2026-11-20', hasBeenSent: false };
const fetchMock = vi.fn();
const showToast = vi.fn(() => 'toast');

function Harness({ quotes = [quote], ...overrides }: Partial<Props> & { quotes?: Props['labQuoteRequests'] }) {
  const [labQuoteRequests, setLabQuoteRequests] = useState(quotes);
  const [newQuoteSzoveg, setNewQuoteSzoveg] = useState('');
  const [newQuoteDatuma, setNewQuoteDatuma] = useState<Date | null>(null);
  return <ArajanlatkeroSection isViewOnly={false} patientId="p1" userRole="admin"
    labQuoteRequests={labQuoteRequests} setLabQuoteRequests={setLabQuoteRequests}
    newQuoteSzoveg={newQuoteSzoveg} setNewQuoteSzoveg={setNewQuoteSzoveg}
    newQuoteDatuma={newQuoteDatuma} setNewQuoteDatuma={setNewQuoteDatuma}
    currentPatientName="Teszt Beteg" confirmDialog={vi.fn()} showToast={showToast} {...overrides} />;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ quoteRequest: { ...quote, szoveg: 'Javított kérés', datuma: '2026-11-25' } }) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('saved quote editing', () => {
  it('opens the saved text and date, then saves changes to the same quote', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Szerkesztés' }));
    const text = screen.getByLabelText('Árajánlatkérő szöveg') as HTMLTextAreaElement;
    const date = screen.getByLabelText('Árajánlatkérő dátuma') as HTMLInputElement;
    expect(text.value).toBe(quote.szoveg);
    expect(date.value).toBe('2026-11-20');
    fireEvent.change(text, { target: { value: '  Javított kérés  ' } });
    fireEvent.change(date, { target: { value: '2026-11-25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Módosítások mentése' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Árajánlatkérő sikeresen módosítva', 'success'));
    expect(fetchMock).toHaveBeenCalledWith('/api/patients/p1/lab-quote-requests/q1', expect.objectContaining({
      method: 'PUT', credentials: 'include', body: JSON.stringify({ szoveg: 'Javított kérés', datuma: '2026-11-25' }),
    }));
    expect(screen.getByText('Javított kérés')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Módosítások mentése' })).toBeNull();
  });

  it('discards editing on cancel without changing the quote', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Szerkesztés' }));
    fireEvent.change(screen.getByLabelText('Árajánlatkérő szöveg'), { target: { value: 'Elvetett szöveg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mégse' }));
    expect(screen.getByText(quote.szoveg)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { ...quote, hasBeenSent: true, lastEmailStatus: 'sent' as const },
    { ...quote, hasBeenSent: true, lastEmailStatus: 'failed' as const },
    { ...quote, hasBeenSent: undefined, lastEmailStatus: 'sent' as const },
  ])('hides editing after any successful send ($lastEmailStatus last)', sentQuote => {
    render(<Harness quotes={[sentQuote]} />);
    expect(screen.queryByRole('button', { name: 'Szerkesztés' })).toBeNull();
    expect(screen.getByText('Elküldött árajánlatkérő nem szerkeszthető.')).toBeTruthy();
  });

  it('allows editing after a failed first attempt', () => {
    render(<Harness quotes={[{ ...quote, lastEmailStatus: 'failed' }]} />);
    expect(screen.getByRole('button', { name: 'Szerkesztés' })).toBeTruthy();
  });

  it('removes editing immediately after sending', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Email' }));
    fireEvent.click(screen.getByRole('button', { name: 'Küldés' }));
    expect(screen.queryByRole('button', { name: 'Szerkesztés' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Újraküldés' })).toBeTruthy();
  });

  it('locks a stale open editor when the server reports a send from another session', async () => {
    const error = 'Az árajánlatkérő már el lett küldve, ezért nem szerkeszthető';
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error }) });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Szerkesztés' }));
    fireEvent.click(screen.getByRole('button', { name: 'Módosítások mentése' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(error, 'error'));
    expect(screen.queryByRole('button', { name: 'Szerkesztés' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Módosítások mentése' })).toBeNull();
  });

  it('preserves unsaved changes when saving fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Hálózati hiba'));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Szerkesztés' }));
    fireEvent.change(screen.getByLabelText('Árajánlatkérő szöveg'), { target: { value: 'Javított kérés' } });
    fireEvent.click(screen.getByRole('button', { name: 'Módosítások mentése' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Hálózati hiba', 'error'));
    expect((screen.getByLabelText('Árajánlatkérő szöveg') as HTMLTextAreaElement).value).toBe('Javított kérés');
  });

  it('validates required text and date before sending an update', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Szerkesztés' }));
    fireEvent.change(screen.getByLabelText('Árajánlatkérő szöveg'), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Módosítások mentése' }));
    expect(showToast).toHaveBeenCalledWith('Az árajánlatkérő szöveg kötelező', 'error');
    fireEvent.change(screen.getByLabelText('Árajánlatkérő szöveg'), { target: { value: 'Kérés' } });
    fireEvent.change(screen.getByLabelText('Árajánlatkérő dátuma'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Módosítások mentése' }));
    expect(showToast).toHaveBeenCalledWith('Az árajánlatkérő dátuma kötelező', 'error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([{ isViewOnly: true }, { userRole: 'viewer' }])('respects edit permissions: %j', overrides => {
    render(<Harness {...overrides} />);
    expect(screen.queryByRole('button', { name: 'Szerkesztés' })).toBeNull();
  });
});

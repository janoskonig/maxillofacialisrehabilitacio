import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CancelAppointmentDialog } from '@/components/CancelAppointmentDialog';
import type { Appointment, CancelWithOfferParams, TimeSlot } from '@/hooks/useAppointmentBooking';

/**
 * Lemondás-dialógus: „csak lemondás" vs „lemondás és új ajánlat"; az ajánlat
 * csak e-mailes betegnek és jogosult szerepkörnek; a mentés a hívó
 * callbackjein át megy (a dialógus nem hív lemondó API-t).
 */
vi.mock('@/components/DateTimePicker', () => ({
  DateTimePicker: () => <div data-testid="datetimepicker" />,
}));

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const appointment: Appointment = {
  id: 'apt-1',
  patientId: 'pat-1',
  patientEmail: 'elek@example.com',
  timeSlotId: 'slot-old',
  startTime: future(2),
  dentistEmail: 'doki@dev.local',
  appointmentType: 'munkafazis',
  stepLabel: 'Lenyomatvétel',
};

const slots: TimeSlot[] = [
  { id: 'slot-old', startTime: future(2), status: 'available' },
  { id: 'slot-new', startTime: future(5), status: 'available', dentistName: 'Dr. Doki', teremszam: '12' },
  { id: 'slot-alt', startTime: future(6), status: 'available' },
  { id: 'slot-booked', startTime: future(7), status: 'booked' },
  { id: 'slot-past', startTime: new Date(Date.now() - 3_600_000).toISOString(), status: 'available' },
];

function renderDialog(overrides: Partial<React.ComponentProps<typeof CancelAppointmentDialog>> = {}) {
  const onPlainCancel = vi.fn(async () => ({ success: true }));
  const onCancelWithOffer = vi.fn(async (_params: CancelWithOfferParams) => ({ success: true }));
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(
    <CancelAppointmentDialog
      appointment={appointment}
      availableSlots={slots}
      canOffer
      canCreateSlot
      defaultCim="1088 Budapest, Szentkirályi utca 47"
      pool="work"
      onClose={onClose}
      onPlainCancel={onPlainCancel}
      onCancelWithOffer={onCancelWithOffer}
      onDone={onDone}
      {...overrides}
    />
  );
  return { onPlainCancel, onCancelWithOffer, onClose, onDone };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
});

describe('CancelAppointmentDialog', () => {
  it('alapból „csak lemondás": a Lemondás gomb a plain callbacket hívja, majd zár', async () => {
    const h = renderDialog();
    expect(screen.getByText('Lenyomatvétel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lemondás' }));
    await waitFor(() => expect(h.onPlainCancel).toHaveBeenCalledTimes(1));
    expect(h.onCancelWithOffer).not.toHaveBeenCalled();
    expect(h.onDone).toHaveBeenCalledWith('plain');
    expect(h.onClose).toHaveBeenCalled();
  });

  it('ajánlat mód: slot kötelező; a lemondott, foglalt és múltbeli slot nem választható', async () => {
    const h = renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: /Lemondás és új időpont ajánlása/ }));
    const submit = screen.getByRole('button', { name: 'Lemondás és ajánlat küldése' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    const select = screen.getByLabelText('Ajánlott új időpont') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain('slot-new');
    expect(values).toContain('slot-alt');
    expect(values).not.toContain('slot-old');
    expect(values).not.toContain('slot-booked');
    expect(values).not.toContain('slot-past');

    fireEvent.change(select, { target: { value: 'slot-new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hozzáadás' }));
    fireEvent.change(screen.getByLabelText('1. alternatív időpont'), { target: { value: 'slot-alt' } });
    fireEvent.change(screen.getByLabelText('Időpont típusa'), { target: { value: 'kontroll' } });

    fireEvent.click(screen.getByRole('button', { name: 'Lemondás és ajánlat küldése' }));
    await waitFor(() => expect(h.onCancelWithOffer).toHaveBeenCalledTimes(1));
    expect(h.onCancelWithOffer).toHaveBeenCalledWith({
      timeSlotId: 'slot-new',
      alternativeTimeSlotIds: ['slot-alt'],
      appointmentType: 'kontroll',
    });
    expect(h.onPlainCancel).not.toHaveBeenCalled();
    expect(h.onDone).toHaveBeenCalledWith('offer');
  });

  it('sikertelen művelet: hibaüzenet marad, a dialógus nem zár', async () => {
    const h = renderDialog({
      onPlainCancel: vi.fn(async () => ({ success: false, error: 'Nincs jogosultság [FORBIDDEN]' })),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lemondás' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Nincs jogosultság/));
    expect(h.onClose).not.toHaveBeenCalled();
    expect(h.onDone).not.toHaveBeenCalled();
  });

  it('e-mail nélküli betegnél az ajánlat mód nem választható', () => {
    renderDialog({ appointment: { ...appointment, patientEmail: null } });
    const offerRadio = screen.getByRole('radio', { name: /Lemondás és új időpont ajánlása/ }) as HTMLButtonElement;
    expect(offerRadio.disabled).toBe(true);
    expect(screen.getByText(/nincs rögzített e-mail címe/)).toBeTruthy();
    fireEvent.click(offerRadio);
    expect(screen.queryByLabelText('Ajánlott új időpont')).toBeNull();
  });

  it('jogosultság nélkül (canOffer=false) csak a sima lemondás él', () => {
    renderDialog({ canOffer: false });
    const offerRadio = screen.getByRole('radio', { name: /Lemondás és új időpont ajánlása/ }) as HTMLButtonElement;
    expect(offerRadio.disabled).toBe(true);
  });

  it('recall időpontnál a típus zárolt (recall)', async () => {
    const h = renderDialog({ appointment: { ...appointment, appointmentType: 'recall' } });
    fireEvent.click(screen.getByRole('radio', { name: /Lemondás és új időpont ajánlása/ }));
    const type = screen.getByLabelText('Időpont típusa') as HTMLSelectElement;
    expect(type.disabled).toBe(true);
    expect(type.value).toBe('recall');
    fireEvent.change(screen.getByLabelText('Ajánlott új időpont'), { target: { value: 'slot-new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lemondás és ajánlat küldése' }));
    await waitFor(() => expect(h.onCancelWithOffer).toHaveBeenCalled());
    expect(h.onCancelWithOffer.mock.calls[0][0]).toMatchObject({ appointmentType: 'recall' });
  });
});

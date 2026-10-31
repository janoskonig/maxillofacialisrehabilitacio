import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AppointmentBookingSection } from '@/components/AppointmentBookingSection';

const state = vi.hoisted(() => ({ appointments: [] as Array<Record<string, unknown>>, updateStatus: vi.fn() }));
vi.mock('@/hooks/useAppointmentBooking', () => ({ useAppointmentBooking: () => ({
  appointments: state.appointments, availableSlots: [], availableCims: [], DEFAULT_CIM: '',
  loading: false, loadError: null, userRole: 'admin', roleLoaded: true,
  updateAppointmentStatus: state.updateStatus,
}) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); state.appointments = []; });

describe('Status entry from the visit overview', () => {
  it('waits for the requested appointment and opens its existing status form without saving', () => {
    const handled = vi.fn();
    const { rerender } = render(<AppointmentBookingSection patientId="p1" openStatusAppointmentId="a2" onStatusOpened={handled} standalone />);
    expect(handled).not.toHaveBeenCalled();
    state.appointments = [
      { id: 'a1', patientId: 'p1', startTime: '2026-11-01T09:00:00Z', appointmentStatus: null },
      { id: 'a2', patientId: 'p1', startTime: '2026-11-04T09:00:00Z', appointmentStatus: 'completed', completionNotes: 'A kiválasztott alkalom leírása', appointmentType: 'munkafazis' },
    ];
    rerender(<AppointmentBookingSection patientId="p1" openStatusAppointmentId="a2" onStatusOpened={handled} standalone />);
    expect(screen.getByDisplayValue('A kiválasztott alkalom leírása')).toBeInTheDocument();
    expect(handled).toHaveBeenCalledOnce();
    expect(state.updateStatus).not.toHaveBeenCalled();
  });

  it('keeps view-only access from opening an edit form', () => {
    state.appointments = [{ id: 'a1', patientId: 'p1', startTime: '2026-11-04T09:00:00Z', appointmentStatus: null }];
    const handled = vi.fn();
    render(<AppointmentBookingSection patientId="p1" isViewOnly openStatusAppointmentId="a1" onStatusOpened={handled} standalone />);
    expect(handled).not.toHaveBeenCalled();
    expect(state.updateStatus).not.toHaveBeenCalled();
  });
});

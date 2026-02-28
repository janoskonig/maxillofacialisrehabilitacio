'use client';

import { useState, useEffect } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { toLocalISOString } from '@/lib/dateUtils';

export type AppointmentType = 'elso_konzultacio' | 'munkafazis' | 'kontroll';
export type AppointmentStatus = 'cancelled_by_doctor' | 'cancelled_by_patient' | 'completed' | 'no_show';
export type Pool = 'consult' | 'work' | 'control';

export interface TimeSlot {
  id: string;
  startTime: string;
  status: 'available' | 'booked';
  cim?: string | null;
  teremszam?: string | null;
  userEmail?: string;
  dentistName?: string | null;
}

export interface Appointment {
  id: string;
  patientId: string;
  episodeId?: string | null;
  timeSlotId: string;
  startTime: string;
  dentistEmail: string | null;
  cim?: string | null;
  teremszam?: string | null;
  appointmentStatus?: AppointmentStatus | null;
  completionNotes?: string | null;
  isLate?: boolean;
  appointmentType?: AppointmentType | null;
  stepCode?: string | null;
  stepLabel?: string | null;
  pool?: Pool | null;
  createdVia?: string | null;
  createdAt?: string;
  approvedAt?: string | null;
  createdBy?: string;
  timeSlotSource?: 'manual' | 'google_calendar' | null;
}

export interface BookAppointmentParams {
  patientId: string;
  timeSlotId: string;
  episodeId?: string | null;
  pool?: Pool | null;
  cim?: string | null;
  teremszam?: string | null;
  appointmentType?: AppointmentType | null;
  createdVia?: string;
}

export interface CreateAndBookSlotParams {
  patientId: string;
  startTime: Date;
  cim?: string | null;
  teremszam?: string | null;
  appointmentType?: AppointmentType | null;
  createdVia?: string;
}

export interface ModifyAppointmentParams {
  startTime: Date;
  teremszam?: string | null;
  appointmentType?: AppointmentType | null;
}

export interface UpdateStatusParams {
  appointmentStatus: AppointmentStatus | null;
  completionNotes?: string | null;
  isLate?: boolean;
  appointmentType?: AppointmentType | null;
}

export interface OperationResult {
  success: boolean;
  error?: string;
}

const AVAILABLE_CIMS = ['1088 Budapest, Szentkirályi utca 47'];
const DEFAULT_CIM = AVAILABLE_CIMS[0];

export interface UseAppointmentBookingReturn {
  availableSlots: TimeSlot[];
  appointments: Appointment[];
  loading: boolean;
  userRole: string;
  roleLoaded: boolean;
  availableCims: string[];
  DEFAULT_CIM: string;
  refreshData: () => Promise<void>;
  bookAppointment: (params: BookAppointmentParams) => Promise<OperationResult>;
  cancelAppointment: (appointmentId: string) => Promise<OperationResult>;
  modifyAppointment: (appointmentId: string, params: ModifyAppointmentParams) => Promise<OperationResult>;
  updateAppointmentStatus: (appointmentId: string, params: UpdateStatusParams) => Promise<OperationResult>;
  createAndBookSlot: (params: CreateAndBookSlotParams) => Promise<OperationResult>;
  downloadCalendar: (appointmentId: string) => Promise<OperationResult>;
}

export function useAppointmentBooking(patientId: string | null | undefined): UseAppointmentBookingReturn {
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>('');
  const [roleLoaded, setRoleLoaded] = useState(false);

  const loadAvailableSlots = async () => {
    try {
      let allSlots: TimeSlot[] = [];
      let page = 1;
      let hasMore = true;
      const limit = 100;
      const maxPages = 100;

      while (hasMore && page <= maxPages) {
        const response = await fetch(`/api/time-slots?page=${page}&limit=${limit}`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          const slots = data.timeSlots || [];
          allSlots = [...allSlots, ...slots];

          const pagination = data.pagination;
          if (pagination && page >= pagination.totalPages) {
            hasMore = false;
          } else if (slots.length < limit) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          hasMore = false;
        }
      }

      // Only show future slots (with a 4-hour grace period for recently passed ones)
      const now = new Date();
      const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
      const futureSlots = allSlots.filter((slot: TimeSlot) =>
        new Date(slot.startTime) >= fourHoursAgo
      );
      setAvailableSlots(futureSlots);
    } catch (error) {
      console.error('Error loading time slots:', error);
    }
  };

  const loadAppointments = async () => {
    if (!patientId) return;

    try {
      const response = await fetch(`/api/appointments?patientId=${patientId}`, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setAppointments(data.appointments || []);
      } else {
        console.error('Failed to load appointments');
        setAppointments([]);
      }
    } catch (error) {
      console.error('Error loading appointments:', error);
      setAppointments([]);
    }
  };

  const refreshData = async () => {
    setLoading(true);
    try {
      await Promise.all([loadAvailableSlots(), loadAppointments()]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialize = async () => {
      setLoading(true);

      const user = await getCurrentUser();
      if (user) {
        setUserRole(user.role);
      }
      setRoleLoaded(true);

      await loadAvailableSlots();

      if (patientId) {
        await loadAppointments();
      }

      setLoading(false);
    };

    initialize();
  }, [patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadAll = () => Promise.all([loadAvailableSlots(), loadAppointments()]);

  const bookAppointment = async (params: BookAppointmentParams): Promise<OperationResult> => {
    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          patientId: params.patientId,
          timeSlotId: params.timeSlotId,
          episodeId: params.episodeId ?? null,
          pool: params.pool ?? null,
          cim: params.cim || (AVAILABLE_CIMS.length === 1 ? DEFAULT_CIM : null),
          teremszam: params.teremszam || null,
          appointmentType: params.appointmentType || null,
          createdVia: params.createdVia || 'patient_form',
        }),
      });

      if (response.ok) {
        await reloadAll();
        return { success: true };
      }

      const data = await response.json();
      return { success: false, error: data.error || 'Hiba történt az időpont foglalásakor' };
    } catch (error) {
      console.error('Error booking appointment:', error);
      return { success: false, error: 'Hiba történt az időpont foglalásakor' };
    }
  };

  const cancelAppointment = async (appointmentId: string): Promise<OperationResult> => {
    try {
      const response = await fetch(`/api/appointments/${appointmentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        await reloadAll();
        return { success: true };
      }

      const data = await response.json();
      return { success: false, error: data.error || 'Hiba történt az időpont lemondásakor' };
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      return { success: false, error: 'Hiba történt az időpont lemondásakor' };
    }
  };

  const modifyAppointment = async (appointmentId: string, params: ModifyAppointmentParams): Promise<OperationResult> => {
    try {
      const isoDateTime = toLocalISOString(params.startTime);

      const response = await fetch(`/api/appointments/${appointmentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          startTime: isoDateTime,
          teremszam: params.teremszam || null,
          appointmentType: params.appointmentType || null,
        }),
      });

      if (response.ok) {
        await reloadAll();
        return { success: true };
      }

      const data = await response.json();
      return { success: false, error: data.error || 'Hiba történt az időpont módosításakor' };
    } catch (error) {
      console.error('Error modifying appointment:', error);
      return { success: false, error: 'Hiba történt az időpont módosításakor' };
    }
  };

  const updateAppointmentStatus = async (appointmentId: string, params: UpdateStatusParams): Promise<OperationResult> => {
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          appointmentStatus: params.appointmentStatus,
          completionNotes: params.appointmentStatus === 'completed' ? params.completionNotes : null,
          isLate: params.isLate,
          appointmentType: params.appointmentType,
        }),
      });

      if (response.ok) {
        await reloadAll();
        return { success: true };
      }

      const data = await response.json();
      return { success: false, error: data.error || 'Hiba történt az időpont státuszának frissítésekor' };
    } catch (error) {
      console.error('Error updating appointment status:', error);
      return { success: false, error: 'Hiba történt az időpont státuszának frissítésekor' };
    }
  };

  const createAndBookSlot = async (params: CreateAndBookSlotParams): Promise<OperationResult> => {
    try {
      const isoDateTime = toLocalISOString(params.startTime);

      const createSlotResponse = await fetch('/api/time-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          startTime: isoDateTime,
          cim: params.cim || DEFAULT_CIM,
          teremszam: params.teremszam || null,
        }),
      });

      if (!createSlotResponse.ok) {
        const errorData = await createSlotResponse.json();
        return { success: false, error: errorData.error || 'Hiba történt az időpont létrehozásakor' };
      }

      const slotData = await createSlotResponse.json();
      const newTimeSlotId = slotData.timeSlot.id;

      const bookResponse = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          patientId: params.patientId,
          timeSlotId: newTimeSlotId,
          cim: params.cim || DEFAULT_CIM,
          teremszam: params.teremszam || null,
          appointmentType: params.appointmentType || null,
          createdVia: params.createdVia || 'patient_form',
        }),
      });

      if (bookResponse.ok) {
        await reloadAll();
        return { success: true };
      }

      const errorData = await bookResponse.json();
      return { success: false, error: errorData.error || 'Hiba történt az időpont foglalásakor' };
    } catch (error) {
      console.error('Error creating and booking new slot:', error);
      return { success: false, error: 'Hiba történt az időpont létrehozásakor vagy foglalásakor' };
    }
  };

  const downloadCalendar = async (appointmentId: string): Promise<OperationResult> => {
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/calendar.ics`, {
        credentials: 'include',
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `appointment-${appointmentId}.ics`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        return { success: true };
      }

      return { success: false, error: 'Hiba történt a naptár fájl letöltésekor' };
    } catch (error) {
      console.error('Error downloading calendar:', error);
      return { success: false, error: 'Hiba történt a naptár fájl letöltésekor' };
    }
  };

  return {
    availableSlots,
    appointments,
    loading,
    userRole,
    roleLoaded,
    availableCims: AVAILABLE_CIMS,
    DEFAULT_CIM,
    refreshData,
    bookAppointment,
    cancelAppointment,
    modifyAppointment,
    updateAppointmentStatus,
    createAndBookSlot,
    downloadCalendar,
  };
}

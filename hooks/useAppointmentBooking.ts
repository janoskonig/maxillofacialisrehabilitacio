'use client';

import { useState, useEffect } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { toLocalISOString } from '@/lib/dateUtils';

export type AppointmentType = 'elso_konzultacio' | 'munkafazis' | 'kontroll';
export type AppointmentStatus =
  | 'cancelled_by_doctor'
  | 'cancelled_by_patient'
  | 'completed'
  | 'no_show'
  | 'unsuccessful';
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
  stepSeq?: number | null;
  stepLabel?: string | null;
  /**
   * Canonical episode_work_phases.id link — populated by booking writes
   * since migration 025. Hiányzik régebbi sorokon (NULL), és csak akkor
   * frissítjük, ha a sor opt-in lett a kanonikus index-be.
   */
  workPhaseId?: string | null;
  attemptNumber?: number;
  attemptFailedReason?: string | null;
  attemptFailedAt?: string | null;
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
  pool?: Pool | null;
  episodeId?: string | null;
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
  /**
   * Backend-hibajelzés a slot/appointment betöltéskor (pl. 5xx, 53300,
   * hálózati hiba). Üres slot-listával együtt nézve a UI így meg tudja
   * különböztetni: „valóban nincs szabad időpont" vs „nem sikerült
   * betölteni — próbáld újra".
   */
  loadError: string | null;
  /** Manuális retry trigger a UI-ból (pl. „Újra" gomb a hibasávban). */
  retryLoad: () => Promise<void>;
  userRole: string;
  roleLoaded: boolean;
  availableCims: string[];
  DEFAULT_CIM: string;
  refreshData: () => Promise<void>;
  bookAppointment: (params: BookAppointmentParams) => Promise<OperationResult>;
  cancelAppointment: (appointmentId: string) => Promise<OperationResult>;
  modifyAppointment: (appointmentId: string, params: ModifyAppointmentParams) => Promise<OperationResult>;
  updateAppointmentStatus: (appointmentId: string, params: UpdateStatusParams) => Promise<OperationResult>;
  markUnsuccessful: (appointmentId: string, reason: string) => Promise<OperationResult>;
  revertUnsuccessful: (appointmentId: string, reason: string) => Promise<OperationResult>;
  createAndBookSlot: (params: CreateAndBookSlotParams) => Promise<OperationResult>;
  downloadCalendar: (appointmentId: string) => Promise<OperationResult>;
}

export function useAppointmentBooking(patientId: string | null | undefined): UseAppointmentBookingReturn {
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [roleLoaded, setRoleLoaded] = useState(false);

  const loadAvailableSlots = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      // Backend-szintű szűrés: csak az `available` státuszú, „most-4 óra"
      // óta kezdődő slotok jönnek. Korábban a hook akár 100 oldalat
      // (10 000 slot) húzott le sorba, és kliens-oldalon szűrt — ezt
      // helyettesíti a backend `from` + `onlyAvailable` paramétere.
      const fourHoursAgoISO = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const baseQuery = new URLSearchParams({
        onlyAvailable: 'true',
        from: fourHoursAgoISO,
        limit: '500',
      });

      let allSlots: TimeSlot[] = [];
      let page = 1;
      let hasMore = true;
      // Még backend-szűréssel is plafon: szabad-slot lista 5 × 500 = 2500
      // sornál ne menjen tovább, ennyi felett már UX-szempontból amúgy
      // nem listázható választ.
      const maxPages = 5;
      let firstError: string | null = null;

      while (hasMore && page <= maxPages) {
        const params = new URLSearchParams(baseQuery);
        params.set('page', String(page));
        const response = await fetch(`/api/time-slots?${params.toString()}`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          const slots: TimeSlot[] = data.timeSlots || [];
          allSlots = [...allSlots, ...slots];

          const pagination = data.pagination;
          const limit = Number(pagination?.limit ?? 500);
          if (pagination && page >= pagination.totalPages) {
            hasMore = false;
          } else if (slots.length < limit) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          // Megkülönböztetjük az „üres állapot" (200 + üres tömb) és a
          // szerverhiba (5xx / 401 / hálózati) eseteket — a hívó fél
          // ennek tudatában tud értelmes UI-t mutatni.
          if (firstError === null) {
            firstError =
              response.status === 401 || response.status === 403
                ? 'Nincs jogosultság az időpontok megjelenítéséhez.'
                : `Szerverhiba (${response.status}) az időpontok betöltésekor.`;
          }
          hasMore = false;
        }
      }

      setAvailableSlots(allSlots);
      if (firstError) {
        return { ok: false, error: firstError };
      }
      return { ok: true };
    } catch (error) {
      console.error('Error loading time slots:', error);
      return { ok: false, error: 'Hálózati hiba az időpontok betöltésekor.' };
    }
  };

  const loadAppointments = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!patientId) return { ok: true };

    try {
      const response = await fetch(`/api/appointments?patientId=${patientId}`, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setAppointments(data.appointments || []);
        return { ok: true };
      }
      console.error('Failed to load appointments', response.status);
      return {
        ok: false,
        error:
          response.status === 401 || response.status === 403
            ? 'Nincs jogosultság a foglalások megjelenítéséhez.'
            : `Szerverhiba (${response.status}) a foglalások betöltésekor.`,
      };
    } catch (error) {
      console.error('Error loading appointments:', error);
      return { ok: false, error: 'Hálózati hiba a foglalások betöltésekor.' };
    }
  };

  const refreshData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [slotsRes, apptsRes] = await Promise.all([
        loadAvailableSlots(),
        loadAppointments(),
      ]);
      const firstError = slotsRes.error ?? apptsRes.error ?? null;
      setLoadError(firstError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialize = async () => {
      setLoading(true);
      setLoadError(null);

      const user = await getCurrentUser();
      if (user) {
        setUserRole(user.role);
      }
      setRoleLoaded(true);

      const slotsRes = await loadAvailableSlots();

      let apptsRes: { ok: boolean; error?: string } = { ok: true };
      if (patientId) {
        apptsRes = await loadAppointments();
      }

      const firstError = slotsRes.error ?? apptsRes.error ?? null;
      setLoadError(firstError);
      setLoading(false);
    };

    initialize();
  }, [patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadAll = async () => {
    const [slotsRes, apptsRes] = await Promise.all([
      loadAvailableSlots(),
      loadAppointments(),
    ]);
    const firstError = slotsRes.error ?? apptsRes.error ?? null;
    setLoadError(firstError);
  };

  const retryLoad = async () => {
    await refreshData();
  };

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
          pool: params.pool ?? 'consult',
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

  const markUnsuccessful = async (
    appointmentId: string,
    reason: string
  ): Promise<OperationResult> => {
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/attempt-outcome`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'mark_unsuccessful', reason }),
      });

      if (response.ok) {
        await reloadAll();
        return { success: true };
      }

      const data = await response.json();
      return {
        success: false,
        error: data.error || 'A sikertelen-jelölés nem sikerült',
      };
    } catch (error) {
      console.error('Error marking appointment unsuccessful:', error);
      return { success: false, error: 'A sikertelen-jelölés nem sikerült' };
    }
  };

  const revertUnsuccessful = async (
    appointmentId: string,
    reason: string
  ): Promise<OperationResult> => {
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/attempt-outcome`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'revert', reason }),
      });

      if (response.ok) {
        await reloadAll();
        return { success: true };
      }

      const data = await response.json();
      return {
        success: false,
        error: data.error || 'A visszavonás nem sikerült',
      };
    } catch (error) {
      console.error('Error reverting unsuccessful appointment:', error);
      return { success: false, error: 'A visszavonás nem sikerült' };
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
          pool: params.pool ?? 'consult',
          episodeId: params.episodeId ?? null,
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
    loadError,
    retryLoad,
    userRole,
    roleLoaded,
    availableCims: AVAILABLE_CIMS,
    DEFAULT_CIM,
    refreshData,
    bookAppointment,
    cancelAppointment,
    modifyAppointment,
    updateAppointmentStatus,
    markUnsuccessful,
    revertUnsuccessful,
    createAndBookSlot,
    downloadCalendar,
  };
}

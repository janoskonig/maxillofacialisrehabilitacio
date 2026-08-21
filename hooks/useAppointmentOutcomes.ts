'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { extractApiError, formatApiError } from '@/lib/extract-api-error';

// A „mai időpontok" sor kimenetel-kezelésének teljes állapota + összes handler.
// Korábban a TodaysAppointmentsWidget-be ágyazva élt; innen használja a dedikált
// Mai időpontok oldal (AppointmentOutcomeList) — egyetlen forrásból. A fetch/PATCH
// hívások változatlanok: /api/appointments/:id/status és /attempt-outcome.

export interface OutcomeAppointment {
  id: string;
  patientId: string;
  startTime: string;
  patientName: string | null;
  patientTaj: string | null;
  cim: string | null;
  teremszam: string | null;
  appointmentStatus?: string | null;
  completionNotes?: string | null;
  isLate?: boolean | null;
  dentistEmail?: string | null;
  dentistName?: string | null;
  appointmentType?: string | null;
  typeLabel?: string | null;
  episodeId?: string | null;
  stepCode?: string | null;
  workPhaseId?: string | null;
  attemptNumber?: number | null;
  stepLabel?: string | null;
  rebookNeeded?: boolean | null;
  isDeliveryStep?: boolean;
  currentStageCode?: string | null;
  currentStageLabel?: string | null;
  stageOptions?: Array<{ code: string; labelHu: string; orderIndex: number }>;
}

export interface StatusForm {
  appointmentStatus: 'cancelled_by_doctor' | 'cancelled_by_patient' | 'completed' | 'no_show' | null;
  completionNotes: string;
  isLate: boolean;
  appointmentType: string;
  typeLabel: string;
  clinicalEvent: '' | 'delivery';
  stageCode: string;
}

const EMPTY_FORM: StatusForm = {
  appointmentStatus: null,
  completionNotes: '',
  isLate: false,
  appointmentType: '',
  typeLabel: '',
  clinicalEvent: '',
  stageCode: '',
};

export function useAppointmentOutcomes(initial: OutcomeAppointment[], onUpdate?: () => void) {
  const router = useRouter();
  const [appointments, setAppointments] = useState<OutcomeAppointment[]>(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryReason, setRetryReason] = useState('');
  const [retrySaving, setRetrySaving] = useState(false);
  const [statusForm, setStatusForm] = useState<StatusForm>(EMPTY_FORM);
  const [stageNotices, setStageNotices] = useState<Record<string, string>>({});

  useEffect(() => {
    setAppointments(initial);
  }, [initial]);

  const openPatient = useCallback((patientId: string | null | undefined, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (patientId) router.push(`/patients/${patientId}/view`);
  }, [router]);

  // Deep-link into the patient booking flow for a reopened step.
  const rebook = useCallback((appointment: OutcomeAppointment, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!appointment.patientId) return;
    const params = new URLSearchParams();
    if (appointment.episodeId) params.set('rebookEpisode', appointment.episodeId);
    if (appointment.stepCode) params.set('rebookStep', appointment.stepCode);
    const qs = params.toString();
    router.push(`/patients/${appointment.patientId}/view${qs ? `?${qs}` : ''}`);
  }, [router]);

  const startEdit = useCallback((appointment: OutcomeAppointment) => {
    setEditingId(appointment.id);
    setRetryingId(null);
    const valid = ['cancelled_by_doctor', 'cancelled_by_patient', 'completed', 'no_show'] as const;
    const status = appointment.appointmentStatus && valid.includes(appointment.appointmentStatus as any)
      ? (appointment.appointmentStatus as StatusForm['appointmentStatus'])
      : null;
    setStatusForm({
      appointmentStatus: status,
      completionNotes: appointment.completionNotes || '',
      isLate: appointment.isLate || false,
      appointmentType: appointment.appointmentType || '',
      typeLabel: appointment.typeLabel || '',
      clinicalEvent: appointment.isDeliveryStep ? 'delivery' : '',
      stageCode: '',
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setStatusForm(EMPTY_FORM);
  }, []);

  const saveStatus = useCallback(async (appointmentId: string) => {
    if (statusForm.appointmentStatus === 'completed' && !statusForm.completionNotes.trim()) {
      alert('A "mi történt?" mező kitöltése kötelező sikeresen teljesült időpont esetén.');
      return;
    }
    const editedAppointment = appointments.find((appointment) => appointment.id === appointmentId);
    if (
      statusForm.appointmentStatus === 'completed' &&
      (statusForm.clinicalEvent || statusForm.stageCode) &&
      !editedAppointment?.episodeId
    ) {
      alert('Ehhez az időponthoz nincs aktív ellátási epizód, ezért innen nem váltható stádium.');
      return;
    }

    if (statusForm.stageCode && editedAppointment?.stageOptions?.length) {
      const current = editedAppointment.stageOptions.find(
        (option) => option.code === editedAppointment.currentStageCode,
      );
      const target = editedAppointment.stageOptions.find((option) => option.code === statusForm.stageCode);
      if (
        current &&
        target &&
        target.orderIndex < current.orderIndex &&
        !window.confirm(
          `Biztosan visszaállítja a stádiumot „${target.labelHu}” állapotra? A jelenlegi stádium: „${current.labelHu}”.`,
        )
      ) {
        return;
      }
    }
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          appointmentStatus: statusForm.appointmentStatus,
          completionNotes: statusForm.appointmentStatus === 'completed' ? statusForm.completionNotes : null,
          isLate: statusForm.isLate,
          appointmentType: statusForm.appointmentType || null,
          typeLabel: statusForm.typeLabel,
          clinicalEvent: statusForm.clinicalEvent || null,
          stageCode: statusForm.stageCode || null,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const stageTransition = data.stageTransition as
          | { changed?: boolean; stageCode?: string | null; stageLabel?: string | null; message?: string | null }
          | null
          | undefined;
        setAppointments((prev) => prev.map((apt) =>
          apt.id === appointmentId || (stageTransition?.changed && apt.episodeId === editedAppointment?.episodeId)
            ? {
                ...apt,
                ...(apt.id === appointmentId
                  ? {
                      appointmentStatus: data.appointment.appointmentStatus,
                      completionNotes: data.appointment.completionNotes,
                      isLate: data.appointment.isLate || false,
                      appointmentType: data.appointment.appointmentType ?? apt.appointmentType,
                      typeLabel: data.appointment.typeLabel ?? statusForm.typeLabel ?? apt.typeLabel,
                    }
                  : {}),
                ...(stageTransition?.changed
                  ? {
                      currentStageCode: stageTransition.stageCode ?? apt.currentStageCode,
                      currentStageLabel: stageTransition.stageLabel ?? apt.currentStageLabel,
                    }
                  : {}),
              }
            : apt,
        ));
        if (stageTransition?.message) {
          setStageNotices((prev) => ({ ...prev, [appointmentId]: stageTransition.message! }));
        } else {
          setStageNotices((prev) => {
            const next = { ...prev };
            delete next[appointmentId];
            return next;
          });
        }
        setEditingId(null);
        setStatusForm(EMPTY_FORM);
        onUpdate?.();
      } else {
        alert(formatApiError(await extractApiError(response, 'Hiba történt az időpont státuszának frissítésekor')));
      }
    } catch (error) {
      console.error('Error updating appointment status:', error);
      alert('Hiba történt az időpont státuszának frissítésekor');
    }
  }, [appointments, statusForm, onUpdate]);

  const quickStatus = useCallback(async (appointmentId: string, status: 'completed' | 'no_show') => {
    // 'completed' requires notes → open the edit form with status pre-selected.
    if (status === 'completed') {
      const appointment = appointments.find((a) => a.id === appointmentId);
      if (appointment) {
        startEdit(appointment);
        setStatusForm((prev) => ({ ...prev, appointmentStatus: 'completed', completionNotes: '' }));
      }
      return;
    }
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ appointmentStatus: status, completionNotes: null, isLate: false }),
      });
      if (response.ok) {
        const data = await response.json();
        setAppointments((prev) => prev.map((apt) =>
          apt.id === appointmentId
            ? {
                ...apt,
                appointmentStatus: data.appointment.appointmentStatus,
                completionNotes: data.appointment.completionNotes,
                isLate: data.appointment.isLate || false,
                rebookNeeded: !!(apt.episodeId && apt.stepCode) || apt.rebookNeeded,
              }
            : apt,
        ));
        onUpdate?.();
      } else {
        alert(formatApiError(await extractApiError(response, 'Hiba történt az időpont státuszának frissítésekor')));
      }
    } catch (error) {
      console.error('Error updating appointment status:', error);
      alert('Hiba történt az időpont státuszának frissítésekor');
    }
  }, [appointments, onUpdate, startEdit]);

  const startRetry = useCallback((appointment: OutcomeAppointment) => {
    setRetryingId(appointment.id);
    setEditingId(null);
    setRetryReason('');
  }, []);

  const cancelRetry = useCallback(() => {
    setRetryingId(null);
    setRetryReason('');
  }, []);

  const saveRetry = useCallback(async (appointmentId: string) => {
    const reason = retryReason.trim();
    if (reason.length < 5) {
      alert('Az indok megadása kötelező (legalább 5 karakter).');
      return;
    }
    setRetrySaving(true);
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/attempt-outcome`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'mark_unsuccessful', reason }),
      });
      if (response.ok) {
        setAppointments((prev) => prev.map((apt) =>
          apt.id === appointmentId ? { ...apt, appointmentStatus: 'unsuccessful', rebookNeeded: true } : apt,
        ));
        setRetryingId(null);
        setRetryReason('');
        onUpdate?.();
      } else {
        alert(formatApiError(await extractApiError(response, 'Hiba történt a sikertelen-jelöléskor')));
      }
    } catch (error) {
      console.error('Error marking appointment unsuccessful:', error);
      alert('Hiba történt a sikertelen-jelöléskor');
    } finally {
      setRetrySaving(false);
    }
  }, [retryReason, onUpdate]);

  return {
    appointments,
    editingId,
    retryingId,
    retryReason,
    setRetryReason,
    retrySaving,
    statusForm,
    setStatusForm,
    stageNotices,
    openPatient,
    rebook,
    startEdit,
    cancelEdit,
    saveStatus,
    quickStatus,
    startRetry,
    cancelRetry,
    saveRetry,
  };
}

export type AppointmentOutcomesController = ReturnType<typeof useAppointmentOutcomes>;

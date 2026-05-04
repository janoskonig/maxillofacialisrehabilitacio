'use client';

import { useState } from 'react';
import {
  Calendar,
  Clock,
  Download,
  CheckCircle2,
  Plus,
  X,
  XCircle,
  AlertCircle,
  Clock as ClockIcon,
  Edit2,
  Shuffle,
  Undo2,
  AlertTriangle,
} from 'lucide-react';
import { formatDateTime, digitsOnly } from '@/lib/dateUtils';
import { DateTimePicker } from './DateTimePicker';
import { Patient } from '@/lib/types';
import {
  useAppointmentBooking,
  type Appointment,
  type AppointmentType,
  type AppointmentStatus,
} from '@/hooks/useAppointmentBooking';
import { CascadeIntentsModal, type SlotIntentForCascade } from './CascadeIntentsModal';
import {
  ReassignStepModal,
  type ReassignStepCandidate,
  type ReassignStepPayload,
} from './ReassignStepModal';
import {
  UnsuccessfulAttemptModal,
  type UnsuccessfulAttemptConfirmPayload,
} from './UnsuccessfulAttemptModal';
import { RevertUnsuccessfulModal } from './RevertUnsuccessfulModal';
import type { WorklistItemBackend } from '@/lib/worklist-types';

interface AppointmentBookingSectionProps {
  patientId: string | null | undefined;
  episodeId?: string | null;
  pool?: 'consult' | 'work' | 'control';
  isViewOnly?: boolean;
  onSavePatientBeforeBooking?: () => Promise<Patient>;
  isPatientDirty?: boolean;
  isNewPatient?: boolean;
  onPatientSaved?: (savedPatient: Patient) => void;
}

export function AppointmentBookingSection({ 
  patientId, 
  episodeId,
  pool = 'consult',
  isViewOnly = false,
  onSavePatientBeforeBooking,
  isPatientDirty = false,
  isNewPatient = false,
  onPatientSaved
}: AppointmentBookingSectionProps) {
  const {
    availableSlots,
    appointments,
    loading,
    userRole,
    roleLoaded,
    availableCims,
    DEFAULT_CIM,
    bookAppointment,
    cancelAppointment,
    modifyAppointment,
    updateAppointmentStatus,
    markUnsuccessful,
    revertUnsuccessful,
    createAndBookSlot,
    downloadCalendar,
    refreshData,
  } = useAppointmentBooking(patientId);

  // UI form state
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [showNewSlotForm, setShowNewSlotForm] = useState(false);
  const [newSlotDateTime, setNewSlotDateTime] = useState<Date | null>(null);
  const [newSlotTeremszam, setNewSlotTeremszam] = useState<string>('');
  const [newSlotCim, setNewSlotCim] = useState<string>('');
  const [newSlotAppointmentType, setNewSlotAppointmentType] = useState<AppointmentType | null>(null);
  const [customCim, setCustomCim] = useState<string>('');
  const [customTeremszam, setCustomTeremszam] = useState<string>('');
  const [selectedAppointmentType, setSelectedAppointmentType] = useState<AppointmentType | null>(null);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [newModifyDateTime, setNewModifyDateTime] = useState<Date | null>(null);
  const [newModifyTeremszam, setNewModifyTeremszam] = useState<string>('');
  const [newModifyAppointmentType, setNewModifyAppointmentType] = useState<AppointmentType | null>(null);
  const [editingStatus, setEditingStatus] = useState<Appointment | null>(null);
  const [cascadeAfterModify, setCascadeAfterModify] = useState<{
    episodeId: string;
    deltaMs: number;
    intents: SlotIntentForCascade[];
  } | null>(null);
  const [statusForm, setStatusForm] = useState<{
    appointmentStatus: AppointmentStatus | null;
    completionNotes: string;
    isLate: boolean;
    appointmentType: AppointmentType | null;
  }>({
    appointmentStatus: null,
    completionNotes: '',
    isLate: false,
    appointmentType: null,
  });
  /**
   * „Másik fázisra" modal kontextus — egy meglévő foglalás snapshot-ának
   * (step_code / step_seq / work_phase_id + episode_work_phases.appointment_id
   * link) átkötése egy másik EWP-re. Múltbeli appointmentekre is működik:
   * ilyenkor a fázis tényállapota nem változik, csak a hivatkozás frissül.
   */
  const [reassignCtx, setReassignCtx] = useState<{
    appointment: Appointment;
    sourceItem: WorklistItemBackend;
    candidates: ReassignStepCandidate[];
  } | null>(null);
  const [reassignLoading, setReassignLoading] = useState<string | null>(null);
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [unsuccessfulModalAppointment, setUnsuccessfulModalAppointment] =
    useState<Appointment | null>(null);
  const [revertModalAppointment, setRevertModalAppointment] =
    useState<Appointment | null>(null);

  const resolvePatientId = async (actionLabel = 'foglalása'): Promise<string | null> => {
    let currentPatientId = patientId;
    if ((isNewPatient || isPatientDirty) && onSavePatientBeforeBooking) {
      try {
        const savedPatient = await onSavePatientBeforeBooking();
        currentPatientId = savedPatient.id;
        if (onPatientSaved) {
          onPatientSaved(savedPatient);
        }
      } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : 'Hiba történt a beteg mentésekor';
        alert(`Hiba a beteg mentésekor: ${errorMessage}. Az időpont ${actionLabel} megszakadt.`);
        return null;
      }
    }
    if (!currentPatientId) {
      alert('Hiba: A beteg ID nem elérhető. Kérjük, mentse el először a beteg adatait.');
      return null;
    }
    return currentPatientId;
  };

  const handleBookAppointment = async () => {
    if (!selectedSlot) {
      alert('Kérjük, válasszon időpontot!');
      return;
    }

    const resolvedPatientId = await resolvePatientId();
    if (!resolvedPatientId) return;

    if (!confirm('Biztosan le szeretné foglalni ezt az időpontot?')) return;

    const effectivePool = pool === 'work' && !episodeId ? 'consult' : (pool ?? (episodeId ? 'work' : 'consult'));
    const result = await bookAppointment({
      patientId: resolvedPatientId,
      timeSlotId: selectedSlot,
      episodeId: episodeId ?? null,
      pool: effectivePool,
      cim: customCim || (availableCims.length === 1 ? DEFAULT_CIM : null),
      teremszam: customTeremszam.trim() || null,
      appointmentType: selectedAppointmentType || null,
    });

    if (result.success) {
      setSelectedSlot('');
      setCustomCim('');
      setCustomTeremszam('');
      setSelectedAppointmentType(null);
      alert('Időpont sikeresen lefoglalva! A fogpótlástanász értesítést kapott.');
    } else {
      alert(result.error || 'Hiba történt az időpont foglalásakor');
    }
  };

  const handleDownloadCalendar = async (appointmentId: string) => {
    const result = await downloadCalendar(appointmentId);
    if (!result.success) {
      alert(result.error || 'Hiba történt a naptár fájl letöltésekor');
    }
  };

  const handleCancelAppointment = async (appointmentId: string) => {
    if (!confirm('Biztosan le szeretné mondani ezt az időpontot?')) return;

    const result = await cancelAppointment(appointmentId);
    if (result.success) {
      alert('Időpont sikeresen lemondva!');
    } else {
      alert(result.error || 'Hiba történt az időpont lemondásakor');
    }
  };

  const handleModifyAppointment = (appointment: Appointment) => {
    setEditingAppointment(appointment);
    setNewModifyDateTime(null);
    setNewModifyTeremszam('');
    setNewModifyAppointmentType(appointment.appointmentType || null);
  };

  const handleSaveModification = async () => {
    if (!editingAppointment || !newModifyDateTime) {
      alert('Kérjük, válasszon dátumot és időt!');
      return;
    }

    if (newModifyDateTime <= new Date()) {
      alert('Az időpont csak jövőbeli dátum lehet!');
      return;
    }

    if (!confirm('Biztosan módosítani szeretné ezt az időpontot? A fogpótlástanász és a beteg értesítést kap.')) return;

    const result = await modifyAppointment(editingAppointment.id, {
      startTime: newModifyDateTime,
      teremszam: newModifyTeremszam.trim() || null,
      appointmentType: newModifyAppointmentType || null,
    });

    if (result.success) {
      const episodeId = editingAppointment.episodeId ?? null;
      const stepSeq = editingAppointment.stepSeq ?? -1;
      const oldStart = new Date(editingAppointment.startTime);
      const deltaMs = newModifyDateTime.getTime() - oldStart.getTime();

      setEditingAppointment(null);
      setNewModifyDateTime(null);
      setNewModifyTeremszam('');
      setNewModifyAppointmentType(null);
      alert('Időpont sikeresen módosítva! A fogpótlástanász és a beteg (ha van email-címe) értesítést kapott.');

      if (episodeId && deltaMs !== 0) {
        try {
          const r = await fetch(`/api/episodes/${episodeId}/slot-intents`, { credentials: 'include' });
          const data = await r.json();
          const all = (data.intents || []) as SlotIntentForCascade[];
          const subsequent = all.filter((i) => (i.stepSeq ?? -1) > stepSeq);
          if (subsequent.length > 0) {
            setCascadeAfterModify({ episodeId, deltaMs, intents: subsequent });
          }
        } catch {
          // non-blocking
        }
      }
    } else {
      alert(result.error || 'Hiba történt az időpont módosításakor');
    }
  };

  const handleCascadeConfirm = async (selectedIntentIds: string[]) => {
    if (!cascadeAfterModify || selectedIntentIds.length === 0) return;
    const { episodeId, deltaMs } = cascadeAfterModify;
    const sign = deltaMs >= 0 ? 1 : -1;
    const abs = Math.abs(deltaMs);
    const days = Math.floor(abs / (24 * 60 * 60 * 1000));
    let rest = abs % (24 * 60 * 60 * 1000);
    const hours = Math.floor(rest / (60 * 60 * 1000));
    rest %= 60 * 60 * 1000;
    const minutes = Math.round(rest / (60 * 1000));
    const res = await fetch(`/api/episodes/${episodeId}/cascade-intents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        delta: { days: sign * days, hours: sign * hours, minutes: sign * minutes },
        intentIds: selectedIntentIds,
      }),
    });
    if (res.ok) {
      await refreshData();
      alert(`Eltolva: ${selectedIntentIds.length} tervezett lépés.`);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err?.error || 'Hiba történt a tervezett lépések eltolásakor.');
    }
    setCascadeAfterModify(null);
  };

  const handleEditStatus = (appointment: Appointment) => {
    setEditingStatus(appointment);
    setStatusForm({
      appointmentStatus: appointment.appointmentStatus || null,
      completionNotes: appointment.completionNotes || '',
      isLate: appointment.isLate || false,
      appointmentType: appointment.appointmentType || null,
    });
  };

  /**
   * „Másik fázisra" modal megnyitása egy meglévő foglalásra. Lekérdezi az
   * epizód EWP-it (`/api/episodes/:id/step-projections`), és a múltbeli
   * appointmentekhez is felkínál minden olyan fázist, ami:
   *   - azonos pool-ban van (control / work / consult nem keveredhet),
   *   - nincs merged-into (csak primary sorok),
   *   - nem skipped (skipped fázis explicit „nem akarjuk megcsinálni"),
   *   - nem ugyanaz, mint a foglalás jelenlegi cél fázisa.
   *
   * Completed fázisok IS jelölhetők — a backend ilyenkor csak a snapshot
   * appointment_id-t frissíti, a fázis tényállapotát nem változtatja.
   */
  const handleOpenReassign = async (appointment: Appointment) => {
    if (!appointment.episodeId) {
      alert('Ehhez a foglaláshoz nincs epizód kötve, így nem rendelhető át fázishoz.');
      return;
    }
    setReassignLoading(appointment.id);
    setReassignError(null);
    try {
      const res = await fetch(
        `/api/episodes/${appointment.episodeId}/step-projections`,
        { credentials: 'include' }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? 'Nem sikerült lekérni a fázisokat.');
      }
      type ProjectedStep = {
        stepCode: string;
        label: string;
        seq: number;
        pool: string;
        status: string;
        windowStart: string | null;
        windowEnd: string | null;
        workPhaseId?: string | null;
      };
      const projected = (data.steps ?? []) as ProjectedStep[];
      const apptPool = appointment.pool ?? null;
      const candidates: ReassignStepCandidate[] = projected
        .filter(
          (s) =>
            !!s.workPhaseId &&
            (apptPool == null || s.pool === apptPool) &&
            s.status !== 'skipped' &&
            s.stepCode !== appointment.stepCode
        )
        .map((s) => ({
          workPhaseId: s.workPhaseId as string,
          stepCode: s.stepCode,
          stepLabel: s.label,
          pool: s.pool,
          windowStart: s.windowStart,
          windowEnd: s.windowEnd,
          stepSeq: s.seq ?? null,
          bookableWindowStart: null,
          bookableWindowEnd: null,
          status:
            s.status === 'completed' ||
            s.status === 'scheduled' ||
            s.status === 'pending' ||
            s.status === 'skipped'
              ? (s.status as 'completed' | 'scheduled' | 'pending' | 'skipped')
              : null,
        }));

      // Minimális WorklistItemBackend stub, hogy a meglévő ReassignStepModal
      // változtatás nélkül elfogadja a forrást — csak a UI által ténylegesen
      // olvasott mezők kellenek (pool, stepLabel, bookedAppointmentStartTime,
      // workPhaseId — utóbbi az „önmaga kizárására" a jelölt-listában).
      const sourceItem = {
        episodeId: appointment.episodeId,
        patientId: patientId ?? '',
        currentStage: '',
        nextStep: appointment.stepCode ?? '',
        stepLabel: appointment.stepLabel ?? appointment.stepCode ?? '',
        stepCode: appointment.stepCode ?? '',
        overdueByDays: 0,
        windowStart: null,
        windowEnd: null,
        durationMinutes: 0,
        pool: appointment.pool ?? 'work',
        priorityScore: 0,
        noShowRisk: 0,
        bookedAppointmentId: appointment.id,
        bookedAppointmentStartTime: appointment.startTime,
        workPhaseId: appointment.workPhaseId ?? null,
      } satisfies Partial<WorklistItemBackend> as WorklistItemBackend;

      setReassignCtx({ appointment, sourceItem, candidates });
    } catch (e) {
      setReassignError(e instanceof Error ? e.message : 'Hiba történt');
    } finally {
      setReassignLoading(null);
    }
  };

  const handleConfirmReassign = async (
    appointmentId: string,
    payload: ReassignStepPayload
  ) => {
    const res = await fetch(
      `/api/appointments/${appointmentId}/reassign-step`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          targetWorkPhaseId: payload.targetWorkPhaseId,
          reason: payload.reason,
        }),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error ?? 'Átrendezés sikertelen');
    }
    if (data?.cleanedStaleLink) {
      console.info(
        '[reassign-step] cél fázison stale appointment_id volt (appointment %s, status %s) — takarítva',
        data.staleLinkedAppointmentId ?? 'n/a',
        data.staleLinkedAppointmentStatus ?? 'n/a'
      );
    }
    await refreshData();
  };

  const handleSaveStatus = async () => {
    if (!editingStatus) return;

    if (statusForm.appointmentStatus === 'completed' && !statusForm.completionNotes.trim()) {
      alert('A "mi történt?" mező kitöltése kötelező sikeresen teljesült időpont esetén.');
      return;
    }

    const goesToCancelOrNoShow =
      statusForm.appointmentStatus === 'cancelled_by_doctor' ||
      statusForm.appointmentStatus === 'cancelled_by_patient' ||
      statusForm.appointmentStatus === 'no_show';

    if (
      editingStatus.appointmentStatus === 'completed' &&
      goesToCancelOrNoShow
    ) {
      const ok = confirm(
        'Az időpont korábban „sikeresen teljesült”-nek volt jelezve. ' +
          'Lemondásra vagy „nem jelent meg” státuszra állításkor a hozzá kötött munkafázis ' +
          '(ha van epizód kötés) visszaáll várakozóra (pending), és új időpont foglalható. Folytatod?'
      );
      if (!ok) return;
    }

    const result = await updateAppointmentStatus(editingStatus.id, {
      appointmentStatus: statusForm.appointmentStatus,
      completionNotes: statusForm.appointmentStatus === 'completed' ? statusForm.completionNotes : null,
      isLate: statusForm.isLate,
      appointmentType: statusForm.appointmentType,
    });

    if (result.success) {
      setEditingStatus(null);
      setStatusForm({
        appointmentStatus: null,
        completionNotes: '',
        isLate: false,
        appointmentType: null,
      });
      alert('Időpont státusza sikeresen frissítve!');
    } else {
      alert(result.error || 'Hiba történt az időpont státuszának frissítésekor');
    }
  };

  const handleCreateAndBookNewSlot = async () => {
    if (!newSlotDateTime) {
      alert('Kérjük, válasszon dátumot és időt!');
      return;
    }

    if (newSlotDateTime <= new Date()) {
      alert('Az időpont csak jövőbeli dátum lehet!');
      return;
    }

    const resolvedPatientId = await resolvePatientId('létrehozása');
    if (!resolvedPatientId) return;

    if (!confirm('Biztosan létre szeretné hozni ezt az időpontot és rögtön lefoglalni a betegnek?')) return;

    const effectivePool = pool === 'work' && !episodeId ? 'consult' : (pool ?? (episodeId ? 'work' : 'consult'));
    const result = await createAndBookSlot({
      patientId: resolvedPatientId,
      startTime: newSlotDateTime,
      pool: effectivePool,
      episodeId: episodeId ?? null,
      cim: newSlotCim || DEFAULT_CIM,
      teremszam: newSlotTeremszam.trim() || null,
      appointmentType: newSlotAppointmentType || null,
    });

    if (result.success) {
      setNewSlotDateTime(null);
      setNewSlotCim('');
      setNewSlotTeremszam('');
      setNewSlotAppointmentType(null);
      setShowNewSlotForm(false);
      alert('Új időpont sikeresen létrehozva és lefoglalva a betegnek!');
    } else {
      alert(result.error || 'Hiba történt az időpont létrehozásakor vagy foglalásakor');
    }
  };

  if (!roleLoaded) {
    return null;
  }
  
  if (userRole !== 'beutalo_orvos' && userRole !== 'admin' && userRole !== 'fogpótlástanász') {
    return null;
  }
  
  const availableSlotsOnly = availableSlots.filter(slot => slot.status === 'available');

  if (loading) {
    return (
      <div className="border-t pt-6 mt-6">
        <p className="text-gray-500 text-sm">Betöltés...</p>
      </div>
    );
  }

  return (
    <div className="border-t pt-6 mt-6">
      {/* Modification Modal */}
      {editingAppointment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">Időpont módosítása</h3>
              <button
                onClick={() => {
                  setEditingAppointment(null);
                  setNewModifyDateTime(null);
                  setNewModifyTeremszam('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Jelenlegi időpont:</strong> {formatDateTime(editingAppointment.startTime)}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Új dátum és idő megadása
                </label>
                <DateTimePicker
                  selected={newModifyDateTime}
                  onChange={(date: Date | null) => setNewModifyDateTime(date)}
                  minDate={new Date()}
                  placeholder="Válasszon dátumot és időt"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Teremszám (opcionális)
                </label>
                <input
                  type="text"
                  value={newModifyTeremszam}
                  onChange={(e) => setNewModifyTeremszam(digitsOnly(e.target.value))}
                  className="form-input w-full"
                  placeholder="Pl. 611"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Időpont típusa
                </label>
                <select
                  value={newModifyAppointmentType || ''}
                  onChange={(e) => setNewModifyAppointmentType(e.target.value as any || null)}
                  className="form-input w-full"
                >
                  <option value="">Nincs megadva</option>
                  <option value="elso_konzultacio">Első konzultáció</option>
                  <option value="munkafazis">Munkafázis</option>
                  <option value="kontroll">Kontroll</option>
                </select>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setEditingAppointment(null);
                    setNewModifyDateTime(null);
                    setNewModifyTeremszam('');
                    setNewModifyAppointmentType(null);
                  }}
                  className="btn-secondary"
                >
                  Mégse
                </button>
                <button
                  onClick={handleSaveModification}
                  disabled={!newModifyDateTime}
                  className="btn-primary"
                >
                  Módosítás mentése
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {cascadeAfterModify && (
        <CascadeIntentsModal
          open={!!cascadeAfterModify}
          onClose={() => setCascadeAfterModify(null)}
          episodeId={cascadeAfterModify.episodeId}
          deltaMs={cascadeAfterModify.deltaMs}
          intents={cascadeAfterModify.intents}
          onConfirm={handleCascadeConfirm}
        />
      )}
      {reassignError && (
        <div className="fixed bottom-4 right-4 z-[70] max-w-sm bg-red-50 border border-red-200 text-red-800 text-sm p-3 rounded shadow-lg flex items-start gap-2">
          <span className="flex-1">{reassignError}</span>
          <button
            type="button"
            onClick={() => setReassignError(null)}
            className="text-red-600 hover:text-red-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {reassignCtx && (
        <ReassignStepModal
          open
          onClose={() => setReassignCtx(null)}
          sourceItem={reassignCtx.sourceItem}
          candidates={reassignCtx.candidates}
          onConfirm={async (payload) => {
            await handleConfirmReassign(reassignCtx.appointment.id, payload);
          }}
        />
      )}
      {unsuccessfulModalAppointment && (
        <UnsuccessfulAttemptModal
          open
          onClose={() => setUnsuccessfulModalAppointment(null)}
          appointmentId={unsuccessfulModalAppointment.id}
          appointmentStart={unsuccessfulModalAppointment.startTime}
          stepLabel={
            unsuccessfulModalAppointment.stepLabel ??
            unsuccessfulModalAppointment.stepCode ??
            null
          }
          attemptNumber={unsuccessfulModalAppointment.attemptNumber ?? 1}
          onConfirmed={async (payload: UnsuccessfulAttemptConfirmPayload) => {
            const r = await markUnsuccessful(
              unsuccessfulModalAppointment.id,
              payload.reason
            );
            if (!r.success) {
              throw new Error(r.error || 'Sikertelen-jelölés nem sikerült.');
            }
            if (payload.shouldOpenSlotPicker) {
              alert(
                'Az új próba időpontját a beteg munkalistáján (Következő munkafázis) foglalhatod le.'
              );
            }
          }}
        />
      )}
      {revertModalAppointment && (
        <RevertUnsuccessfulModal
          open
          onClose={() => setRevertModalAppointment(null)}
          appointmentId={revertModalAppointment.id}
          appointmentStart={revertModalAppointment.startTime}
          stepLabel={
            revertModalAppointment.stepLabel ?? revertModalAppointment.stepCode ?? null
          }
          attemptNumber={revertModalAppointment.attemptNumber ?? 1}
          originalFailedReason={revertModalAppointment.attemptFailedReason ?? null}
          onConfirmed={async (reason) => {
            const r = await revertUnsuccessful(revertModalAppointment.id, reason);
            if (!r.success) {
              throw new Error(r.error || 'Visszavonás nem sikerült.');
            }
          }}
        />
      )}
      {/* Status Edit Modal */}
      {editingStatus && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">Időpont státusz szerkesztése</h3>
              <button
                onClick={() => {
                  setEditingStatus(null);
                  setStatusForm({
                    appointmentStatus: null,
                    completionNotes: '',
                    isLate: false,
                    appointmentType: null,
                  });
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Időpont:</strong> {formatDateTime(editingStatus.startTime)}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Státusz
                </label>
                <select
                  value={statusForm.appointmentStatus || ''}
                  onChange={(e) => {
                    const value = e.target.value || null;
                    setStatusForm({
                      ...statusForm,
                      appointmentStatus: value as any,
                      completionNotes: value === 'completed' ? statusForm.completionNotes : '',
                    });
                  }}
                  className="form-input w-full"
                >
                  <option value="">Nincs státusz (normál időpont)</option>
                  <option value="cancelled_by_doctor">Lemondta az orvos</option>
                  <option value="cancelled_by_patient">Lemondta a beteg</option>
                  <option value="completed">Sikeresen teljesült</option>
                  <option value="no_show">Nem jelent meg</option>
                  <option value="unsuccessful" disabled>
                    Sikertelen próba (a listában a „Sikertelen vissza” gombbal)
                  </option>
                </select>
              </div>
              {editingStatus.appointmentStatus === 'completed' &&
                (statusForm.appointmentStatus === 'cancelled_by_doctor' ||
                  statusForm.appointmentStatus === 'cancelled_by_patient' ||
                  statusForm.appointmentStatus === 'no_show') && (
                  <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 p-2 rounded">
                    Mentéskor a kapcsolódó munkafázis (ha az időpont epizódhoz kötött és a fázis
                    ehhez a foglaláshoz volt kötve) <strong>pending</strong> állapotba kerül — új
                    próba foglalható a munkalistán.
                  </div>
                )}
              {statusForm.appointmentStatus === 'completed' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Mi történt? <span className="text-red-600">*</span>
                  </label>
                  <textarea
                    value={statusForm.completionNotes}
                    onChange={(e) => setStatusForm({ ...statusForm, completionNotes: e.target.value })}
                    className="form-input w-full"
                    rows={3}
                    placeholder="Rövid leírás arról, hogy mi történt az időpont során..."
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Időpont típusa
                </label>
                <select
                  value={statusForm.appointmentType || ''}
                  onChange={(e) => setStatusForm({ ...statusForm, appointmentType: e.target.value as any || null })}
                  className="form-input w-full"
                >
                  <option value="">Nincs megadva</option>
                  <option value="elso_konzultacio">Első konzultáció</option>
                  <option value="munkafazis">Munkafázis</option>
                  <option value="kontroll">Kontroll</option>
                </select>
              </div>
              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={statusForm.isLate}
                    onChange={(e) => setStatusForm({ ...statusForm, isLate: e.target.checked })}
                    className="form-checkbox"
                  />
                  <span className="text-sm font-medium text-gray-700">Késett a beteg</span>
                </label>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setEditingStatus(null);
                    setStatusForm({
                      appointmentStatus: null,
                      completionNotes: '',
                      isLate: false,
                      appointmentType: null,
                    });
                  }}
                  className="btn-secondary"
                >
                  Mégse
                </button>
                <button
                  onClick={handleSaveStatus}
                  className="btn-primary"
                >
                  Mentés
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-5 h-5 text-medical-primary" />
        <h3 className="text-lg font-semibold text-gray-900">Időpont foglalás</h3>
      </div>

      {/* Existing Appointments */}
      {appointments.length > 0 && (
        <div className="mb-6">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Lefoglalt időpontok</h4>
          <div className="space-y-2">
            {appointments.map((appointment) => {
              const displayCim = appointment.cim || DEFAULT_CIM;
              const st = appointment.appointmentStatus ?? null;
              let cardWrap =
                'flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-md';
              let metaBorder = 'border-green-200';
              let LeadIcon: typeof CheckCircle2 = CheckCircle2;
              let leadIconClass = 'text-green-600';
              if (st === 'cancelled_by_doctor' || st === 'cancelled_by_patient') {
                cardWrap =
                  'flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-md';
                metaBorder = 'border-red-200';
                LeadIcon = XCircle;
                leadIconClass = 'text-red-600';
              } else if (st === 'no_show') {
                cardWrap =
                  'flex items-center justify-between p-3 bg-gray-50 border border-gray-300 rounded-md';
                metaBorder = 'border-gray-300';
                LeadIcon = AlertCircle;
                leadIconClass = 'text-gray-700';
              } else if (st === 'unsuccessful') {
                cardWrap =
                  'flex items-center justify-between p-3 bg-orange-50 border border-orange-200 rounded-md';
                metaBorder = 'border-orange-200';
                LeadIcon = AlertTriangle;
                leadIconClass = 'text-orange-600';
              }
              const canMarkUnsuccessful =
                !!appointment.episodeId &&
                st !== 'cancelled_by_doctor' &&
                st !== 'cancelled_by_patient' &&
                st !== 'unsuccessful';
              return (
              <div key={appointment.id} className={cardWrap}>
                <div className="flex items-center gap-3">
                  <LeadIcon className={`w-5 h-5 ${leadIconClass}`} />
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {formatDateTime(appointment.startTime)}
                    </div>
                    <div className="text-xs text-gray-500">
                      {(appointment.stepLabel || appointment.stepCode || appointment.pool) && (
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                          {(appointment.stepLabel || appointment.stepCode) && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 text-xs font-medium">
                              {appointment.stepLabel || appointment.stepCode}
                            </span>
                          )}
                          {appointment.pool && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">
                              {appointment.pool === 'consult' ? 'Konzultáció' : appointment.pool === 'work' ? 'Munka' : appointment.pool === 'control' ? 'Kontroll' : appointment.pool}
                            </span>
                          )}
                          {appointment.episodeId && (
                            <span className="text-gray-400 text-xs" title={appointment.episodeId}>
                              Epizód #{appointment.episodeId.slice(0, 8)}
                            </span>
                          )}
                        </div>
                      )}
                      <div>Cím: {displayCim}</div>
                      {appointment.teremszam && (
                        <div>Teremszám: {appointment.teremszam}</div>
                      )}
                      <div>Fogpótlástanász: {appointment.dentistEmail || 'Nincs megadva'}</div>
                      {appointment.appointmentType && (
                        <div className="mt-1">
                          <span className="text-xs font-medium text-gray-600">Típus: </span>
                          <span className="text-xs text-gray-700">
                            {appointment.appointmentType === 'elso_konzultacio' && 'Első konzultáció'}
                            {appointment.appointmentType === 'munkafazis' && 'Munkafázis'}
                            {appointment.appointmentType === 'kontroll' && 'Kontroll'}
                          </span>
                        </div>
                      )}
                      <div className={`mt-2 pt-2 border-t ${metaBorder} space-y-1`}>
                        {appointment.createdAt && (
                          <div>
                            <span className="text-xs font-medium text-gray-600">Létrehozva: </span>
                            <span className="text-xs text-gray-700">
                              {formatDateTime(appointment.createdAt)}
                            </span>
                          </div>
                        )}
                        {appointment.approvedAt && (
                          <div>
                            <span className="text-xs font-medium text-gray-600">Elfogadva: </span>
                            <span className="text-xs text-gray-700">
                              {formatDateTime(appointment.approvedAt)}
                            </span>
                          </div>
                        )}
                        {appointment.createdBy && (
                          <div>
                            <span className="text-xs font-medium text-gray-600">Foglalta: </span>
                            <span className="text-xs text-gray-700">
                              {appointment.createdBy}
                            </span>
                          </div>
                        )}
                        {(appointment.timeSlotSource || appointment.createdVia) && (
                          <div>
                            <span className="text-xs font-medium text-gray-600">Forrás: </span>
                            <span className="text-xs text-gray-700">
                              {appointment.createdVia === 'worklist'
                                ? 'Munkalista'
                                : appointment.createdVia === 'patient_form'
                                  ? 'Beteg űrlap'
                                  : appointment.createdVia === 'admin_override'
                                    ? 'Admin felülírás'
                                    : appointment.createdVia === 'surgeon_override'
                                      ? 'Orvosi felülírás'
                                      : appointment.timeSlotSource === 'google_calendar'
                                        ? 'Google Naptár szinkron'
                                        : appointment.timeSlotSource === 'manual'
                                          ? 'Manuális'
                                          : 'Manuális'}{appointment.timeSlotSource === 'google_calendar' && appointment.createdVia && appointment.createdVia !== 'google_import' ? ' (.ics)' : ''}
                            </span>
                          </div>
                        )}
                      </div>
                      {(() => {
                        if (appointment.isLate) {
                          return (
                            <div className="flex items-center gap-1 mt-1 text-orange-600">
                              <ClockIcon className="w-3 h-3" />
                              <span>Késett a beteg</span>
                            </div>
                          );
                        }
                        if (appointment.appointmentStatus === 'cancelled_by_doctor') {
                          return (
                            <div className="flex items-center gap-1 mt-1 text-red-600">
                              <XCircle className="w-3 h-3" />
                              <span>Lemondta az orvos</span>
                            </div>
                          );
                        }
                        if (appointment.appointmentStatus === 'cancelled_by_patient') {
                          return (
                            <div className="flex items-center gap-1 mt-1 text-red-600">
                              <XCircle className="w-3 h-3" />
                              <span>Lemondta a beteg</span>
                            </div>
                          );
                        }
                        if (appointment.appointmentStatus === 'completed') {
                          return (
                            <div className="mt-1">
                              <div className="flex items-center gap-1 text-green-600">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Sikeresen teljesült</span>
                              </div>
                              {appointment.completionNotes && (
                                <div className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap break-words">
                                  {appointment.completionNotes}
                                </div>
                              )}
                            </div>
                          );
                        }
                        if (appointment.appointmentStatus === 'no_show') {
                          return (
                            <div className="flex items-center gap-1 mt-1 text-red-600">
                              <AlertCircle className="w-3 h-3" />
                              <span>Nem jelent meg</span>
                            </div>
                          );
                        }
                        if (appointment.appointmentStatus === 'unsuccessful') {
                          return (
                            <div className="mt-1">
                              <div className="flex items-center gap-1 text-orange-700">
                                <AlertTriangle className="w-3 h-3" />
                                <span>Sikertelen próba — ismétlés szükséges</span>
                              </div>
                              {appointment.attemptFailedReason && (
                                <div className="text-xs text-orange-900 mt-0.5 whitespace-pre-wrap break-words">
                                  {appointment.attemptFailedReason}
                                </div>
                              )}
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDownloadCalendar(appointment.id)}
                    className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    title="Naptár fájl letöltése"
                  >
                    <Download className="w-4 h-4" />
                    .ics
                  </button>
                  {!isViewOnly && (userRole === 'beutalo_orvos' || userRole === 'admin' || userRole === 'fogpótlástanász') && (
                    <>
                      <button
                        onClick={() => handleModifyAppointment(appointment)}
                        className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        title="Időpont módosítása"
                      >
                        <Edit2 className="w-4 h-4" />
                        Módosítás
                      </button>
                      {appointment.episodeId && (
                        <button
                          onClick={() => handleOpenReassign(appointment)}
                          disabled={reassignLoading === appointment.id}
                          className="text-sm text-purple-700 hover:text-purple-900 flex items-center gap-1 disabled:opacity-50"
                          title="A foglalás fázis-hovatartozásának módosítása (snapshot átkötése másik munkafázisra)"
                        >
                          <Shuffle className="w-4 h-4" />
                          {reassignLoading === appointment.id
                            ? 'Betöltés…'
                            : 'Másik fázisra'}
                        </button>
                      )}
                      {canMarkUnsuccessful && (
                        <button
                          type="button"
                          onClick={() => setUnsuccessfulModalAppointment(appointment)}
                          className="text-sm text-orange-700 hover:text-orange-900 flex items-center gap-1"
                          title="A próba sikertelen volt — új próba szükséges (indok kötelező)"
                        >
                          <AlertTriangle className="w-4 h-4" />
                          Sikertelen próba
                        </button>
                      )}
                      {appointment.episodeId &&
                        appointment.appointmentStatus === 'unsuccessful' && (
                          <button
                            type="button"
                            onClick={() => setRevertModalAppointment(appointment)}
                            className="text-sm text-gray-700 hover:text-gray-900 flex items-center gap-1"
                            title="Sikertelen-jelölés visszavonása (tévedés esetén)"
                          >
                            <Undo2 className="w-4 h-4" />
                            Sikertelen vissza
                          </button>
                        )}
                      <button
                        onClick={() => handleEditStatus(appointment)}
                        className="text-sm text-purple-600 hover:text-purple-800 flex items-center gap-1"
                        title="Státusz szerkesztése"
                      >
                        <Edit2 className="w-4 h-4" />
                        Státusz
                      </button>
                      <button
                        onClick={() => handleCancelAppointment(appointment.id)}
                        className="text-sm text-red-600 hover:text-red-800 flex items-center gap-1"
                        title="Időpont lemondása"
                      >
                        <X className="w-4 h-4" />
                        Lemondás
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
            })}
          </div>
        </div>
      )}

      {/* Book New Appointment */}
      {!isViewOnly && (
        <div className="space-y-4">
          {/* New slot creation for fogpótlástanász and admin */}
          {(userRole === 'fogpótlástanász' || userRole === 'admin') && (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-900">Új időpont kiírása és foglalása</h4>
                {!showNewSlotForm && (
                  <button
                    onClick={() => setShowNewSlotForm(true)}
                    className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Új időpont
                  </button>
                )}
              </div>
              {showNewSlotForm && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Dátum és idő
                    </label>
                    <DateTimePicker
                      selected={newSlotDateTime}
                      onChange={(date: Date | null) => setNewSlotDateTime(date)}
                      minDate={new Date()}
                      placeholder="Válasszon dátumot és időt"
                    />
                  </div>
                  {availableCims.length > 1 ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Cím
                      </label>
                      <select
                        value={newSlotCim || DEFAULT_CIM}
                        onChange={(e) => setNewSlotCim(e.target.value)}
                        className="form-input w-full"
                      >
                        {availableCims.map(cim => (
                          <option key={cim} value={cim}>{cim}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <input type="hidden" value={DEFAULT_CIM} />
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Teremszám
                    </label>
                    <input
                      type="text"
                      value={newSlotTeremszam}
                      onChange={(e) => setNewSlotTeremszam(digitsOnly(e.target.value))}
                      className="form-input w-full"
                      placeholder="Pl. 611"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Időpont típusa
                    </label>
                    <select
                      value={newSlotAppointmentType || ''}
                      onChange={(e) => setNewSlotAppointmentType(e.target.value as any || null)}
                      className="form-input w-full"
                    >
                      <option value="">Nincs megadva</option>
                      <option value="elso_konzultacio">Első konzultáció</option>
                      <option value="munkafazis">Munkafázis</option>
                      <option value="kontroll">Kontroll</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCreateAndBookNewSlot}
                      disabled={!newSlotDateTime}
                      className="btn-primary flex-1 flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Időpont kiírása és foglalása
                    </button>
                    <button
                      onClick={() => {
                        setShowNewSlotForm(false);
                        setNewSlotDateTime(null);
                        setNewSlotCim('');
                        setNewSlotTeremszam('');
                        setNewSlotAppointmentType(null);
                      }}
                      className="btn-secondary"
                    >
                      Mégse
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Existing slot selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Szabad időpont kiválasztása
            </label>
            {availableSlotsOnly.length > 0 ? (
              <select
                value={selectedSlot}
                onChange={(e) => setSelectedSlot(e.target.value)}
                className="form-input w-full"
                disabled={isViewOnly}
              >
                <option value="">Válasszon időpontot...</option>
                {availableSlotsOnly.map((slot) => {
                  const displayCim = slot.cim || DEFAULT_CIM;
                  return (
                    <option key={slot.id} value={slot.id}>
                      {formatDateTime(slot.startTime)}
                      {slot.dentistName ? ` - ${slot.dentistName}` : ''}
                      {` - ${displayCim}`}
                      {slot.teremszam ? ` (Terem: ${slot.teremszam})` : ''}
                      {slot.userEmail ? ` - ${slot.userEmail}` : ''}
                    </option>
                  );
                })}
              </select>
            ) : (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
                <p className="text-sm text-gray-600 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  Jelenleg nincs elérhető szabad időpont.
                </p>
              </div>
            )}
          </div>
          {selectedSlot && (
            <div className="space-y-3">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                <div className="text-sm text-gray-700">
                  <span className="font-medium">Kiválasztott időpont:</span>{' '}
                  {formatDateTime(availableSlotsOnly.find(s => s.id === selectedSlot)?.startTime || '')}
                </div>
                {(() => {
                  const selectedSlotData = availableSlotsOnly.find(s => s.id === selectedSlot);
                  return (
                    <>
                      {(() => {
                        const displayCim = selectedSlotData?.cim || DEFAULT_CIM;
                        return (
                          <div className="text-sm text-gray-600 mt-1">
                            <span className="font-medium">Cím:</span> {displayCim}
                          </div>
                        );
                      })()}
                      <div className="text-sm text-gray-600 mt-1">
                        <span className="font-medium">Teremszám:</span> {selectedSlotData?.teremszam || 'Nincs megadva'}
                      </div>
                      {selectedSlotData?.userEmail && (
                        <div className="text-sm text-gray-600 mt-1">
                          <span className="font-medium">Fogpótlástanász:</span> {selectedSlotData.userEmail}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              
              {/* Cím és teremszám módosítása */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-md">
                <h5 className="text-sm font-medium text-gray-700 mb-2">Cím és teremszám módosítása (opcionális)</h5>
                <div className="space-y-2">
                  {availableCims.length > 1 ? (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Cím
                      </label>
                      <select
                        value={customCim || DEFAULT_CIM}
                        onChange={(e) => setCustomCim(e.target.value)}
                        className="form-input w-full text-sm"
                      >
                        {availableCims.map(cim => (
                          <option key={cim} value={cim}>{cim}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500">
                      <span className="font-medium">Cím:</span> {DEFAULT_CIM}
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Teremszám
                    </label>
                    <input
                      type="text"
                      value={customTeremszam}
                      onChange={(e) => setCustomTeremszam(digitsOnly(e.target.value))}
                      className="form-input w-full text-sm"
                      placeholder={availableSlotsOnly.find(s => s.id === selectedSlot)?.teremszam || 'Pl. 611'}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Időpont típusa
                    </label>
                    <select
                      value={selectedAppointmentType || ''}
                      onChange={(e) => setSelectedAppointmentType(e.target.value as any || null)}
                      className="form-input w-full text-sm"
                    >
                      <option value="">Nincs megadva</option>
                      <option value="elso_konzultacio">Első konzultáció</option>
                      <option value="munkafazis">Munkafázis</option>
                      <option value="kontroll">Kontroll</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}
          {availableSlotsOnly.length > 0 && (
            <div>
              {(isNewPatient || isPatientDirty) && (
                <p className="text-xs text-gray-600 mb-2">
                  A foglalás előtt elmentjük a beteg adatait (ugyanaz, mint az alsó „Beteg mentése”), majd
                  megerősítésként lefoglaljuk a választott időpontot.
                </p>
              )}
              <button
                onClick={handleBookAppointment}
                disabled={!selectedSlot || isViewOnly || (!patientId && !onSavePatientBeforeBooking)}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                <Clock className="w-4 h-4" />
                Időpont foglalása
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

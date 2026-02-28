'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Calendar,
  Clock,
  Download,
  User,
  Mail,
  Trash2,
  Edit2,
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock as ClockIcon,
  Plus,
} from 'lucide-react';
import { Patient } from '@/lib/types';
import { formatDateTime, toLocalISOString, digitsOnly } from '@/lib/dateUtils';
import { DateTimePicker } from './DateTimePicker';
import { MobileTable } from './mobile/MobileTable';
import { MobileKeyValueGrid } from './mobile/MobileKeyValueGrid';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimeSlot {
  id: string;
  startTime: string;
  status: 'available' | 'booked';
  cim?: string | null;
  teremszam?: string | null;
  userEmail?: string;
  dentistName?: string | null;
}

interface Appointment {
  id: string;
  patientId: string;
  timeSlotId: string;
  startTime: string;
  patientName: string | null;
  patientTaj: string | null;
  dentistEmail: string;
  appointmentStatus?: 'cancelled_by_doctor' | 'cancelled_by_patient' | 'completed' | 'no_show' | null;
  completionNotes?: string | null;
  isLate?: boolean;
  appointmentType?: 'elso_konzultacio' | 'munkafazis' | 'kontroll' | null;
}

interface PendingAppointment {
  id: string;
  patientId: string;
  timeSlotId: string;
  startTime: string;
  patientName: string | null;
  patientTaj: string | null;
  patientEmail: string | null;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type BookingMode = 'standard' | 'conditional';

export interface AppointmentBookingProps {
  mode?: BookingMode;
  patientId?: string | null;
  patientEmail?: string | null;
  onBookingComplete?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AppointmentBooking({
  mode = 'standard',
  patientId: propPatientId,
  patientEmail,
  onBookingComplete,
}: AppointmentBookingProps = {}) {
  // ---- Shared state ----
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const isLoadingRef = useRef(false);

  // ---- Standard-mode state ----
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsPagination, setAppointmentsPagination] = useState<PaginationInfo | null>(null);
  const [appointmentsPage, setAppointmentsPage] = useState<number>(1);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [newTimeSlotId, setNewTimeSlotId] = useState<string>('');
  const [editingStatus, setEditingStatus] = useState<Appointment | null>(null);
  const [statusForm, setStatusForm] = useState<{
    appointmentStatus: 'cancelled_by_doctor' | 'cancelled_by_patient' | 'completed' | 'no_show' | null;
    completionNotes: string;
    isLate: boolean;
  }>({
    appointmentStatus: null,
    completionNotes: '',
    isLate: false,
  });

  // ---- Conditional-mode state ----
  const [pendingAppointments, setPendingAppointments] = useState<PendingAppointment[]>([]);
  const [rejectedAppointments, setRejectedAppointments] = useState<PendingAppointment[]>([]);
  const [alternativeSlots, setAlternativeSlots] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [showNewSlotForm, setShowNewSlotForm] = useState(false);
  const [newSlotDateTime, setNewSlotDateTime] = useState<Date | null>(null);
  const [newSlotTeremszam, setNewSlotTeremszam] = useState<string>('');
  const [selectedAppointmentType, setSelectedAppointmentType] = useState<'elso_konzultacio' | 'munkafazis' | 'kontroll' | null>(null);
  const [creatingNewSlot, setCreatingNewSlot] = useState(false);

  // =========================================================================
  // Data loading
  // =========================================================================

  const loadAvailableSlots = useCallback(async () => {
    try {
      let allSlots: TimeSlot[] = [];
      let page = 1;
      let hasMore = true;
      const limit = 100;
      const maxPages = 100;

      const onlyAvailableParam = mode === 'conditional' ? '&onlyAvailable=true' : '';

      while (hasMore && page <= maxPages) {
        const response = await fetch(
          `/api/time-slots?page=${page}&limit=${limit}${onlyAvailableParam}`,
          { credentials: 'include' },
        );
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

      const now = new Date();
      const fourHoursFromNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);
      const futureSlots = allSlots.filter(
        (slot: TimeSlot) => new Date(slot.startTime) >= fourHoursFromNow,
      );
      setAvailableSlots(futureSlots);
    } catch (error) {
      console.error('Error loading time slots:', error);
    }
  }, [mode]);

  const loadPatients = useCallback(async () => {
    if (propPatientId) return;

    try {
      const response = await fetch('/api/patients', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        const allPatients: Patient[] = data.patients || [];
        if (mode === 'conditional') {
          setPatients(allPatients.filter((p) => p.email && p.email.trim() !== ''));
        } else {
          setPatients(allPatients);
        }
      }
    } catch (error) {
      console.error('Error loading patients:', error);
    }
  }, [propPatientId, mode]);

  // Standard mode: load all appointments with pagination
  const loadAppointments = useCallback(
    async (page: number = 1) => {
      if (mode !== 'standard') return;
      try {
        const response = await fetch(`/api/appointments?page=${page}&limit=50`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          setAppointments(data.appointments || []);
          setAppointmentsPagination(data.pagination || null);
        }
      } catch (error) {
        console.error('Error loading appointments:', error);
      }
    },
    [mode],
  );

  // Conditional mode: load pending / rejected appointments
  const loadPendingAppointments = useCallback(async () => {
    if (mode !== 'conditional') return;
    try {
      const url = propPatientId
        ? `/api/appointments?patientId=${propPatientId}`
        : '/api/appointments';
      const response = await fetch(url, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        const all = data.appointments || [];
        setPendingAppointments(all.filter((apt: any) => apt.approvalStatus === 'pending'));
        setRejectedAppointments(all.filter((apt: any) => apt.approvalStatus === 'rejected'));
      }
    } catch (error) {
      console.error('Error loading appointments:', error);
    }
  }, [mode, propPatientId]);

  const loadData = useCallback(async () => {
    if (isLoadingRef.current) return;

    try {
      isLoadingRef.current = true;
      setLoading(true);
      if (mode === 'standard') {
        await Promise.all([loadAvailableSlots(), loadAppointments(appointmentsPage), loadPatients()]);
      } else {
        await Promise.all([loadAvailableSlots(), loadPendingAppointments(), loadPatients()]);
      }
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  }, [mode, loadAvailableSlots, loadAppointments, loadPendingAppointments, loadPatients, appointmentsPage]);

  // =========================================================================
  // Effects
  // =========================================================================

  useEffect(() => {
    if (propPatientId) setSelectedPatient(propPatientId);
  }, [propPatientId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (mode === 'standard') loadAppointments(appointmentsPage);
  }, [appointmentsPage, loadAppointments, mode]);

  // =========================================================================
  // Standard-mode handlers
  // =========================================================================

  const handleBookAppointment = useCallback(async () => {
    if (!selectedPatient || !selectedSlot) {
      alert('Kérjük, válasszon beteget és időpontot!');
      return;
    }
    if (!confirm('Biztosan le szeretné foglalni ezt az időpontot?')) return;

    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          patientId: selectedPatient,
          timeSlotId: selectedSlot,
          createdVia: 'patient_form',
        }),
      });
      if (response.ok) {
        await loadData();
        setSelectedPatient('');
        setSelectedSlot('');
        onBookingComplete?.();
        alert('Időpont sikeresen lefoglalva! A fogpótlástanász és a beteg (ha van email-címe) értesítést kapott.');
      } else {
        const data = await response.json();
        alert(data.error || 'Hiba történt az időpont foglalásakor');
      }
    } catch (error) {
      console.error('Error booking appointment:', error);
      alert('Hiba történt az időpont foglalásakor');
    }
  }, [selectedPatient, selectedSlot, loadData, onBookingComplete]);

  const handleDownloadCalendar = useCallback(async (appointmentId: string) => {
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
      } else {
        alert('Hiba történt a naptár fájl letöltésekor');
      }
    } catch (error) {
      console.error('Error downloading calendar:', error);
      alert('Hiba történt a naptár fájl letöltésekor');
    }
  }, []);

  const handleCancelAppointment = useCallback(
    async (appointmentId: string) => {
      if (!confirm('Biztosan le szeretné mondani ezt az időpontot? A fogpótlástanász és a beteg értesítést kap.')) return;

      try {
        const response = await fetch(`/api/appointments/${appointmentId}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (response.ok) {
          await loadData();
          alert('Időpont sikeresen lemondva! A fogpótlástanász és a beteg (ha van email-címe) értesítést kapott.');
        } else {
          const data = await response.json();
          alert(data.error || 'Hiba történt az időpont lemondásakor');
        }
      } catch (error) {
        console.error('Error cancelling appointment:', error);
        alert('Hiba történt az időpont lemondásakor');
      }
    },
    [loadData],
  );

  const handleModifyAppointment = useCallback((appointment: Appointment) => {
    setEditingAppointment(appointment);
    setNewTimeSlotId('');
  }, []);

  const handleSaveModification = useCallback(async () => {
    if (!editingAppointment || !newTimeSlotId) {
      alert('Kérjük, válasszon új időpontot!');
      return;
    }
    if (!confirm('Biztosan módosítani szeretné ezt az időpontot? A fogpótlástanász és a beteg értesítést kap.')) return;

    try {
      const response = await fetch(`/api/appointments/${editingAppointment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ timeSlotId: newTimeSlotId }),
      });
      if (response.ok) {
        await loadData();
        setEditingAppointment(null);
        setNewTimeSlotId('');
        alert('Időpont sikeresen módosítva! A fogpótlástanász és a beteg (ha van email-címe) értesítést kapott.');
      } else {
        const data = await response.json();
        alert(data.error || 'Hiba történt az időpont módosításakor');
      }
    } catch (error) {
      console.error('Error modifying appointment:', error);
      alert('Hiba történt az időpont módosításakor');
    }
  }, [editingAppointment, newTimeSlotId, loadData]);

  const handleEditStatus = useCallback((appointment: Appointment) => {
    setEditingStatus(appointment);
    setStatusForm({
      appointmentStatus: appointment.appointmentStatus || null,
      completionNotes: appointment.completionNotes || '',
      isLate: appointment.isLate || false,
    });
  }, []);

  const handleSaveStatus = useCallback(async () => {
    if (!editingStatus) return;

    if (statusForm.appointmentStatus === 'completed' && !statusForm.completionNotes.trim()) {
      alert('A "mi történt?" mező kitöltése kötelező sikeresen teljesült időpont esetén.');
      return;
    }

    try {
      const response = await fetch(`/api/appointments/${editingStatus.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          appointmentStatus: statusForm.appointmentStatus,
          completionNotes: statusForm.appointmentStatus === 'completed' ? statusForm.completionNotes : null,
          isLate: statusForm.isLate,
        }),
      });
      if (response.ok) {
        await loadData();
        setEditingStatus(null);
        setStatusForm({ appointmentStatus: null, completionNotes: '', isLate: false });
        alert('Időpont státusza sikeresen frissítve!');
      } else {
        const data = await response.json();
        alert(data.error || 'Hiba történt az időpont státuszának frissítésekor');
      }
    } catch (error) {
      console.error('Error updating appointment status:', error);
      alert('Hiba történt az időpont státuszának frissítésekor');
    }
  }, [editingStatus, statusForm, loadData]);

  const getStatusLabel = useCallback(
    (status: Appointment['appointmentStatus'], isLate?: boolean) => {
      if (isLate) {
        return { label: 'Késett', color: 'text-orange-600', bgColor: 'bg-orange-50', icon: ClockIcon };
      }
      switch (status) {
        case 'cancelled_by_doctor':
          return { label: 'Lemondta az orvos', color: 'text-red-600', bgColor: 'bg-red-50', icon: XCircle };
        case 'cancelled_by_patient':
          return { label: 'Lemondta a beteg', color: 'text-red-600', bgColor: 'bg-red-50', icon: XCircle };
        case 'completed':
          return { label: 'Sikeresen teljesült', color: 'text-green-600', bgColor: 'bg-green-50', icon: CheckCircle2 };
        case 'no_show':
          return { label: 'Nem jelent meg', color: 'text-red-600', bgColor: 'bg-red-50', icon: AlertCircle };
        default:
          return null;
      }
    },
    [],
  );

  // =========================================================================
  // Conditional-mode handlers
  // =========================================================================

  const handleCreatePendingAppointment = useCallback(async () => {
    const effectivePatientId = propPatientId || selectedPatient;

    if (!effectivePatientId || !selectedSlot) {
      alert('Kérjük, válasszon beteget és időpontot!');
      return;
    }

    if (propPatientId) {
      if (!patientEmail || patientEmail.trim() === '') {
        alert('A betegnek nincs email címe. A feltételes időpontválasztáshoz email cím szükséges.');
        return;
      }
    } else {
      const selectedPatientData = patients.find((p) => p.id === selectedPatient);
      if (!selectedPatientData || !selectedPatientData.email) {
        alert('A kiválasztott betegnek nincs email címe. A feltételes időpontválasztáshoz email cím szükséges.');
        return;
      }
    }

    if (
      !confirm(
        'Biztosan létre szeretné hozni ezt a feltételes időpontot? A páciens emailben értesítést kap és jóváhagyhatja vagy elvetheti az időpontot.',
      )
    )
      return;

    try {
      setCreating(true);
      const response = await fetch('/api/appointments/pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          patientId: effectivePatientId,
          timeSlotId: selectedSlot,
          alternativeTimeSlotIds: alternativeSlots.filter((id) => id && id !== selectedSlot),
          appointmentType: selectedAppointmentType || null,
        }),
      });
      if (response.ok) {
        await loadData();
        if (!propPatientId) setSelectedPatient('');
        setSelectedSlot('');
        setAlternativeSlots([]);
        setSelectedAppointmentType(null);
        onBookingComplete?.();
        alert('Feltételes időpont sikeresen létrehozva! A páciens emailben értesítést kapott.');
      } else {
        const data = await response.json();
        alert(data.error || 'Hiba történt a feltételes időpont létrehozásakor');
      }
    } catch (error) {
      console.error('Error creating pending appointment:', error);
      alert('Hiba történt a feltételes időpont létrehozásakor');
    } finally {
      setCreating(false);
    }
  }, [propPatientId, patientEmail, selectedPatient, selectedSlot, alternativeSlots, selectedAppointmentType, patients, loadData, onBookingComplete]);

  const addAlternativeSlot = useCallback(() => {
    setAlternativeSlots([...alternativeSlots, '']);
  }, [alternativeSlots]);

  const removeAlternativeSlot = useCallback(
    (index: number) => {
      setAlternativeSlots(alternativeSlots.filter((_, i) => i !== index));
    },
    [alternativeSlots],
  );

  const updateAlternativeSlot = useCallback(
    (index: number, slotId: string) => {
      const newAlternatives = [...alternativeSlots];
      newAlternatives[index] = slotId;
      setAlternativeSlots(newAlternatives);
    },
    [alternativeSlots],
  );

  const handleCreateNewTimeSlot = useCallback(async () => {
    if (!newSlotDateTime) {
      alert('Kérjük, válasszon dátumot és időt!');
      return;
    }
    if (newSlotDateTime <= new Date()) {
      alert('Az időpont csak jövőbeli dátum lehet!');
      return;
    }

    const isoDateTime = toLocalISOString(newSlotDateTime);
    const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';

    try {
      setCreatingNewSlot(true);
      const response = await fetch('/api/time-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          startTime: isoDateTime,
          cim: DEFAULT_CIM,
          teremszam: newSlotTeremszam.trim() || null,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const createdSlotId = data.timeSlot.id;
        await loadAvailableSlots();
        setSelectedSlot(createdSlotId);
        setNewSlotDateTime(null);
        setNewSlotTeremszam('');
        setShowNewSlotForm(false);
        alert('Új időpont sikeresen létrehozva és kiválasztva!');
      } else {
        const errorData = await response.json();
        alert(errorData.error || 'Hiba történt az időpont létrehozásakor');
      }
    } catch (error) {
      console.error('Error creating new time slot:', error);
      alert('Hiba történt az időpont létrehozásakor');
    } finally {
      setCreatingNewSlot(false);
    }
  }, [newSlotDateTime, newSlotTeremszam, loadAvailableSlots]);

  // =========================================================================
  // Derived / memoised values
  // =========================================================================

  const availableSlotsOnly = useMemo(
    () => availableSlots.filter((slot) => slot.status === 'available'),
    [availableSlots],
  );

  const availableSlotsForModification = useMemo(
    () => availableSlotsOnly.filter((slot) => !editingAppointment || slot.id !== editingAppointment.timeSlotId),
    [availableSlotsOnly, editingAppointment],
  );

  // =========================================================================
  // Loading state
  // =========================================================================

  if (loading) {
    return (
      <div className="card text-center py-8">
        <p className="text-gray-500">Betöltés...</p>
      </div>
    );
  }

  // =========================================================================
  // JSX
  // =========================================================================

  return (
    <div className="space-y-6">
      {/* ================================================================= */}
      {/* Standard-mode modals                                              */}
      {/* ================================================================= */}

      {mode === 'standard' && editingStatus && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">Időpont státusz szerkesztése</h3>
              <button
                onClick={() => {
                  setEditingStatus(null);
                  setStatusForm({ appointmentStatus: null, completionNotes: '', isLate: false });
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Beteg:</strong> {editingStatus.patientName || 'Név nélküli'}
                </p>
                <p className="text-sm text-gray-600 mb-4">
                  <strong>Időpont:</strong> {formatDateTime(editingStatus.startTime)}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Státusz</label>
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
                </select>
              </div>
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
                    setStatusForm({ appointmentStatus: null, completionNotes: '', isLate: false });
                  }}
                  className="btn-secondary"
                >
                  Mégse
                </button>
                <button onClick={handleSaveStatus} className="btn-primary">
                  Mentés
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {mode === 'standard' && editingAppointment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">Időpont módosítása</h3>
              <button
                onClick={() => {
                  setEditingAppointment(null);
                  setNewTimeSlotId('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Beteg:</strong> {editingAppointment.patientName || 'Név nélküli'}
                </p>
                <p className="text-sm text-gray-600 mb-4">
                  <strong>Jelenlegi időpont:</strong> {formatDateTime(editingAppointment.startTime)}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Új időpont</label>
                <select
                  value={newTimeSlotId}
                  onChange={(e) => setNewTimeSlotId(e.target.value)}
                  className="form-input w-full"
                >
                  <option value="">Válasszon új időpontot...</option>
                  {availableSlotsForModification.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {formatDateTime(slot.startTime)}
                      {` - ${slot.cim || '1088 Budapest, Szentkirályi utca 47'}`}
                      {slot.teremszam ? ` (Terem: ${slot.teremszam})` : ''}
                    </option>
                  ))}
                </select>
                {availableSlotsForModification.length === 0 && (
                  <p className="text-sm text-gray-500 mt-2">Jelenleg nincs elérhető szabad időpont.</p>
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setEditingAppointment(null);
                    setNewTimeSlotId('');
                  }}
                  className="btn-secondary"
                >
                  Mégse
                </button>
                <button onClick={handleSaveModification} disabled={!newTimeSlotId} className="btn-primary">
                  Módosítás mentése
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Standard-mode booking form                                        */}
      {/* ================================================================= */}

      {mode === 'standard' && (
        <div className="card p-6">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Új időpont foglalása</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Beteg</label>
              <select
                value={selectedPatient}
                onChange={(e) => setSelectedPatient(e.target.value)}
                className="form-input w-full"
              >
                <option value="">Válasszon beteget...</option>
                {patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.nev || 'Név nélküli'} {patient.taj ? `(${patient.taj})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Szabad időpont</label>
              <select
                value={selectedSlot}
                onChange={(e) => setSelectedSlot(e.target.value)}
                className="form-input w-full"
              >
                <option value="">Válasszon időpontot...</option>
                {availableSlotsOnly.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {formatDateTime(slot.startTime)}
                    {slot.dentistName ? ` - ${slot.dentistName}` : ''}
                    {slot.cim ? ` - ${slot.cim}` : ''}
                    {slot.teremszam ? ` (Terem: ${slot.teremszam})` : ''}
                  </option>
                ))}
              </select>
              {availableSlotsOnly.length === 0 && (
                <p className="text-sm text-gray-500 mt-2">Jelenleg nincs elérhető szabad időpont.</p>
              )}
            </div>
            <button
              onClick={handleBookAppointment}
              disabled={!selectedPatient || !selectedSlot}
              className="btn-primary w-full"
            >
              Időpont foglalása
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Standard-mode appointments table                                  */}
      {/* ================================================================= */}

      {mode === 'standard' && (
        <div className="card">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Lefoglalt időpontjaim</h3>
          {appointments.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">Még nincs lefoglalt időpont.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Beteg</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Időpont</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fogpótlástanász</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Státusz</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Műveletek</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {appointments.map((appointment) => (
                    <tr key={appointment.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <User className="w-4 h-4 text-gray-400 mr-2" />
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {appointment.patientName || 'Név nélküli'}
                            </div>
                            {appointment.patientTaj && (
                              <div className="text-sm text-gray-500">TAJ: {appointment.patientTaj}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <Clock className="w-4 h-4 text-gray-400 mr-2" />
                          <span className="text-sm text-gray-900">{formatDateTime(appointment.startTime)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-500">{appointment.dentistEmail}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {(() => {
                          const statusInfo = getStatusLabel(appointment.appointmentStatus, appointment.isLate);
                          if (statusInfo) {
                            const StatusIcon = statusInfo.icon;
                            return (
                              <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md ${statusInfo.bgColor}`}>
                                <StatusIcon className={`w-4 h-4 ${statusInfo.color}`} />
                                <span className={`text-xs font-medium ${statusInfo.color}`}>{statusInfo.label}</span>
                              </div>
                            );
                          }
                          return <span className="text-xs text-gray-400">-</span>;
                        })()}
                        {appointment.appointmentStatus === 'completed' && appointment.completionNotes && (
                          <div className="text-xs text-gray-600 mt-1" title={appointment.completionNotes}>
                            {appointment.completionNotes.length > 50
                              ? `${appointment.completionNotes.substring(0, 50)}...`
                              : appointment.completionNotes}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => handleDownloadCalendar(appointment.id)}
                            className="text-blue-600 hover:text-blue-900 flex items-center gap-1"
                            title="Naptár fájl letöltése"
                          >
                            <Download className="w-4 h-4" />
                            .ics
                          </button>
                          <button
                            onClick={() => handleEditStatus(appointment)}
                            className="text-purple-600 hover:text-purple-900 flex items-center gap-1"
                            title="Státusz szerkesztése"
                          >
                            <Edit2 className="w-4 h-4" />
                            Státusz
                          </button>
                          <button
                            onClick={() => handleModifyAppointment(appointment)}
                            className="text-amber-600 hover:text-amber-900 flex items-center gap-1"
                            title="Időpont módosítása"
                          >
                            <Edit2 className="w-4 h-4" />
                            Módosítás
                          </button>
                          <button
                            onClick={() => handleCancelAppointment(appointment.id)}
                            className="text-red-600 hover:text-red-900 flex items-center gap-1"
                            title="Időpont lemondása"
                          >
                            <Trash2 className="w-4 h-4" />
                            Lemondás
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {appointmentsPagination && appointmentsPagination.totalPages > 1 && (
            <div className="mt-4 px-6 py-3 flex items-center justify-between border-t border-gray-200">
              <div className="text-sm text-gray-600">
                Oldal {appointmentsPagination.page} / {appointmentsPagination.totalPages} (összesen{' '}
                {appointmentsPagination.total} időpont)
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAppointmentsPage((prev) => Math.max(1, prev - 1))}
                  disabled={appointmentsPagination.page === 1}
                  className={`px-3 py-2 rounded-md text-sm font-medium ${
                    appointmentsPagination.page === 1
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, appointmentsPagination.totalPages) }, (_, i) => {
                    let pageNum: number;
                    if (appointmentsPagination.totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (appointmentsPagination.page <= 3) {
                      pageNum = i + 1;
                    } else if (appointmentsPagination.page >= appointmentsPagination.totalPages - 2) {
                      pageNum = appointmentsPagination.totalPages - 4 + i;
                    } else {
                      pageNum = appointmentsPagination.page - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setAppointmentsPage(pageNum)}
                        className={`px-3 py-2 rounded-md text-sm font-medium ${
                          appointmentsPagination.page === pageNum
                            ? 'bg-blue-600 text-white'
                            : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() =>
                    setAppointmentsPage((prev) => Math.min(appointmentsPagination.totalPages, prev + 1))
                  }
                  disabled={appointmentsPagination.page === appointmentsPagination.totalPages}
                  className={`px-3 py-2 rounded-md text-sm font-medium ${
                    appointmentsPagination.page === appointmentsPagination.totalPages
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
                  }`}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* Conditional-mode booking form                                     */}
      {/* ================================================================= */}

      {mode === 'conditional' && (
        <div className="card p-6 border-l-4 border-blue-500">
          <div className="flex items-center gap-2 mb-4">
            <Mail className="w-5 h-5 text-blue-500" />
            <h3 className="text-xl font-bold text-gray-900">Feltételes időpontválasztás</h3>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Hozzon létre egy időpontot, amelyet a páciens emailben jóváhagyhat vagy elvethet. A páciens új időpontot is
            kérhet, ha az ajánlott időpont nem megfelelő.
          </p>
          <div className="space-y-4">
            {!propPatientId && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Beteg (csak email címmel rendelkező betegek)
                </label>
                <select
                  value={selectedPatient}
                  onChange={(e) => setSelectedPatient(e.target.value)}
                  className="form-input w-full"
                  disabled={creating}
                >
                  <option value="">Válasszon beteget...</option>
                  {patients.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {patient.nev || 'Név nélküli'} {patient.taj ? `(${patient.taj})` : ''} - {patient.email}
                    </option>
                  ))}
                </select>
                {patients.length === 0 && (
                  <p className="text-sm text-amber-600 mt-2 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    Nincs olyan beteg, akinek email címe lenne. A feltételes időpontválasztáshoz email cím szükséges.
                  </p>
                )}
              </div>
            )}
            {propPatientId && (!patientEmail || patientEmail.trim() === '') && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded">
                <p className="text-sm text-amber-800 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />A betegnek nincs email címe. A feltételes időpontválasztáshoz
                  email cím szükséges.
                </p>
              </div>
            )}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">Szabad időpont</label>
                <button
                  type="button"
                  onClick={() => setShowNewSlotForm(!showNewSlotForm)}
                  className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                  disabled={creating || creatingNewSlot}
                >
                  <Plus className="w-4 h-4" />
                  {showNewSlotForm ? 'Mégse' : 'Új időpont létrehozása'}
                </button>
              </div>
              {showNewSlotForm && (
                <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Dátum és idő</label>
                    <DateTimePicker
                      selected={newSlotDateTime}
                      onChange={(date: Date | null) => setNewSlotDateTime(date)}
                      minDate={new Date()}
                      placeholder="Válasszon dátumot és időt"
                      className="form-input w-full"
                      disabled={creatingNewSlot}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Teremszám (opcionális)</label>
                    <input
                      type="text"
                      value={newSlotTeremszam}
                      onChange={(e) => setNewSlotTeremszam(digitsOnly(e.target.value))}
                      placeholder="Pl. 101"
                      className="form-input w-full"
                      disabled={creatingNewSlot}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateNewTimeSlot}
                    disabled={!newSlotDateTime || creatingNewSlot}
                    className="btn-primary w-full"
                  >
                    {creatingNewSlot ? 'Létrehozás...' : 'Időpont létrehozása'}
                  </button>
                </div>
              )}
              <select
                value={selectedSlot}
                onChange={(e) => setSelectedSlot(e.target.value)}
                className="form-input w-full"
                disabled={creating || creatingNewSlot}
              >
                <option value="">Válasszon időpontot...</option>
                {availableSlotsOnly.map((slot) => {
                  const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
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
              {availableSlotsOnly.length === 0 && !showNewSlotForm && (
                <p className="text-sm text-gray-500 mt-2">Jelenleg nincs elérhető szabad időpont.</p>
              )}
            </div>

            {/* Időpont típusa */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Időpont típusa</label>
              <select
                value={selectedAppointmentType || ''}
                onChange={(e) => setSelectedAppointmentType((e.target.value as any) || null)}
                className="form-input w-full"
                disabled={creating}
              >
                <option value="">Nincs megadva</option>
                <option value="elso_konzultacio">Első konzultáció</option>
                <option value="munkafazis">Munkafázis</option>
                <option value="kontroll">Kontroll</option>
              </select>
            </div>

            {/* Alternatív időpontok */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">Alternatív időpontok (opcionális)</label>
                <button
                  type="button"
                  onClick={addAlternativeSlot}
                  className="flex items-center gap-1 px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
                  disabled={creating}
                >
                  <Plus className="w-4 h-4" />
                  Hozzáadás
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-2">
                Ha a beteg elutasítja az első időpontot, automatikusan az első alternatívát fogjuk felajánlani, majd a
                másodikat stb.
              </p>
              {alternativeSlots.length > 0 && (
                <div className="space-y-2">
                  {alternativeSlots.map((altSlotId, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <select
                        value={altSlotId}
                        onChange={(e) => updateAlternativeSlot(index, e.target.value)}
                        className="form-input flex-1"
                        disabled={creating}
                      >
                        <option value="">Válasszon alternatív időpontot...</option>
                        {availableSlotsOnly
                          .filter(
                            (slot) =>
                              (slot.id !== selectedSlot && !alternativeSlots.includes(slot.id)) ||
                              slot.id === altSlotId,
                          )
                          .map((slot) => {
                            const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
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
                      <button
                        type="button"
                        onClick={() => removeAlternativeSlot(index)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                        disabled={creating}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleCreatePendingAppointment}
              disabled={
                (!propPatientId && !selectedPatient) ||
                !selectedSlot ||
                creating ||
                creatingNewSlot ||
                (!propPatientId && patients.length === 0) ||
                (propPatientId ? !patientEmail || patientEmail.trim() === '' : false)
              }
              className="btn-primary w-full"
            >
              {creating ? 'Létrehozás...' : 'Feltételes időpont létrehozása'}
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Conditional-mode pending appointments                             */}
      {/* ================================================================= */}

      {mode === 'conditional' && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-5 h-5 text-gray-500" />
            <h3 className="text-xl font-bold text-gray-900">
              {propPatientId ? 'Jóváhagyásra váró időpontok (ehhez a beteghez)' : 'Jóváhagyásra váró időpontok'}
            </h3>
          </div>
          <MobileTable
            items={pendingAppointments}
            renderRow={(appointment) => (
              <>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <User className="w-4 h-4 text-gray-400 mr-2" />
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {appointment.patientName || 'Név nélküli'}
                      </div>
                      {appointment.patientTaj && (
                        <div className="text-sm text-gray-500">TAJ: {appointment.patientTaj}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <Mail className="w-4 h-4 text-gray-400 mr-2" />
                    <span className="text-sm text-gray-900">{appointment.patientEmail || 'Nincs email'}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <Clock className="w-4 h-4 text-gray-400 mr-2" />
                    <span className="text-sm text-gray-900">{formatDateTime(appointment.startTime)}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-500">
                    {new Date(appointment.createdAt).toLocaleString('hu-HU')}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                    Várakozik
                  </span>
                </td>
              </>
            )}
            renderCard={(appointment) => (
              <div className="mobile-card">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <h3 className="text-base font-semibold text-gray-900 truncate">
                      {appointment.patientName || 'Név nélküli'}
                    </h3>
                  </div>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 flex-shrink-0">
                    Várakozik
                  </span>
                </div>
                <MobileKeyValueGrid
                  items={[
                    { key: 'Email', value: appointment.patientEmail || 'Nincs email' },
                    { key: 'Időpont', value: formatDateTime(appointment.startTime) },
                    { key: 'Létrehozva', value: new Date(appointment.createdAt).toLocaleString('hu-HU') },
                    ...(appointment.patientTaj ? [{ key: 'TAJ', value: appointment.patientTaj }] : []),
                  ]}
                />
              </div>
            )}
            keyExtractor={(appointment) => appointment.id}
            emptyState={
              <div className="text-center py-8">
                <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">Jelenleg nincs jóváhagyásra váró időpont.</p>
              </div>
            }
            renderHeader={() => (
              <>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Beteg</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Időpont</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Létrehozva</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Státusz</th>
              </>
            )}
          />
        </div>
      )}

      {/* ================================================================= */}
      {/* Conditional-mode rejected appointments                            */}
      {/* ================================================================= */}

      {mode === 'conditional' && rejectedAppointments.length > 0 && (
        <div className="card mt-6">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-5 h-5 text-gray-500" />
            <h3 className="text-xl font-bold text-gray-900">
              {propPatientId ? 'Elutasított időpontok (ehhez a beteghez)' : 'Elutasított időpontok'}
            </h3>
          </div>
          <MobileTable
            items={rejectedAppointments}
            renderRow={(appointment) => (
              <>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <User className="w-4 h-4 text-gray-400 mr-2" />
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {appointment.patientName || 'Név nélküli'}
                      </div>
                      {appointment.patientTaj && (
                        <div className="text-sm text-gray-500">TAJ: {appointment.patientTaj}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <Mail className="w-4 h-4 text-gray-400 mr-2" />
                    <span className="text-sm text-gray-900">{appointment.patientEmail || 'Nincs email'}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <Clock className="w-4 h-4 text-gray-400 mr-2" />
                    <span className="text-sm text-gray-900">{formatDateTime(appointment.startTime)}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-500">
                    {new Date(appointment.createdAt).toLocaleString('hu-HU')}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    Elutasítva
                  </span>
                </td>
              </>
            )}
            renderCard={(appointment) => (
              <div className="mobile-card">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <h3 className="text-base font-semibold text-gray-900 truncate">
                      {appointment.patientName || 'Név nélküli'}
                    </h3>
                  </div>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 flex-shrink-0">
                    Elutasítva
                  </span>
                </div>
                <MobileKeyValueGrid
                  items={[
                    { key: 'Email', value: appointment.patientEmail || 'Nincs email' },
                    { key: 'Időpont', value: formatDateTime(appointment.startTime) },
                    { key: 'Létrehozva', value: new Date(appointment.createdAt).toLocaleString('hu-HU') },
                    ...(appointment.patientTaj ? [{ key: 'TAJ', value: appointment.patientTaj }] : []),
                  ]}
                />
              </div>
            )}
            keyExtractor={(appointment) => appointment.id}
            renderHeader={() => (
              <>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Beteg</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Időpont</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Létrehozva</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Státusz</th>
              </>
            )}
          />
        </div>
      )}
    </div>
  );
}

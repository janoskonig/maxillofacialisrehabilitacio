'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Clock, MapPin, Plus, CheckCircle, XCircle, AlertCircle, Edit2, X } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';
import { DateTimePicker } from '@/components/DateTimePicker';

interface Appointment {
  id: string;
  startTime: string;
  cim: string | null;
  teremszam: string | null;
  dentistName: string | null;
  dentistEmail: string | null;
  appointmentStatus: string | null;
  approvalStatus: string | null;
  timeSlotId?: string;
}

interface TimeSlot {
  id: string;
  startTime: string;
  status?: 'available' | 'booked';
  cim: string | null;
  teremszam: string | null;
}

export function PatientAppointmentsList() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [newDateTime, setNewDateTime] = useState<Date | null>(null);
  const [newTeremszam, setNewTeremszam] = useState<string>('');

  useEffect(() => {
    fetchAppointments();
  }, []);

  const fetchAppointments = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/patient-portal/appointments', {
        credentials: 'include',
      });

      if (!response.ok || response.status === 401) {
        router.push('/patient-portal');
        return;
      }

      const data = await response.json();
      setAppointments(data.appointments || []);
    } catch (error) {
      console.error('Hiba az időpontok betöltésekor:', error);
      showToast('Hiba történt az időpontok betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (appointment: Appointment) => {
    if (appointment.approvalStatus === 'pending') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-orange-100 text-orange-700 rounded">
          <AlertCircle className="w-3 h-3" />
          Jóváhagyásra vár
        </span>
      );
    }
    if (appointment.approvalStatus === 'rejected') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded">
          <XCircle className="w-3 h-3" />
          Elutasítva
        </span>
      );
    }
    if (appointment.approvalStatus === 'approved') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded">
          <CheckCircle className="w-3 h-3" />
          Jóváhagyva
        </span>
      );
    }
    if (appointment.appointmentStatus === 'completed') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded">
          <CheckCircle className="w-3 h-3" />
          Lezárva
        </span>
      );
    }
    if (appointment.appointmentStatus === 'cancelled_by_doctor' || appointment.appointmentStatus === 'cancelled_by_patient') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded">
          <XCircle className="w-3 h-3" />
          Törölve
        </span>
      );
    }
    return null;
  };

  const isPast = (startTime: string) => {
    return new Date(startTime) < new Date();
  };

  const handleModifyAppointment = async (appointment: Appointment) => {
    // Only allow modification of approved, future appointments
    if (appointment.approvalStatus === 'pending') {
      showToast('A jóváhagyásra váró időpontot nem lehet módosítani', 'error');
      return;
    }
    if (appointment.approvalStatus === 'rejected') {
      showToast('Az elutasított időpontot nem lehet módosítani', 'error');
      return;
    }
    if (isPast(appointment.startTime)) {
      showToast('Csak jövőbeli időpontot lehet módosítani', 'error');
      return;
    }
    
    setEditingAppointment(appointment);
    setNewDateTime(null);
    setNewTeremszam('');
  };

  const handleSaveModification = async () => {
    if (!editingAppointment || !newDateTime) {
      showToast('Kérjük, válasszon dátumot és időt!', 'error');
      return;
    }

    // Check if date is in the future
    if (newDateTime <= new Date()) {
      showToast('Az időpont csak jövőbeli dátum lehet!', 'error');
      return;
    }

    try {
      // Convert Date to ISO format with timezone offset
      const offset = -newDateTime.getTimezoneOffset();
      const offsetHours = Math.floor(Math.abs(offset) / 60);
      const offsetMinutes = Math.abs(offset) % 60;
      const offsetSign = offset >= 0 ? '+' : '-';
      const offsetString = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;
      
      const year = newDateTime.getFullYear();
      const month = String(newDateTime.getMonth() + 1).padStart(2, '0');
      const day = String(newDateTime.getDate()).padStart(2, '0');
      const hours = String(newDateTime.getHours()).padStart(2, '0');
      const minutes = String(newDateTime.getMinutes()).padStart(2, '0');
      const seconds = String(newDateTime.getSeconds()).padStart(2, '0');
      const isoDateTime = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetString}`;

      const response = await fetch(`/api/patient-portal/appointments/${editingAppointment.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          startTime: isoDateTime,
          teremszam: newTeremszam.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Hiba történt az időpont módosításakor');
      }

      showToast(
        'Időpont sikeresen módosítva! A fogpótlástanász és Ön értesítést kapott.',
        'success'
      );
      setEditingAppointment(null);
      setNewDateTime(null);
      setNewTeremszam('');
      await fetchAppointments();
    } catch (error) {
      console.error('Error modifying appointment:', error);
      showToast(
        error instanceof Error ? error.message : 'Hiba történt az időpont módosításakor',
        'error'
      );
    }
  };

  const upcomingAppointments = appointments.filter((apt) => !isPast(apt.startTime));
  const pastAppointments = appointments.filter((apt) => isPast(apt.startTime));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-medical-primary"></div>
        <span className="ml-3 text-gray-600">Betöltés...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Modification Modal */}
      {editingAppointment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">Időpont módosítása</h3>
              <button
                onClick={() => {
                  setEditingAppointment(null);
                  setNewDateTime(null);
                  setNewTeremszam('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Jelenlegi időpont:</strong>{' '}
                  {format(new Date(editingAppointment.startTime), 'yyyy. MMMM d. EEEE, HH:mm', { locale: hu })}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Új dátum és idő megadása
                </label>
                <DateTimePicker
                  selected={newDateTime}
                  onChange={(date: Date | null) => setNewDateTime(date)}
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
                  value={newTeremszam}
                  onChange={(e) => setNewTeremszam(e.target.value)}
                  className="form-input w-full"
                  placeholder="Pl. 611"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setEditingAppointment(null);
                    setNewDateTime(null);
                    setNewTeremszam('');
                  }}
                  className="btn-secondary"
                >
                  Mégse
                </button>
                <button
                  onClick={handleSaveModification}
                  disabled={!newDateTime}
                  className="btn-primary"
                >
                  Módosítás mentése
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Calendar className="w-6 h-6 sm:w-8 sm:h-8 text-medical-primary" />
            Időpontok
          </h1>
          <p className="text-gray-600 mt-2">
            Itt találhatja az összes időpontját és kérhet új időpontot.
          </p>
        </div>
        <button
          onClick={() => setShowRequestForm(!showRequestForm)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Új időpont kérése</span>
          <span className="sm:hidden">Új</span>
        </button>
      </div>

      {/* Request Appointment Form */}
      {showRequestForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Új időpont kérése
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            Az időpont kérése után emailben értesítést kap a jóváhagyásról.
          </p>
          <RequestAppointmentForm
            onSuccess={() => {
              setShowRequestForm(false);
              fetchAppointments();
            }}
            onCancel={() => setShowRequestForm(false)}
          />
        </div>
      )}

      {/* Upcoming Appointments */}
      {upcomingAppointments.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Következő időpontok
          </h2>
          <div className="space-y-3">
            {upcomingAppointments.map((appointment) => {
              const startTime = new Date(appointment.startTime);
              return (
                <div
                  key={appointment.id}
                  className="p-4 rounded-lg border border-gray-200 hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-4 h-4 text-gray-500" />
                        <span className="font-semibold text-gray-900">
                          {format(startTime, 'yyyy. MMMM d. EEEE, HH:mm', { locale: hu })}
                        </span>
                        {getStatusBadge(appointment)}
                      </div>
                      {appointment.dentistName && (
                        <p className="text-sm text-gray-600 mb-1">
                          Orvos: {appointment.dentistName}
                        </p>
                      )}
                      {(appointment.cim || appointment.teremszam) && (
                        <div className="flex items-center gap-1 text-sm text-gray-600">
                          <MapPin className="w-3 h-3" />
                          <span>
                            {appointment.cim}
                            {appointment.teremszam && ` • ${appointment.teremszam}. terem`}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      {appointment.approvalStatus === 'approved' && 
                       !isPast(appointment.startTime) &&
                       appointment.appointmentStatus !== 'cancelled_by_doctor' &&
                       appointment.appointmentStatus !== 'cancelled_by_patient' && (
                        <button
                          onClick={() => handleModifyAppointment(appointment)}
                          className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-50"
                          title="Időpont módosítása"
                        >
                          <Edit2 className="w-4 h-4" />
                          Módosítás
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Past Appointments */}
      {pastAppointments.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Korábbi időpontok
          </h2>
          <div className="space-y-3">
            {pastAppointments.map((appointment) => {
              const startTime = new Date(appointment.startTime);
              return (
                <div
                  key={appointment.id}
                  className="p-4 rounded-lg border border-gray-200 bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-4 h-4 text-gray-400" />
                        <span className="font-semibold text-gray-700">
                          {format(startTime, 'yyyy. MMMM d. EEEE, HH:mm', { locale: hu })}
                        </span>
                        {getStatusBadge(appointment)}
                      </div>
                      {appointment.dentistName && (
                        <p className="text-sm text-gray-600 mb-1">
                          Orvos: {appointment.dentistName}
                        </p>
                      )}
                      {(appointment.cim || appointment.teremszam) && (
                        <div className="flex items-center gap-1 text-sm text-gray-600">
                          <MapPin className="w-3 h-3" />
                          <span>
                            {appointment.cim}
                            {appointment.teremszam && ` • ${appointment.teremszam}. terem`}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {appointments.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <Calendar className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Nincsenek időpontok
          </h3>
          <p className="text-gray-600 mb-6">
            Még nincs rögzített időpontja. Kérjen új időpontot az "Új időpont kérése" gombbal.
          </p>
          <button
            onClick={() => setShowRequestForm(true)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Új időpont kérése
          </button>
        </div>
      )}
    </div>
  );
}

// Request Appointment Form Component
function RequestAppointmentForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<any[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(true);

  useEffect(() => {
    fetchAvailableSlots();
  }, []);

  const fetchAvailableSlots = async () => {
    try {
      setLoadingSlots(true);
      const response = await fetch('/api/patient-portal/time-slots?status=available&future=true', {
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 401) {
          router.push('/patient-portal');
          return;
        }
        throw new Error('Nem sikerült betölteni az elérhető időpontokat');
      }

      const data = await response.json();
      setAvailableSlots(data.timeSlots || []);
    } catch (error) {
      console.error('Hiba az elérhető időpontok betöltésekor:', error);
      showToast('Hiba történt az elérhető időpontok betöltésekor', 'error');
    } finally {
      setLoadingSlots(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedSlot) {
      showToast('Kérjük, válasszon időpontot', 'error');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/patient-portal/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          timeSlotId: selectedSlot,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Hiba történt');
      }

      showToast(
        'Időpont kérés sikeresen elküldve. Emailben értesítést kap a jóváhagyásról.',
        'success'
      );
      onSuccess();
    } catch (error) {
      console.error('Hiba az időpont kérésekor:', error);
      showToast(
        error instanceof Error ? error.message : 'Hiba történt az időpont kérésekor',
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="form-label">Válasszon elérhető időpontot</label>
        {loadingSlots ? (
          <div className="text-center py-4 text-gray-500">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-medical-primary mx-auto"></div>
            <p className="mt-2 text-sm">Elérhető időpontok betöltése...</p>
          </div>
        ) : availableSlots.length === 0 ? (
          <div className="text-center py-4 text-gray-500">
            <p className="text-sm">Jelenleg nincs elérhető időpont</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto p-2 border border-gray-200 rounded">
            {availableSlots.map((slot) => {
              const startTime = new Date(slot.startTime);
              return (
                <label
                  key={slot.id}
                  className={`p-3 rounded border cursor-pointer transition-colors ${
                    selectedSlot === slot.id
                      ? 'border-medical-primary bg-blue-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="timeSlot"
                    value={slot.id}
                    checked={selectedSlot === slot.id}
                    onChange={(e) => setSelectedSlot(e.target.value)}
                    className="sr-only"
                  />
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">
                        {format(startTime, 'yyyy. MMMM d. EEEE, HH:mm', { locale: hu })}
                      </p>
                      {slot.cim && (
                        <p className="text-xs text-gray-600">{slot.cim}</p>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary flex-1"
          disabled={loading}
        >
          Mégse
        </button>
        <button
          type="submit"
          className="btn-primary flex-1"
          disabled={loading || !selectedSlot || loadingSlots}
        >
          {loading ? 'Küldés...' : 'Időpont kérése'}
        </button>
      </div>
    </form>
  );
}


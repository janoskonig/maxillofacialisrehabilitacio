'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Clock, MapPin, Plus, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';

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

export function PatientAppointmentsList() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [showRequestForm, setShowRequestForm] = useState(false);

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
            Kérjen időpontot. Az adminisztráció felveszi Önnel a kapcsolatot az időpont egyeztetéséhez.
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
  const [beutaloOrvos, setBeutaloOrvos] = useState('');
  const [beutaloIndokolas, setBeutaloIndokolas] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);

    try {
      const response = await fetch('/api/patient-portal/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          beutaloOrvos: beutaloOrvos.trim() || undefined,
          beutaloIndokolas: beutaloIndokolas.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Hiba történt');
      }

      showToast(
        'Időpont kérés sikeresen elküldve. Az adminisztráció hamarosan felveszi Önnel a kapcsolatot.',
        'success'
      );
      setBeutaloOrvos('');
      setBeutaloIndokolas('');
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
        <label htmlFor="beutalo-orvos" className="form-label flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          Beutaló orvos neve (opcionális)
        </label>
        <input
          id="beutalo-orvos"
          type="text"
          value={beutaloOrvos}
          onChange={(e) => setBeutaloOrvos(e.target.value)}
          className="form-input"
          placeholder="Dr. Kovács János"
          disabled={loading}
        />
      </div>

      <div>
        <label htmlFor="beutalo-indokolas" className="form-label flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          Beutalás indoka (opcionális)
        </label>
        <textarea
          id="beutalo-indokolas"
          value={beutaloIndokolas}
          onChange={(e) => setBeutaloIndokolas(e.target.value)}
          className="form-input"
          placeholder="Beutalás indokának leírása..."
          rows={4}
          disabled={loading}
        />
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
          disabled={loading}
        >
          {loading ? 'Küldés...' : 'Időpont kérése'}
        </button>
      </div>
    </form>
  );
}

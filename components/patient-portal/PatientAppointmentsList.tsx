'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Clock, MapPin, Plus, CheckCircle, XCircle, AlertCircle, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';
import { BookingModal } from './BookingModal';
import { CancellationModal } from './CancellationModal';

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
  cim: string | null;
  teremszam: string | null;
  dentistName: string | null;
  dentistEmail: string | null;
}

export function PatientAppointmentsList() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [cancellingAppointment, setCancellingAppointment] = useState<Appointment | null>(null);
  const [cancellationLoading, setCancellationLoading] = useState(false);
  
  // Pagination for past appointments
  const [pastAppointmentsPage, setPastAppointmentsPage] = useState(1);
  const ITEMS_PER_PAGE = 5;

  useEffect(() => {
    fetchAppointments();
    fetchAvailableSlots();
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

  const fetchAvailableSlots = async () => {
    try {
      setLoadingSlots(true);
      const response = await fetch('/api/patient-portal/time-slots', {
        credentials: 'include',
      });

      if (!response.ok || response.status === 401) {
        return;
      }

      const data = await response.json();
      setAvailableSlots(data.timeSlots || []);
    } catch (error) {
      console.error('Hiba a szabad időpontok betöltésekor:', error);
      showToast('Hiba történt a szabad időpontok betöltésekor', 'error');
    } finally {
      setLoadingSlots(false);
    }
  };

  const handleBookSlot = (slot: TimeSlot) => {
    setSelectedSlot(slot);
  };

  const handleConfirmBooking = async () => {
    if (!selectedSlot) return;

    setBookingLoading(true);
    try {
      const response = await fetch('/api/patient-portal/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          timeSlotId: selectedSlot.id,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Hiba történt az időpont foglalásakor');
      }

      showToast('Időpont sikeresen lefoglalva!', 'success');
      setSelectedSlot(null);
      // Refresh both appointments and available slots
      await Promise.all([fetchAppointments(), fetchAvailableSlots()]);
    } catch (error) {
      console.error('Hiba az időpont foglalásakor:', error);
      showToast(
        error instanceof Error ? error.message : 'Hiba történt az időpont foglalásakor',
        'error'
      );
    } finally {
      setBookingLoading(false);
    }
  };

  const handleCancelAppointment = (appointment: Appointment) => {
    setCancellingAppointment(appointment);
  };

  const handleConfirmCancellation = async (cancellationReason: string) => {
    if (!cancellingAppointment) return;

    setCancellationLoading(true);
    try {
      const response = await fetch(`/api/patient-portal/appointments/${cancellingAppointment.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          cancellationReason,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Hiba történt az időpont lemondásakor');
      }

      showToast('Időpont sikeresen lemondva!', 'success');
      setCancellingAppointment(null);
      // Refresh appointments list
      await fetchAppointments();
    } catch (error) {
      console.error('Hiba az időpont lemondásakor:', error);
      showToast(
        error instanceof Error ? error.message : 'Hiba történt az időpont lemondásakor',
        'error'
      );
    } finally {
      setCancellationLoading(false);
    }
  };

  const getStatusBadge = (appointment: Appointment) => {
    if (appointment.approvalStatus === 'pending') {
      return (
        <span className="inline-flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs font-medium bg-orange-100 text-orange-700 rounded">
          <AlertCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
          <span className="hidden xs:inline">Jóváhagyásra vár</span>
          <span className="xs:hidden">Vár</span>
        </span>
      );
    }
    if (appointment.approvalStatus === 'rejected') {
      return (
        <span className="inline-flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs font-medium bg-red-100 text-red-700 rounded">
          <XCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
          <span className="hidden xs:inline">Elutasítva</span>
          <span className="xs:hidden">Elutas.</span>
        </span>
      );
    }
    if (appointment.approvalStatus === 'approved') {
      return (
        <span className="inline-flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs font-medium bg-green-100 text-green-700 rounded">
          <CheckCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
          <span className="hidden xs:inline">Jóváhagyva</span>
          <span className="xs:hidden">OK</span>
        </span>
      );
    }
    if (appointment.appointmentStatus === 'completed') {
      return (
        <span className="inline-flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs font-medium bg-blue-100 text-blue-700 rounded">
          <CheckCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
          <span className="hidden xs:inline">Lezárva</span>
          <span className="xs:hidden">Lezárva</span>
        </span>
      );
    }
    if (appointment.appointmentStatus === 'cancelled_by_doctor' || appointment.appointmentStatus === 'cancelled_by_patient') {
      return (
        <span className="inline-flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs font-medium bg-gray-100 text-gray-700 rounded">
          <XCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
          <span className="hidden xs:inline">Törölve</span>
          <span className="xs:hidden">Törölve</span>
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
  
  // Pagination calculations for past appointments
  const totalPastPages = Math.ceil(pastAppointments.length / ITEMS_PER_PAGE);
  const startIndex = (pastAppointmentsPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedPastAppointments = pastAppointments.slice(startIndex, endIndex);
  
  // Reset to page 1 when past appointments change
  useEffect(() => {
    if (pastAppointmentsPage > totalPastPages && totalPastPages > 0) {
      setPastAppointmentsPage(1);
    }
  }, [pastAppointments.length, pastAppointmentsPage, totalPastPages]);

  const canCancelAppointment = (appointment: Appointment) => {
    // Can cancel if:
    // 1. Appointment is in the future
    // 2. Not already cancelled
    return (
      !isPast(appointment.startTime) &&
      appointment.appointmentStatus !== 'cancelled_by_patient' &&
      appointment.appointmentStatus !== 'cancelled_by_doctor'
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-medical-primary"></div>
        <span className="ml-3 text-gray-600">Betöltés...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 sm:w-6 sm:h-6 lg:w-8 lg:h-8 text-medical-primary flex-shrink-0" />
            Időpontok
          </h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1 sm:mt-2">
            Itt találhatja az összes időpontját és foglalhat új időpontot.
          </p>
        </div>
        <button
          onClick={() => setShowRequestForm(!showRequestForm)}
          className="btn-primary flex items-center gap-2 text-sm sm:text-base px-3 sm:px-4 py-1.5 sm:py-2 w-full sm:w-auto justify-center"
        >
          <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span className="hidden sm:inline">Új időpont kérése</span>
          <span className="sm:hidden">Új</span>
        </button>
      </div>

      {/* Request Appointment Form */}
      {showRequestForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">
            Új időpont kérése
          </h2>
          <p className="text-xs sm:text-sm text-gray-600 mb-3 sm:mb-4">
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
        <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">
            Következő időpontok
          </h2>
          <div className="space-y-2 sm:space-y-3">
            {upcomingAppointments.map((appointment) => {
              const startTime = new Date(appointment.startTime);
              return (
                <div
                  key={appointment.id}
                  className="p-3 sm:p-4 rounded-lg border border-gray-200 hover:bg-gray-50"
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2 flex-wrap">
                        <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-500 flex-shrink-0" />
                        <span className="font-semibold text-sm sm:text-base text-gray-900">
                          {format(startTime, 'yyyy. MMMM d. EEEE, HH:mm', { locale: hu })}
                        </span>
                        {getStatusBadge(appointment)}
                      </div>
                      {appointment.dentistName && (
                        <p className="text-xs sm:text-sm text-gray-600 mb-1 truncate">
                          Orvos: {appointment.dentistName}
                        </p>
                      )}
                      {(appointment.cim || appointment.teremszam) && (
                        <div className="flex items-center gap-1 text-xs sm:text-sm text-gray-600">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">
                            {appointment.cim}
                            {appointment.teremszam && ` • ${appointment.teremszam}. terem`}
                          </span>
                        </div>
                      )}
                    </div>
                    {canCancelAppointment(appointment) && (
                      <button
                        onClick={() => handleCancelAppointment(appointment)}
                        className="bg-red-600 hover:bg-red-700 text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-colors flex items-center gap-1.5 sm:gap-2 flex-shrink-0 w-full sm:w-auto justify-center"
                      >
                        <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        <span className="hidden sm:inline">Lemondás</span>
                        <span className="sm:hidden">Lemond</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Past Appointments */}
      {pastAppointments.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">
            Korábbi időpontok ({pastAppointments.length})
          </h2>
          <div className="space-y-2 sm:space-y-3">
            {paginatedPastAppointments.map((appointment) => {
              const startTime = new Date(appointment.startTime);
              return (
                <div
                  key={appointment.id}
                  className="p-3 sm:p-4 rounded-lg border border-gray-200 bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-2 sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2 flex-wrap">
                        <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400 flex-shrink-0" />
                        <span className="font-semibold text-sm sm:text-base text-gray-700">
                          {format(startTime, 'yyyy. MMMM d. EEEE, HH:mm', { locale: hu })}
                        </span>
                        {getStatusBadge(appointment)}
                      </div>
                      {appointment.dentistName && (
                        <p className="text-xs sm:text-sm text-gray-600 mb-1 truncate">
                          Orvos: {appointment.dentistName}
                        </p>
                      )}
                      {(appointment.cim || appointment.teremszam) && (
                        <div className="flex items-center gap-1 text-xs sm:text-sm text-gray-600">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">
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
          
          {/* Pagination */}
          {totalPastPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-gray-200">
              <div className="text-xs sm:text-sm text-gray-600">
                {startIndex + 1}-{Math.min(endIndex, pastAppointments.length)} / {pastAppointments.length} időpont
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  onClick={() => setPastAppointmentsPage(prev => Math.max(1, prev - 1))}
                  disabled={pastAppointmentsPage === 1}
                  className="px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  <ChevronLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="hidden xs:inline">Előző</span>
                </button>
                <div className="flex items-center gap-0.5 sm:gap-1">
                  {Array.from({ length: totalPastPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      onClick={() => setPastAppointmentsPage(page)}
                      className={`px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium rounded-md ${
                        page === pastAppointmentsPage
                          ? 'bg-medical-primary text-white'
                          : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setPastAppointmentsPage(prev => Math.min(totalPastPages, prev + 1))}
                  disabled={pastAppointmentsPage === totalPastPages}
                  className="px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  <span className="hidden xs:inline">Következő</span>
                  <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {appointments.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 sm:p-12 text-center">
          <Calendar className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 text-gray-300" />
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-2">
            Nincsenek időpontok
          </h3>
          <p className="text-sm sm:text-base text-gray-600 mb-4 sm:mb-6">
            Még nincs rögzített időpontja. Kérjen új időpontot az "Új időpont kérése" gombbal.
          </p>
          <button
            onClick={() => setShowRequestForm(true)}
            className="btn-primary inline-flex items-center gap-2 text-sm sm:text-base px-3 sm:px-4 py-1.5 sm:py-2"
          >
            <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            Új időpont kérése
          </button>
        </div>
      )}

      {/* Available Time Slots Section - Last Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">
          Szabad időpontok
        </h2>
        {loadingSlots ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-medical-primary"></div>
            <span className="ml-3 text-gray-600">Betöltés...</span>
          </div>
        ) : availableSlots.length > 0 ? (
          <div className="space-y-2 sm:space-y-3">
            {availableSlots.map((slot) => {
              const startTime = new Date(slot.startTime);
              const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
              const displayCim = slot.cim || DEFAULT_CIM;
              return (
                <div
                  key={slot.id}
                  className="p-3 sm:p-4 rounded-lg border-l-4 border-green-500 bg-white hover:bg-green-50 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2 flex-wrap">
                        <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-600 flex-shrink-0" />
                        <span className="font-semibold text-sm sm:text-base text-gray-900">
                          {format(startTime, 'yyyy. MMMM d. EEEE, HH:mm', { locale: hu })}
                        </span>
                      </div>
                      {slot.dentistName && (
                        <p className="text-xs sm:text-sm text-gray-600 mb-1 truncate">
                          Orvos: {slot.dentistName}
                        </p>
                      )}
                      <div className="flex items-center gap-1 text-xs sm:text-sm text-gray-600">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">
                          {displayCim}
                          {slot.teremszam && ` • ${slot.teremszam}. terem`}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleBookSlot(slot)}
                      className="bg-green-600 hover:bg-green-700 text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-colors flex-shrink-0 w-full sm:w-auto justify-center"
                    >
                      Foglalás
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6 sm:py-8">
            <Calendar className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-2 sm:mb-3 text-gray-300" />
            <p className="text-sm sm:text-base text-gray-600">
              Jelenleg nincs elérhető szabad időpont.
            </p>
          </div>
        )}
      </div>

      {/* Booking Modal */}
      {selectedSlot && (
        <BookingModal
          timeSlot={selectedSlot}
          onConfirm={handleConfirmBooking}
          onCancel={() => setSelectedSlot(null)}
          loading={bookingLoading}
        />
      )}

      {/* Cancellation Modal */}
      {cancellingAppointment && (
        <CancellationModal
          appointment={cancellingAppointment}
          onConfirm={handleConfirmCancellation}
          onCancel={() => setCancellingAppointment(null)}
          loading={cancellationLoading}
        />
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

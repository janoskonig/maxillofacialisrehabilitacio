'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Clock, User, Plus, CheckCircle, XCircle, AlertCircle, MessageCircle, MapPin, Mail, FileText, CheckCircle2, ClipboardList } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useToast } from '@/contexts/ToastContext';

interface Patient {
  id: string;
  nev: string | null;
  taj: string | null;
  email: string | null;
  telefonszam: string | null;
  szuletesiDatum: string | null;
  nem: string | null;
  cim: string | null;
  varos: string | null;
  iranyitoszam: string | null;
}

interface Appointment {
  id: string;
  startTime: string;
  cim: string | null;
  teremszam: string | null;
  dentistName: string | null;
  appointmentStatus: string | null;
  approvalStatus: string | null;
  approvalToken?: string | null;
}

export function PortalDashboard() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [processingAppointment, setProcessingAppointment] = useState<string | null>(null);
  const [ohipPending, setOhipPending] = useState(false);
  const [ohipTimepointLabel, setOhipTimepointLabel] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      const [patientRes, appointmentsRes] = await Promise.all([
        fetch('/api/patient-portal/patient', { credentials: 'include' }),
        fetch('/api/patient-portal/appointments', { credentials: 'include' }),
      ]);

      if (!patientRes.ok || patientRes.status === 401) {
        router.push('/patient-portal');
        return;
      }

      const patientData = await patientRes.json();
      const appointmentsData = await appointmentsRes.json();

      setPatient(patientData.patient);
      setAppointments(appointmentsData.appointments || []);

      // Fetch OHIP status
      try {
        const [ohipRes, stagesRes] = await Promise.all([
          fetch('/api/patient-portal/ohip14', { credentials: 'include' }),
          fetch('/api/patient-portal/stages/current', { credentials: 'include' }),
        ]);
        if (ohipRes.ok && stagesRes.ok) {
          const ohipData = await ohipRes.json();
          const stagesData = await stagesRes.json();
          const cs = stagesData.currentStage;
          const stageCode = cs?.stageCode ?? null;
          const dd = cs?.deliveryDate ? new Date(cs.deliveryDate) : null;
          const completedTps = (ohipData.responses || []).map((r: any) => r.timepoint);

          const { getTimepointAvailability } = await import('@/lib/ohip14-timepoint-stage');
          const { ohip14TimepointOptions } = await import('@/lib/types');
          const pending = ohip14TimepointOptions.find((tp) => {
            const avail = getTimepointAvailability(tp.value, stageCode, dd);
            return avail.allowed && !completedTps.includes(tp.value);
          });
          setOhipPending(!!pending);
          setOhipTimepointLabel(pending ? `${pending.label} – ${pending.description}` : null);
        }
      } catch (error) {
        console.error('Error fetching OHIP status:', error);
      }

      // Fetch unread message count
      if (patientData.patient?.id) {
        try {
          const messagesRes = await fetch(`/api/messages?patientId=${patientData.patient.id}`, {
            credentials: 'include',
          });
          if (messagesRes.ok) {
            const messagesData = await messagesRes.json();
            const unread = (messagesData.messages || []).filter(
              (m: any) => m.senderType === 'doctor' && !m.readAt
            ).length;
            setUnreadMessageCount(unread);
          }
        } catch (error) {
          console.error('Error fetching messages:', error);
        }
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      showToast('Hiba történt az adatok betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveAppointment = async (appointmentId: string) => {
    if (!confirm('Biztosan elfogadja ezt az időpontot?')) {
      return;
    }

    try {
      setProcessingAppointment(appointmentId);
      const response = await fetch(`/api/patient-portal/appointments/${appointmentId}/approve`, {
        method: 'POST',
        credentials: 'include',
      });

      if (response.ok) {
        showToast('Időpont sikeresen elfogadva!', 'success');
        await fetchData();
      } else {
        const data = await response.json();
        showToast(data.error || 'Hiba történt az időpont elfogadásakor', 'error');
      }
    } catch (error) {
      console.error('Error approving appointment:', error);
      showToast('Hiba történt az időpont elfogadásakor', 'error');
    } finally {
      setProcessingAppointment(null);
    }
  };

  const handleRejectAppointment = async (appointmentId: string) => {
    if (!confirm('Biztosan elutasítja ezt az időpontot?')) {
      return;
    }

    try {
      setProcessingAppointment(appointmentId);
      const response = await fetch(`/api/patient-portal/appointments/${appointmentId}/reject`, {
        method: 'POST',
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        showToast(data.message || 'Időpont elutasítva', 'success');
        await fetchData();
      } else {
        const data = await response.json();
        showToast(data.error || 'Hiba történt az időpont elutasításakor', 'error');
      }
    } catch (error) {
      console.error('Error rejecting appointment:', error);
      showToast('Hiba történt az időpont elutasításakor', 'error');
    } finally {
      setProcessingAppointment(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-medical-primary"></div>
        <span className="ml-3 text-gray-600">Betöltés...</span>
      </div>
    );
  }

  // Get status badge for appointment
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
          <span className="hidden xs:inline">Lemondva</span>
          <span className="xs:hidden">Lemondva</span>
        </span>
      );
    }
    if (appointment.approvalStatus === 'approved' && !appointment.appointmentStatus) {
      return (
        <span className="inline-flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs font-medium bg-green-100 text-green-700 rounded">
          <CheckCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
          <span className="hidden xs:inline">Élő</span>
          <span className="xs:hidden">Élő</span>
        </span>
      );
    }
    return null;
  };

  // Get next appointment
  const now = new Date();
  const nextAppointment = appointments
    .filter((apt) => {
      const startTime = new Date(apt.startTime);
      return startTime >= now && apt.approvalStatus !== 'rejected';
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Welcome */}
      <div>
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900">
          Üdvözöljük, {patient?.nev || 'Páciens'}!
        </h1>
        <p className="text-sm sm:text-base text-gray-600 mt-1 sm:mt-2">
          Itt találhatja az időpontjait, dokumentumait és egyéb információit.
        </p>
      </div>

      {/* Patient Basic Info */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <User className="w-4 h-4 sm:w-5 sm:h-5 text-medical-primary" />
          Alapadatok
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <p className="text-xs sm:text-sm text-gray-600 mb-1">Név</p>
            <p className="text-sm sm:text-base font-semibold text-gray-900">{patient?.nev || '-'}</p>
          </div>
          <div>
            <p className="text-xs sm:text-sm text-gray-600 mb-1 flex items-center gap-1">
              <Mail className="w-3.5 h-3.5" />
              Email cím
            </p>
            <p className="text-sm sm:text-base font-semibold text-gray-900">{patient?.email || '-'}</p>
          </div>
          <div>
            <p className="text-xs sm:text-sm text-gray-600 mb-1">TAJ szám</p>
            <p className="text-sm sm:text-base font-semibold text-gray-900">{patient?.taj || '-'}</p>
          </div>
        </div>
      </div>

      {/* Next Appointment Card */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="p-1.5 sm:p-2 bg-blue-50 rounded-lg flex-shrink-0">
            <Calendar className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 text-blue-600" />
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm text-gray-600 truncate">Következő időpont</p>
            {nextAppointment ? (
              <p className="text-sm sm:text-base lg:text-lg font-bold text-gray-900 truncate">
                {format(new Date(nextAppointment.startTime), 'MMM d.', { locale: hu })}
              </p>
            ) : (
              <p className="text-sm sm:text-base text-gray-500 truncate">Nincs</p>
            )}
          </div>
        </div>
      </div>

      {/* Next Appointment - Detailed */}
      {nextAppointment && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-medical-primary" />
              Következő időpont
            </h2>
            <a
              href="/patient-portal/appointments"
              className="text-xs sm:text-sm text-medical-primary hover:underline whitespace-nowrap"
            >
              Összes megtekintése
            </a>
          </div>

          <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2 mb-2 flex-wrap">
                  <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-gray-500 flex-shrink-0" />
                  <span className="font-semibold text-base sm:text-lg text-gray-900">
                    {format(new Date(nextAppointment.startTime), 'yyyy. MMMM d. EEEE, HH:mm', { locale: hu })}
                  </span>
                  {getStatusBadge(nextAppointment)}
                </div>
                {nextAppointment.dentistName && (
                  <p className="text-sm sm:text-base text-gray-700 mb-1">
                    <span className="font-medium">Orvos:</span> {nextAppointment.dentistName}
                  </p>
                )}
                {(nextAppointment.cim || nextAppointment.teremszam) && (
                  <div className="flex items-center gap-1 text-sm sm:text-base text-gray-600">
                    <MapPin className="w-4 h-4 flex-shrink-0" />
                    <span>
                      {nextAppointment.cim}
                      {nextAppointment.teremszam && ` • ${nextAppointment.teremszam}. terem`}
                    </span>
                  </div>
                )}
                {nextAppointment.approvalStatus === 'pending' && (
                  <div className="mt-3 pt-3 border-t border-gray-300 flex flex-col sm:flex-row gap-2">
                    <button
                      onClick={() => handleApproveAppointment(nextAppointment.id)}
                      disabled={processingAppointment === nextAppointment.id}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
                      {processingAppointment === nextAppointment.id ? 'Feldolgozás...' : 'Elfogadom'}
                    </button>
                    <button
                      onClick={() => handleRejectAppointment(nextAppointment.id)}
                      disabled={processingAppointment === nextAppointment.id}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base transition-colors"
                    >
                      <XCircle className="w-4 h-4 sm:w-5 sm:h-5" />
                      {processingAppointment === nextAppointment.id ? 'Feldolgozás...' : 'Elutasítom'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Messages Card */}
      <div className="mobile-card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 flex items-center gap-2">
            <MessageCircle className="w-4 h-4 sm:w-5 sm:h-5 text-medical-primary" />
            Üzenetek
          </h2>
          {unreadMessageCount > 0 && (
            <span className="px-2 py-1 text-xs font-semibold text-white bg-red-500 rounded-full">
              {unreadMessageCount}
            </span>
          )}
        </div>
        <p className="text-sm sm:text-base text-gray-600 mb-4">
          {unreadMessageCount > 0
            ? `${unreadMessageCount} olvasatlan üzenet`
            : 'Nincs olvasatlan üzenet'}
        </p>
        <button
          onClick={() => router.push('/patient-portal/messages')}
          className="btn-primary w-full sm:w-auto flex items-center gap-2 text-sm sm:text-base px-4 sm:px-6 py-2 sm:py-2.5 mobile-touch-target justify-center"
        >
          <MessageCircle className="w-4 h-4 sm:w-5 sm:h-5" />
          Üzenetek megtekintése
        </button>
      </div>

      {/* OHIP-14 Card */}
      <div className="mobile-card">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
              <ClipboardList className="w-4 h-4 sm:w-5 sm:h-5 text-medical-primary" />
              OHIP-14 Kérdőív
            </h2>
            {ohipPending ? (
              <p className="text-sm sm:text-base text-amber-700 font-medium">
                Kitöltendő kérdőív: {ohipTimepointLabel}
              </p>
            ) : (
              <p className="text-sm sm:text-base text-gray-600">
                Jelenleg nincs kitöltendő kérdőív
              </p>
            )}
          </div>
          {ohipPending && (
            <button
              onClick={() => router.push('/patient-portal/ohip14')}
              className="btn-primary flex items-center gap-2 text-sm sm:text-base px-4 sm:px-6 py-2 sm:py-2.5 w-full sm:w-auto mobile-touch-target justify-center"
            >
              <ClipboardList className="w-4 h-4 sm:w-5 sm:h-5" />
              Kérdőív kitöltése
            </button>
          )}
        </div>
      </div>

      {/* Document Upload Button */}
      <div className="mobile-card">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
              <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-medical-primary" />
              Dokumentumok
            </h2>
            <p className="text-sm sm:text-base text-gray-600">
              Töltse fel a szükséges dokumentumokat (OP, önarckép, zárójelentés, ambuláns lap)
            </p>
          </div>
          <button
            onClick={() => router.push('/patient-portal/documents')}
            className="btn-primary flex items-center gap-2 text-sm sm:text-base px-4 sm:px-6 py-2 sm:py-2.5 w-full sm:w-auto mobile-touch-target justify-center"
          >
            <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
            Dokumentumok feltöltése
          </button>
        </div>
      </div>
    </div>
  );
}

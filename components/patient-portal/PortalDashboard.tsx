'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, FileText, Clock, User, Plus, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
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
}

interface Document {
  id: string;
  filename: string;
  uploadedAt: string;
  description: string | null;
}

export function PortalDashboard() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        const [patientRes, appointmentsRes, documentsRes] = await Promise.all([
          fetch('/api/patient-portal/patient', { credentials: 'include' }),
          fetch('/api/patient-portal/appointments', { credentials: 'include' }),
          fetch('/api/patient-portal/documents', { credentials: 'include' }),
        ]);

        if (!patientRes.ok || patientRes.status === 401) {
          router.push('/patient-portal');
          return;
        }

        const patientData = await patientRes.json();
        const appointmentsData = await appointmentsRes.json();
        const documentsData = await documentsRes.json();

        setPatient(patientData.patient);
        setAppointments(appointmentsData.appointments || []);
        setDocuments(documentsData.documents || []);
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
        showToast('Hiba történt az adatok betöltésekor', 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [router, showToast]);

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
          Lemondva
        </span>
      );
    }
    // If approved and no appointment status, show as active
    if (appointment.approvalStatus === 'approved' && !appointment.appointmentStatus) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded">
          <CheckCircle className="w-3 h-3" />
          Élő
        </span>
      );
    }
    return null;
  };

  // Get upcoming appointments (next 3)
  const now = new Date();
  const upcomingAppointments = appointments
    .filter((apt) => {
      const startTime = new Date(apt.startTime);
      return startTime >= now && apt.approvalStatus !== 'rejected';
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(0, 3);

  // Get recent documents (last 5)
  const recentDocuments = documents.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
          Üdvözöljük, {patient?.nev || 'Páciens'}!
        </h1>
        <p className="text-gray-600 mt-2">
          Itt találhatja az időpontjait, dokumentumait és egyéb információit.
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Calendar className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Következő időpontok</p>
              <p className="text-2xl font-bold text-gray-900">
                {upcomingAppointments.length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-50 rounded-lg">
              <FileText className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Dokumentumok</p>
              <p className="text-2xl font-bold text-gray-900">
                {documents.length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-50 rounded-lg">
              <User className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">TAJ szám</p>
              <p className="text-lg font-bold text-gray-900">
                {patient?.taj || '-'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Upcoming Appointments */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-medical-primary" />
            Következő időpontok
          </h2>
          <a
            href="/patient-portal/appointments"
            className="text-sm text-medical-primary hover:underline"
          >
            Összes megtekintése
          </a>
        </div>

        {upcomingAppointments.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Calendar className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">Nincsenek közelgő időpontok</p>
            <a
              href="/patient-portal/appointments"
              className="btn-primary mt-4 inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Új időpont kérése
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {upcomingAppointments.map((appointment) => {
              const startTime = new Date(appointment.startTime);
              const isPending = appointment.approvalStatus === 'pending';
              const isCancelled = appointment.appointmentStatus === 'cancelled_by_doctor' || appointment.appointmentStatus === 'cancelled_by_patient';

              return (
                <div
                  key={appointment.id}
                  className={`p-4 rounded-lg border ${
                    isPending
                      ? 'border-orange-200 bg-orange-50'
                      : isCancelled
                      ? 'border-gray-200 bg-gray-50 opacity-75'
                      : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Clock className="w-4 h-4 text-gray-500" />
                        <span className="font-semibold text-gray-900">
                          {format(startTime, 'yyyy. MMMM d. HH:mm', { locale: hu })}
                        </span>
                        {getStatusBadge(appointment)}
                      </div>
                      {appointment.dentistName && (
                        <p className="text-sm text-gray-600">
                          Orvos: {appointment.dentistName}
                        </p>
                      )}
                      {(appointment.cim || appointment.teremszam) && (
                        <p className="text-sm text-gray-600">
                          {appointment.cim}
                          {appointment.teremszam && ` • ${appointment.teremszam}. terem`}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Documents */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-medical-primary" />
            Legutóbbi dokumentumok
          </h2>
          <a
            href="/patient-portal/documents"
            className="text-sm text-medical-primary hover:underline"
          >
            Összes megtekintése
          </a>
        </div>

        {recentDocuments.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <FileText className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">Nincsenek dokumentumok</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentDocuments.map((doc) => (
              <div
                key={doc.id}
                className="p-3 rounded-lg border border-gray-200 hover:bg-gray-50"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {doc.filename}
                    </p>
                    {doc.description && (
                      <p className="text-sm text-gray-600 truncate">
                        {doc.description}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      {format(new Date(doc.uploadedAt), 'yyyy. MMMM d.', { locale: hu })}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}









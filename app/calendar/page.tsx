'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, logout, type AuthUser } from '@/lib/auth';
import { CalendarView } from '@/components/CalendarView';
import { Logo } from '@/components/Logo';
import { LogOut, Shield, Settings, ArrowLeft, Download, Edit2, X, Calendar } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { MobileMenu } from '@/components/MobileMenu';
import { FeedbackButtonTrigger } from '@/components/FeedbackButton';

interface Appointment {
  id: string;
  startTime: string;
  patientName: string | null;
  patientTaj: string | null;
  dentistEmail: string;
  dentistName?: string | null;
  appointmentStatus?: 'cancelled_by_doctor' | 'cancelled_by_patient' | 'completed' | 'no_show' | null;
  isLate?: boolean;
  cim?: string | null;
  teremszam?: string | null;
  patientId?: string;
}

export default function CalendarPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    const checkAuth = async () => {
      const user = await getCurrentUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setCurrentUser(user);
      setAuthorized(true);
      setLoading(false);
    };
    checkAuth();
  }, [router]);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const handleAppointmentClick = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
  };

  const handleDownloadCalendar = async (appointmentId: string) => {
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
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showToast('Naptár fájl letöltve', 'success');
      } else {
        showToast('Hiba történt a letöltés során', 'error');
      }
    } catch (error) {
      console.error('Error downloading calendar:', error);
      showToast('Hiba történt a letöltés során', 'error');
    }
  };

  const handleViewPatient = () => {
    if (selectedAppointment?.patientId) {
      router.push(`/?patientId=${selectedAppointment.patientId}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Betöltés...</p>
      </div>
    );
  }

  if (!authorized) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-2 md:py-4">
            <div className="flex items-center gap-2 md:gap-4 flex-1 min-w-0">
              <Logo width={40} height={46} className="md:w-[80px] md:h-[92px] flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <h1 className="text-base md:text-2xl font-bold text-medical-primary truncate">
                  Maxillofaciális Rehabilitáció
                </h1>
                <p className="text-xs md:text-sm text-gray-600 mt-0.5 hidden sm:block">
                  NAPTÁR
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <MobileMenu currentPath="/calendar" showBackButton={true} />
              <div className="hidden md:flex gap-2">
                <FeedbackButtonTrigger />
                {currentUser?.role === 'admin' && (
                  <button
                    onClick={() => router.push('/admin')}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <Shield className="w-4 h-4" />
                    Admin
                  </button>
                )}
                <button
                  onClick={() => router.push('/settings')}
                  className="btn-secondary flex items-center gap-2"
                >
                  <Settings className="w-4 h-4" />
                  Beállítások
                </button>
                <button
                  onClick={handleLogout}
                  className="btn-secondary flex items-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Kijelentkezés
                </button>
                <button
                  onClick={() => router.push('/')}
                  className="btn-secondary flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Vissza
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Link to time slots management page for fogpótlástanász and admin */}
          {currentUser && (currentUser.role === 'fogpótlástanász' || currentUser.role === 'admin') && (
            <div className="card card-hover p-4 bg-gradient-to-r from-medical-primary/5 to-medical-accent/5 border-medical-primary/20">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                <div>
                  <h3 className="text-heading-4">Időpontkezelés</h3>
                  <p className="text-body-sm mt-1">
                    Hozzon létre és kezeljen szabad időpontokat
                  </p>
                </div>
                <button
                  onClick={() => router.push('/time-slots')}
                  className="btn-primary w-full sm:w-auto flex items-center justify-center gap-1.5 text-sm px-4 py-2.5"
                >
                  <Calendar className="w-4 h-4" />
                  Időpontok kezelése
                </button>
              </div>
            </div>
          )}

          {/* Google Calendar Settings Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Settings className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-blue-900">
                  A Google Naptár beállítása a{' '}
                  <button
                    onClick={() => router.push('/settings')}
                    className="text-blue-700 hover:text-blue-900 underline font-medium"
                  >
                    Beállítások
                  </button>
                  {' '}oldalon érhető el.
                </p>
              </div>
            </div>
          </div>

          <CalendarView onAppointmentClick={handleAppointmentClick} />
        </div>
      </main>

      {/* Appointment Details Modal */}
      {selectedAppointment && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-0 md:p-4 z-50"
          onClick={() => setSelectedAppointment(null)}
        >
          <div
            className="bg-white rounded-none md:rounded-lg max-w-md w-full h-full md:h-auto max-h-[100vh] md:max-h-[90vh] overflow-y-auto p-4 md:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Időpont részletei</h3>
              <button
                onClick={() => setSelectedAppointment(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500">Beteg neve</label>
                <p className="text-sm text-gray-900 mt-1">
                  {selectedAppointment.patientName || 'Név nélküli'}
                </p>
              </div>

              {selectedAppointment.patientTaj && (
                <div>
                  <label className="text-xs font-medium text-gray-500">TAJ szám</label>
                  <p className="text-sm text-gray-900 mt-1">
                    {selectedAppointment.patientTaj}
                  </p>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-500">Időpont</label>
                <p className="text-sm text-gray-900 mt-1">
                  {new Date(selectedAppointment.startTime).toLocaleString('hu-HU', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>

              {selectedAppointment.dentistName && (
                <div>
                  <label className="text-xs font-medium text-gray-500">Fogpótlástanász</label>
                  <p className="text-sm text-gray-900 mt-1">
                    {selectedAppointment.dentistName}
                  </p>
                </div>
              )}

              {selectedAppointment.cim && (
                <div>
                  <label className="text-xs font-medium text-gray-500">Cím</label>
                  <p className="text-sm text-gray-900 mt-1">
                    {selectedAppointment.cim}
                    {selectedAppointment.teremszam && ` (Terem: ${selectedAppointment.teremszam})`}
                  </p>
                </div>
              )}

              {selectedAppointment.appointmentStatus && (
                <div>
                  <label className="text-xs font-medium text-gray-500">Státusz</label>
                  <p className="text-sm text-gray-900 mt-1">
                    {selectedAppointment.appointmentStatus === 'completed' && 'Teljesült'}
                    {selectedAppointment.appointmentStatus === 'cancelled_by_doctor' && 'Lemondva (orvos)'}
                    {selectedAppointment.appointmentStatus === 'cancelled_by_patient' && 'Lemondva (beteg)'}
                    {selectedAppointment.appointmentStatus === 'no_show' && 'Nem jelent meg'}
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 mt-6">
              {selectedAppointment.patientId && (
                <button
                  onClick={handleViewPatient}
                  className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm py-2.5"
                >
                  <Edit2 className="w-4 h-4" />
                  Beteg megtekintése
                </button>
              )}
              <button
                onClick={() => handleDownloadCalendar(selectedAppointment.id)}
                className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm py-2.5"
              >
                <Download className="w-4 h-4" />
                Naptár letöltése
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


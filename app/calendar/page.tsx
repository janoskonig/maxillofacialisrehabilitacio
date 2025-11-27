'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, logout, type AuthUser } from '@/lib/auth';
import { CalendarView } from '@/components/CalendarView';
import { Logo } from '@/components/Logo';
import { LogOut, Shield, Settings, ArrowLeft, Download, Edit2, X } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

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
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center gap-4">
              <Logo width={80} height={92} />
              <div>
                <h1 className="text-2xl font-bold text-medical-primary">
                  Maxillofaciális Rehabilitáció
                </h1>
                <p className="text-sm text-gray-600 mt-1">
                  NAPTÁR
                </p>
              </div>
            </div>
            <div className="flex gap-2">
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
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <CalendarView onAppointmentClick={handleAppointmentClick} />
      </main>

      {/* Appointment Details Modal */}
      {selectedAppointment && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedAppointment(null)}
        >
          <div
            className="bg-white rounded-lg max-w-md w-full p-6"
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

            <div className="flex gap-2 mt-6">
              {selectedAppointment.patientId && (
                <button
                  onClick={handleViewPatient}
                  className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm"
                >
                  <Edit2 className="w-4 h-4" />
                  Beteg megtekintése
                </button>
              )}
              <button
                onClick={() => handleDownloadCalendar(selectedAppointment.id)}
                className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm"
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


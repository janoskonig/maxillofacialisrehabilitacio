'use client';

import { useState, useEffect } from 'react';
import { Calendar, Clock, Download, CheckCircle2 } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';

interface TimeSlot {
  id: string;
  startTime: string;
  status: 'available' | 'booked';
  userEmail?: string;
}

interface Appointment {
  id: string;
  patientId: string;
  timeSlotId: string;
  startTime: string;
  dentistEmail: string | null;
}

interface AppointmentBookingSectionProps {
  patientId: string | null | undefined;
  isViewOnly?: boolean;
}

export function AppointmentBookingSection({ patientId, isViewOnly = false }: AppointmentBookingSectionProps) {
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [userRole, setUserRole] = useState<string>('');
  const [roleLoaded, setRoleLoaded] = useState(false);

  const loadAvailableSlots = async () => {
    try {
      const response = await fetch('/api/time-slots', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setAvailableSlots(data.timeSlots || []);
      }
    } catch (error) {
      console.error('Error loading time slots:', error);
    }
  };

  const loadAppointments = async () => {
    if (!patientId) return;
    
    try {
      const response = await fetch('/api/appointments', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        // Filter appointments for this patient
        const patientAppointments = (data.appointments || []).filter(
          (apt: Appointment) => apt.patientId === patientId
        );
        setAppointments(patientAppointments);
      }
    } catch (error) {
      console.error('Error loading appointments:', error);
    }
  };

  const loadData = async () => {
    if (!patientId) return;
    
    try {
      setLoading(true);
      await Promise.all([
        loadAvailableSlots(),
        loadAppointments(),
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialize = async () => {
      setLoading(true);
      
      // Check role
      const user = await getCurrentUser();
      if (user) {
        setUserRole(user.role);
        setRoleLoaded(true);
      } else {
        setRoleLoaded(true);
      }
      
      // Load time slots even if patientId is not available (for new patients)
      await loadAvailableSlots();
      
      // Load appointments if patientId exists
      if (patientId) {
        await loadAppointments();
      }
      
      setLoading(false);
    };
    
    initialize();
  }, [patientId]);

  const handleBookAppointment = async () => {
    if (!patientId || !selectedSlot) {
      alert('Kérjük, válasszon időpontot!');
      return;
    }

    if (!confirm('Biztosan le szeretné foglalni ezt az időpontot?')) {
      return;
    }

    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          patientId: patientId,
          timeSlotId: selectedSlot,
        }),
      });

      if (response.ok) {
        await loadData();
        setSelectedSlot('');
        alert('Időpont sikeresen lefoglalva! A fogpótlástanász értesítést kapott.');
      } else {
        const data = await response.json();
        alert(data.error || 'Hiba történt az időpont foglalásakor');
      }
    } catch (error) {
      console.error('Error booking appointment:', error);
      alert('Hiba történt az időpont foglalásakor');
    }
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
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        alert('Hiba történt a naptár fájl letöltésekor');
      }
    } catch (error) {
      console.error('Error downloading calendar:', error);
      alert('Hiba történt a naptár fájl letöltésekor');
    }
  };

  const formatDateTime = (dateTime: string) => {
    const date = new Date(dateTime);
    return date.toLocaleString('hu-HU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Only show for surgeons and admins
  // Wait for role to load before making decision
  if (!roleLoaded) {
    // Still loading role, show nothing for now
    return null;
  }
  
  // Role is loaded, check if user is surgeon or admin
  if (userRole !== 'sebészorvos' && userRole !== 'admin') {
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
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-5 h-5 text-medical-primary" />
        <h3 className="text-lg font-semibold text-gray-900">Időpont foglalás</h3>
      </div>

      {/* Existing Appointments */}
      {appointments.length > 0 && (
        <div className="mb-6">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Lefoglalt időpontok</h4>
          <div className="space-y-2">
            {appointments.map((appointment) => (
              <div
                key={appointment.id}
                className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-md"
              >
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {formatDateTime(appointment.startTime)}
                    </div>
                    <div className="text-xs text-gray-500">
                      Fogpótlástanász: {appointment.dentistEmail || 'Nincs megadva'}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDownloadCalendar(appointment.id)}
                  className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  title="Naptár fájl letöltése"
                >
                  <Download className="w-4 h-4" />
                  .ics
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Book New Appointment */}
      {!isViewOnly && (
        <div className="space-y-4">
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
                {availableSlotsOnly.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {formatDateTime(slot.startTime)} {slot.userEmail ? `- ${slot.userEmail}` : ''}
                  </option>
                ))}
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
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
              <div className="text-sm text-gray-700">
                <span className="font-medium">Kiválasztott időpont:</span>{' '}
                {formatDateTime(availableSlotsOnly.find(s => s.id === selectedSlot)?.startTime || '')}
              </div>
              {availableSlotsOnly.find(s => s.id === selectedSlot)?.userEmail && (
                <div className="text-sm text-gray-600 mt-1">
                  <span className="font-medium">Fogpótlástanász:</span>{' '}
                  {availableSlotsOnly.find(s => s.id === selectedSlot)?.userEmail}
                </div>
              )}
            </div>
          )}
          {availableSlotsOnly.length > 0 && (
            <button
              onClick={handleBookAppointment}
              disabled={!selectedSlot || isViewOnly}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <Clock className="w-4 h-4" />
              Időpont foglalása
            </button>
          )}
        </div>
      )}
    </div>
  );
}


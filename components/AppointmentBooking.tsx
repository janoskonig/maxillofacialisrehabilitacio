'use client';

import { useState, useEffect } from 'react';
import { Calendar, Clock, Download, User, Phone } from 'lucide-react';
import { Patient } from '@/lib/types';

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
  patientName: string | null;
  patientTaj: string | null;
  dentistEmail: string;
}

export function AppointmentBooking() {
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<string>('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      await Promise.all([
        loadAvailableSlots(),
        loadAppointments(),
        loadPatients(),
      ]);
    } finally {
      setLoading(false);
    }
  };

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
    try {
      const response = await fetch('/api/appointments', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setAppointments(data.appointments || []);
      }
    } catch (error) {
      console.error('Error loading appointments:', error);
    }
  };

  const loadPatients = async () => {
    try {
      const response = await fetch('/api/patients', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setPatients(data.patients || []);
      }
    } catch (error) {
      console.error('Error loading patients:', error);
    }
  };

  const handleBookAppointment = async () => {
    if (!selectedPatient || !selectedSlot) {
      alert('Kérjük, válasszon beteget és időpontot!');
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
          patientId: selectedPatient,
          timeSlotId: selectedSlot,
        }),
      });

      if (response.ok) {
        await loadData();
        setSelectedPatient('');
        setSelectedSlot('');
        alert('Időpont sikeresen lefoglalva! A fogpótlástanász és a beteg (ha van email-címe) értesítést kapott.');
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

  if (loading) {
    return (
      <div className="card text-center py-8">
        <p className="text-gray-500">Betöltés...</p>
      </div>
    );
  }

  const availableSlotsOnly = availableSlots.filter(slot => slot.status === 'available');

  return (
    <div className="space-y-6">
      {/* Book New Appointment */}
      <div className="card p-6">
        <h3 className="text-xl font-bold text-gray-900 mb-4">Új időpont foglalása</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Beteg
            </label>
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
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Szabad időpont
            </label>
            <select
              value={selectedSlot}
              onChange={(e) => setSelectedSlot(e.target.value)}
              className="form-input w-full"
            >
              <option value="">Válasszon időpontot...</option>
              {availableSlotsOnly.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {formatDateTime(slot.startTime)}
                </option>
              ))}
            </select>
            {availableSlotsOnly.length === 0 && (
              <p className="text-sm text-gray-500 mt-2">
                Jelenleg nincs elérhető szabad időpont.
              </p>
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

      {/* My Appointments */}
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
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Beteg
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Időpont
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Fogpótlástanász
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Műveletek
                  </th>
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
                            <div className="text-sm text-gray-500">
                              TAJ: {appointment.patientTaj}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Clock className="w-4 h-4 text-gray-400 mr-2" />
                        <span className="text-sm text-gray-900">
                          {formatDateTime(appointment.startTime)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-gray-500">
                        {appointment.dentistEmail}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleDownloadCalendar(appointment.id)}
                        className="text-blue-600 hover:text-blue-900 flex items-center gap-1"
                        title="Naptár fájl letöltése"
                      >
                        <Download className="w-4 h-4" />
                        .ics
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

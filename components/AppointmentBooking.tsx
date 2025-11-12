'use client';

import { useState, useEffect } from 'react';
import { Calendar, Clock, Download, User, Phone, Trash2, Edit2, X } from 'lucide-react';
import { Patient } from '@/lib/types';

interface TimeSlot {
  id: string;
  startTime: string;
  status: 'available' | 'booked';
  cim?: string | null;
  teremszam?: string | null;
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
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [newTimeSlotId, setNewTimeSlotId] = useState<string>('');

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
        const allSlots = data.timeSlots || [];
        // Csak a jövőbeli időpontokat jelenítjük meg (4 óra késleltetéssel)
        const now = new Date();
        const fourHoursFromNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);
        const futureSlots = allSlots.filter((slot: TimeSlot) => 
          new Date(slot.startTime) >= fourHoursFromNow
        );
        setAvailableSlots(futureSlots);
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

  const handleCancelAppointment = async (appointmentId: string) => {
    if (!confirm('Biztosan le szeretné mondani ezt az időpontot? A fogpótlástanász és a beteg értesítést kap.')) {
      return;
    }

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
  };

  const handleModifyAppointment = (appointment: Appointment) => {
    setEditingAppointment(appointment);
    setNewTimeSlotId('');
  };

  const handleSaveModification = async () => {
    if (!editingAppointment || !newTimeSlotId) {
      alert('Kérjük, válasszon új időpontot!');
      return;
    }

    if (!confirm('Biztosan módosítani szeretné ezt az időpontot? A fogpótlástanász és a beteg értesítést kap.')) {
      return;
    }

    try {
      const response = await fetch(`/api/appointments/${editingAppointment.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          timeSlotId: newTimeSlotId,
        }),
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
  // For modification, exclude the current appointment's time slot
  const availableSlotsForModification = availableSlotsOnly.filter(
    slot => !editingAppointment || slot.id !== editingAppointment.timeSlotId
  );

  return (
    <div className="space-y-6">
      {/* Modification Modal */}
      {editingAppointment && (
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
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Új időpont
                </label>
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
                  <p className="text-sm text-gray-500 mt-2">
                    Jelenleg nincs elérhető szabad időpont.
                  </p>
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
                <button
                  onClick={handleSaveModification}
                  disabled={!newTimeSlotId}
                  className="btn-primary"
                >
                  Módosítás mentése
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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
                  {slot.cim ? ` - ${slot.cim}` : ''}
                  {slot.teremszam ? ` (Terem: ${slot.teremszam})` : ''}
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
      </div>
    </div>
  );
}

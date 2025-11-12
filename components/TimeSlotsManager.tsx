'use client';

import { useState, useEffect } from 'react';
import { Calendar, Plus, Trash2, Edit2, Clock, X, ChevronDown, ChevronUp } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { DateTimePicker } from './DateTimePicker';

interface TimeSlot {
  id: string;
  startTime: string;
  status: 'available' | 'booked';
  cim?: string | null;
  teremszam?: string | null;
  createdAt: string;
  updatedAt: string;
  userEmail?: string;
}

interface AppointmentInfo {
  id: string; // Appointment ID
  patientName: string | null;
  patientTaj: string | null;
  bookedBy: string; // Email of surgeon/admin who booked
}

interface User {
  id: string;
  email: string;
  role: string;
}

export function TimeSlotsManager() {
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [appointments, setAppointments] = useState<Record<string, AppointmentInfo>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSlot, setEditingSlot] = useState<TimeSlot | null>(null);
  const [newStartTime, setNewStartTime] = useState<Date | null>(null);
  const [newTeremszam, setNewTeremszam] = useState<string>('');
  const [modifyingAppointment, setModifyingAppointment] = useState<{ appointmentId: string; timeSlotId: string; startTime: string } | null>(null);
  const [newTimeSlotId, setNewTimeSlotId] = useState<string>('');
  const [userRole, setUserRole] = useState<string>('');
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [showPastSlots, setShowPastSlots] = useState(false);

  useEffect(() => {
    loadTimeSlots();
    loadUserRole();
  }, []);

  const loadUserRole = async () => {
    try {
      const user = await getCurrentUser();
      if (user) {
        setUserRole(user.role);
        // If admin, load users list
        if (user.role === 'admin') {
          loadUsers();
        }
      }
    } catch (error) {
      console.error('Error loading user role:', error);
    }
  };

  const loadUsers = async () => {
    try {
      const response = await fetch('/api/users', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const loadTimeSlots = async () => {
    try {
      setLoading(true);
      const [timeSlotsResponse, appointmentsResponse] = await Promise.all([
        fetch('/api/time-slots', { credentials: 'include' }),
        fetch('/api/appointments', { credentials: 'include' }),
      ]);

      if (timeSlotsResponse.ok) {
        const timeSlotsData = await timeSlotsResponse.json();
        // Get ALL time slots (both available and booked) for the current user
        setTimeSlots(timeSlotsData.timeSlots || []);
      } else {
        console.error('Failed to load time slots');
      }

      if (appointmentsResponse.ok) {
        const appointmentsData = await appointmentsResponse.json();
        // Create a map of timeSlotId -> appointment info
        const appointmentsMap: Record<string, AppointmentInfo> = {};
        (appointmentsData.appointments || []).forEach((apt: any) => {
          appointmentsMap[apt.timeSlotId] = {
            id: apt.id,
            patientName: apt.patientName,
            patientTaj: apt.patientTaj,
            bookedBy: apt.createdBy,
          };
        });
        setAppointments(appointmentsMap);
      } else {
        console.error('Failed to load appointments');
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTimeSlot = async () => {
    if (!newStartTime) {
      alert('Kérjük, válasszon dátumot és időt!');
      return;
    }

    // For admin, require user selection
    if (userRole === 'admin' && !selectedUserId) {
      alert('Kérjük, válasszon felhasználót!');
      return;
    }

    // Convert Date to ISO format with timezone offset
    // This ensures the server interprets the time correctly regardless of server timezone
    const offset = -newStartTime.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offset) / 60);
    const offsetMinutes = Math.abs(offset) % 60;
    const offsetSign = offset >= 0 ? '+' : '-';
    const offsetString = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;
    
    const year = newStartTime.getFullYear();
    const month = String(newStartTime.getMonth() + 1).padStart(2, '0');
    const day = String(newStartTime.getDate()).padStart(2, '0');
    const hours = String(newStartTime.getHours()).padStart(2, '0');
    const minutes = String(newStartTime.getMinutes()).padStart(2, '0');
    const seconds = String(newStartTime.getSeconds()).padStart(2, '0');
    const isoDateTime = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetString}`;

    try {
      // Alapértelmezett cím: "1088 Budapest, Szentkirályi utca 47"
      const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
      const requestBody: any = { 
        startTime: isoDateTime,
        cim: DEFAULT_CIM,
        teremszam: newTeremszam || null
      };
      
      // If admin and user selected, include userId
      if (userRole === 'admin' && selectedUserId) {
        requestBody.userId = selectedUserId;
      }

      const response = await fetch('/api/time-slots', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        await loadTimeSlots();
        setNewStartTime(null);
        setNewTeremszam('');
        setSelectedUserId('');
        setShowForm(false);
        alert('Időpont sikeresen létrehozva!');
      } else {
        const data = await response.json();
        alert(data.error || 'Hiba történt az időpont létrehozásakor');
      }
    } catch (error) {
      console.error('Error creating time slot:', error);
      alert('Hiba történt az időpont létrehozásakor');
    }
  };

  const handleDeleteTimeSlot = async (id: string) => {
    if (!confirm('Biztosan törölni szeretné ezt az időpontot?')) {
      return;
    }

    try {
      const response = await fetch(`/api/time-slots/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        await loadTimeSlots();
        alert('Időpont sikeresen törölve!');
      } else {
        const data = await response.json();
        alert(data.error || 'Hiba történt az időpont törlésekor');
      }
    } catch (error) {
      console.error('Error deleting time slot:', error);
      alert('Hiba történt az időpont törlésekor');
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
        await loadTimeSlots();
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

  const handleModifyAppointment = (appointmentId: string, timeSlotId: string, startTime: string) => {
    setModifyingAppointment({ appointmentId, timeSlotId, startTime });
    setNewTimeSlotId('');
  };

  const handleSaveModification = async () => {
    if (!modifyingAppointment || !newTimeSlotId) {
      alert('Kérjük, válasszon új időpontot!');
      return;
    }

    if (!confirm('Biztosan módosítani szeretné ezt az időpontot? A fogpótlástanász és a beteg értesítést kap.')) {
      return;
    }

    try {
      const response = await fetch(`/api/appointments/${modifyingAppointment.appointmentId}`, {
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
        await loadTimeSlots();
        setModifyingAppointment(null);
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

  const getMinDateTime = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 1); // At least 1 minute in the future
    return now.toISOString().slice(0, 16);
  };

  if (loading) {
    return (
      <div className="card text-center py-8">
        <p className="text-gray-500">Betöltés...</p>
      </div>
    );
  }

  // Szétválasztjuk a jövőbeli és elmúlt időpontokat
  const now = new Date();
  const futureSlots = timeSlots.filter(slot => new Date(slot.startTime) >= now);
  const pastSlots = timeSlots.filter(slot => new Date(slot.startTime) < now);

  const availableSlotsForModification = timeSlots.filter(
    slot => {
      const slotDate = new Date(slot.startTime);
      return slot.status === 'available' 
        && slotDate >= now
        && (!modifyingAppointment || slot.id !== modifyingAppointment.timeSlotId);
    }
  );

  const renderTimeSlotTable = (slots: TimeSlot[], isPast: boolean = false) => {
    if (slots.length === 0) {
      return null;
    }

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className={isPast ? "bg-gray-100" : "bg-gray-50"}>
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Időpont
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Cím
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Teremszám
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Fogpótlástanász
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Státusz
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Lefoglalva
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                Műveletek
              </th>
            </tr>
          </thead>
          <tbody className={isPast ? "bg-gray-50 divide-y divide-gray-200" : "bg-white divide-y divide-gray-200"}>
            {slots.map((slot) => {
              const appointment = appointments[slot.id];
              return (
                <tr 
                  key={slot.id} 
                  className={`${isPast ? 'opacity-60' : ''} ${
                    slot.status === 'booked' ? 'bg-red-50' : ''
                  }`}
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <Clock className={`w-4 h-4 mr-2 ${isPast ? 'text-gray-400' : 'text-gray-400'}`} />
                      <span className={`text-sm ${isPast ? 'text-gray-500' : 'text-gray-900'}`}>
                        {formatDateTime(slot.startTime)}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-sm ${isPast ? 'text-gray-500' : 'text-gray-600'}`}>
                      {slot.cim || '1088 Budapest, Szentkirályi utca 47'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`text-sm ${isPast ? 'text-gray-500' : 'text-gray-600'}`}>
                      {slot.teremszam || '-'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`text-sm ${isPast ? 'text-gray-500' : 'text-gray-600'}`}>
                      {slot.userEmail || '-'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded-full ${
                        slot.status === 'available'
                          ? isPast 
                            ? 'bg-gray-200 text-gray-600'
                            : 'bg-green-100 text-green-800'
                          : isPast
                            ? 'bg-gray-200 text-gray-600'
                            : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {slot.status === 'available' ? 'Szabad' : 'Lefoglalva'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {appointment ? (
                      <div className={`text-sm space-y-1 ${isPast ? 'text-gray-500' : ''}`}>
                        <div>
                          <span className="text-xs font-medium text-gray-500 uppercase">Beteg:</span>
                          <div className={`font-medium mt-0.5 ${isPast ? 'text-gray-500' : 'text-gray-900'}`}>
                            {appointment.patientName || 'Név nélküli beteg'}
                          </div>
                          {appointment.patientTaj && (
                            <div className="text-xs text-gray-500">
                              TAJ: {appointment.patientTaj}
                            </div>
                          )}
                        </div>
                        <div className="pt-1 border-t border-gray-200">
                          <span className="text-xs font-medium text-gray-500 uppercase">Foglalta:</span>
                          <div className={`text-xs mt-0.5 ${isPast ? 'text-gray-500' : 'text-gray-700'}`}>
                            {appointment.bookedBy}
                          </div>
                        </div>
                      </div>
                    ) : slot.status === 'booked' ? (
                      <span className={`text-sm ${isPast ? 'text-gray-500' : 'text-gray-500'}`}>Lefoglalva (adatok betöltése...)</span>
                    ) : (
                      <span className={`text-sm ${isPast ? 'text-gray-400' : 'text-gray-400'}`}>-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex items-center justify-end gap-2">
                      {slot.status === 'available' && (
                        <button
                          onClick={() => handleDeleteTimeSlot(slot.id)}
                          className={`${isPast ? 'text-gray-500 hover:text-gray-700' : 'text-red-600 hover:text-red-900'}`}
                          title="Törlés"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      {slot.status === 'booked' && appointment && (
                        <>
                          <button
                            onClick={() => handleModifyAppointment(appointment.id, slot.id, slot.startTime)}
                            className={`${isPast ? 'text-gray-500 hover:text-gray-700' : 'text-amber-600 hover:text-amber-900'} flex items-center gap-1`}
                            title="Időpont módosítása"
                          >
                            <Edit2 className="w-4 h-4" />
                            Módosítás
                          </button>
                          <button
                            onClick={() => handleCancelAppointment(appointment.id)}
                            className={`${isPast ? 'text-gray-500 hover:text-gray-700' : 'text-red-600 hover:text-red-900'} flex items-center gap-1`}
                            title="Időpont lemondása"
                          >
                            <Trash2 className="w-4 h-4" />
                            Lemondás
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Modification Modal */}
      {modifyingAppointment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">Időpont módosítása</h3>
              <button
                onClick={() => {
                  setModifyingAppointment(null);
                  setNewTimeSlotId('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-4">
                  <strong>Jelenlegi időpont:</strong> {formatDateTime(modifyingAppointment.startTime)}
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
                    setModifyingAppointment(null);
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
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-bold text-gray-900">Szabad időpontok kezelése</h3>
        <button
          onClick={() => {
            setEditingSlot(null);
            setNewStartTime(null);
            setNewTeremszam('');
            setShowForm(!showForm);
          }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Új időpont
        </button>
      </div>

      {showForm && (
        <div className="card p-4">
          <h4 className="font-medium mb-4">
            {editingSlot ? 'Időpont szerkesztése' : 'Új időpont létrehozása'}
          </h4>
          <div className="space-y-4">
            {userRole === 'admin' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Felhasználó
                </label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="form-input w-full"
                >
                  <option value="">Válasszon felhasználót...</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.email} ({user.role})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <DateTimePicker
                    selected={newStartTime}
                    onChange={(date: Date | null) => setNewStartTime(date)}
                    minDate={new Date()}
                    placeholder="Válasszon dátumot és időt"
                    className="form-input"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Teremszám
                </label>
                <input
                  type="text"
                  value={newTeremszam}
                  onChange={(e) => setNewTeremszam(e.target.value)}
                  placeholder="Pl. 101"
                  className="form-input w-full"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateTimeSlot}
                  className="btn-primary"
                >
                  Mentés
                </button>
                <button
                  onClick={() => {
                    setShowForm(false);
                    setNewStartTime(null);
                    setNewTeremszam('');
                    setSelectedUserId('');
                    setEditingSlot(null);
                  }}
                  className="btn-secondary"
                >
                  Mégse
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Jövőbeli időpontok */}
      <div className="card">
        <h4 className="text-lg font-semibold mb-4">Jövőbeli időpontok</h4>
        {futureSlots.length === 0 ? (
          <div className="text-center py-8">
            <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">Nincs jövőbeli időpont.</p>
          </div>
        ) : (
          renderTimeSlotTable(futureSlots, false)
        )}
      </div>

      {/* Elmúlt időpontok */}
      {pastSlots.length > 0 && (
        <div className="card">
          <button
            onClick={() => setShowPastSlots(!showPastSlots)}
            className="flex items-center justify-between w-full mb-4 text-left"
          >
            <h4 className="text-lg font-semibold text-gray-600">Elmúlt időpontok</h4>
            {showPastSlots ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </button>
          {showPastSlots && renderTimeSlotTable(pastSlots, true)}
        </div>
      )}

      {timeSlots.length === 0 && (
        <div className="card">
          <div className="text-center py-8">
            <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">Még nincs létrehozva időpont.</p>
          </div>
        </div>
      )}
    </div>
  );
}


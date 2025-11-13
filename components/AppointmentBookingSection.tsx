'use client';

import { useState, useEffect } from 'react';
import { Calendar, Clock, Download, CheckCircle2, Plus, X } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { DateTimePicker } from './DateTimePicker';
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
  dentistEmail: string | null;
  cim?: string | null;
  teremszam?: string | null;
}

interface AppointmentBookingSectionProps {
  patientId: string | null | undefined;
  isViewOnly?: boolean;
  onSavePatientBeforeBooking?: () => Promise<Patient>;
  isPatientDirty?: boolean;
  isNewPatient?: boolean;
  onPatientSaved?: (savedPatient: Patient) => void;
}

export function AppointmentBookingSection({ 
  patientId, 
  isViewOnly = false,
  onSavePatientBeforeBooking,
  isPatientDirty = false,
  isNewPatient = false,
  onPatientSaved
}: AppointmentBookingSectionProps) {
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [userRole, setUserRole] = useState<string>('');
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [showNewSlotForm, setShowNewSlotForm] = useState(false);
  const [newSlotDateTime, setNewSlotDateTime] = useState<Date | null>(null);
  const [newSlotTeremszam, setNewSlotTeremszam] = useState<string>('');
  const [newSlotCim, setNewSlotCim] = useState<string>('');
  const [customCim, setCustomCim] = useState<string>('');
  const [customTeremszam, setCustomTeremszam] = useState<string>('');
  
  // Elérhető címek (egyelőre csak egy, de később bővíthető)
  const availableCims = ['1088 Budapest, Szentkirályi utca 47'];
  const DEFAULT_CIM = availableCims[0]; // Alapértelmezett cím

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
    if (!patientId) return;
    
    try {
      // Load all appointments paginated to find all appointments for this patient
      let page = 1;
      let hasMore = true;
      const allAppointments: Appointment[] = [];
      
      while (hasMore) {
        const response = await fetch(`/api/appointments?page=${page}&limit=50`, {
          credentials: 'include',
        });
        
        if (response.ok) {
          const data = await response.json();
          const pageAppointments = data.appointments || [];
          allAppointments.push(...pageAppointments);
          
          // Check if there are more pages
          const pagination = data.pagination;
          if (pagination && page < pagination.totalPages) {
            page++;
          } else {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }
      
      // Filter appointments for this patient
      const patientAppointments = allAppointments.filter(
        (apt: Appointment) => apt.patientId === patientId
      );
      setAppointments(patientAppointments);
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
    if (!selectedSlot) {
      alert('Kérjük, válasszon időpontot!');
      return;
    }

    // Check if patient needs to be saved first
    let currentPatientId = patientId;
    if ((isNewPatient || isPatientDirty) && onSavePatientBeforeBooking) {
      try {
        const savedPatient = await onSavePatientBeforeBooking();
        currentPatientId = savedPatient.id;
        
        // Notify parent component about the saved patient
        if (onPatientSaved) {
          onPatientSaved(savedPatient);
        }
        
        // Reload data with new patient ID
        if (currentPatientId) {
          await loadAppointments();
        }
      } catch (error: any) {
        console.error('Error saving patient before booking:', error);
        const errorMessage = error instanceof Error ? error.message : 'Hiba történt a beteg mentésekor';
        alert(`Hiba a beteg mentésekor: ${errorMessage}. Az időpont foglalása megszakadt.`);
        return;
      }
    }

    if (!currentPatientId) {
      alert('Hiba: A beteg ID nem elérhető. Kérjük, mentse el először a beteg adatait.');
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
          patientId: currentPatientId,
          timeSlotId: selectedSlot,
          cim: customCim || (availableCims.length === 1 ? DEFAULT_CIM : null),
          teremszam: customTeremszam.trim() || null,
        }),
      });

      if (response.ok) {
        await loadData();
        setSelectedSlot('');
        setCustomCim('');
        setCustomTeremszam('');
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

  const handleCancelAppointment = async (appointmentId: string) => {
    if (!confirm('Biztosan le szeretné mondani ezt az időpontot?')) {
      return;
    }

    try {
      const response = await fetch(`/api/appointments/${appointmentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        await loadData();
        alert('Időpont sikeresen lemondva!');
      } else {
        const data = await response.json();
        alert(data.error || 'Hiba történt az időpont lemondásakor');
      }
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      alert('Hiba történt az időpont lemondásakor');
    }
  };

  const handleCreateAndBookNewSlot = async () => {
    if (!newSlotDateTime) {
      alert('Kérjük, válasszon dátumot és időt!');
      return;
    }

    // Check if date is in the future
    if (newSlotDateTime <= new Date()) {
      alert('Az időpont csak jövőbeli dátum lehet!');
      return;
    }

    // Check if patient needs to be saved first
    let currentPatientId = patientId;
    if ((isNewPatient || isPatientDirty) && onSavePatientBeforeBooking) {
      try {
        const savedPatient = await onSavePatientBeforeBooking();
        currentPatientId = savedPatient.id;
        
        // Notify parent component about the saved patient
        if (onPatientSaved) {
          onPatientSaved(savedPatient);
        }
        
        // Reload data with new patient ID
        if (currentPatientId) {
          await loadAppointments();
        }
      } catch (error: any) {
        console.error('Error saving patient before booking:', error);
        const errorMessage = error instanceof Error ? error.message : 'Hiba történt a beteg mentésekor';
        alert(`Hiba a beteg mentésekor: ${errorMessage}. Az időpont létrehozása megszakadt.`);
        return;
      }
    }

    if (!currentPatientId) {
      alert('Hiba: A beteg ID nem elérhető. Kérjük, mentse el először a beteg adatait.');
      return;
    }

    // Convert Date to ISO format with timezone offset
    // This ensures the server interprets the time correctly regardless of server timezone
    const offset = -newSlotDateTime.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offset) / 60);
    const offsetMinutes = Math.abs(offset) % 60;
    const offsetSign = offset >= 0 ? '+' : '-';
    const offsetString = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;
    
    const year = newSlotDateTime.getFullYear();
    const month = String(newSlotDateTime.getMonth() + 1).padStart(2, '0');
    const day = String(newSlotDateTime.getDate()).padStart(2, '0');
    const hours = String(newSlotDateTime.getHours()).padStart(2, '0');
    const minutes = String(newSlotDateTime.getMinutes()).padStart(2, '0');
    const seconds = String(newSlotDateTime.getSeconds()).padStart(2, '0');
    const isoDateTime = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetString}`;

    if (!confirm('Biztosan létre szeretné hozni ezt az időpontot és rögtön lefoglalni a betegnek?')) {
      return;
    }

    try {
      // First, create the new time slot
      const createSlotResponse = await fetch('/api/time-slots', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          startTime: isoDateTime,
          cim: newSlotCim || DEFAULT_CIM,
          teremszam: newSlotTeremszam.trim() || null,
        }),
      });

      if (!createSlotResponse.ok) {
        const errorData = await createSlotResponse.json();
        alert(errorData.error || 'Hiba történt az időpont létrehozásakor');
        return;
      }

      const slotData = await createSlotResponse.json();
      const newTimeSlotId = slotData.timeSlot.id;

      // Then, immediately book it for the patient
      const bookResponse = await fetch('/api/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          patientId: currentPatientId,
          timeSlotId: newTimeSlotId,
        }),
      });

      if (bookResponse.ok) {
        await loadData();
        setNewSlotDateTime(null);
        setNewSlotCim('');
        setNewSlotTeremszam('');
        setShowNewSlotForm(false);
        alert('Új időpont sikeresen létrehozva és lefoglalva a betegnek!');
      } else {
        const errorData = await bookResponse.json();
        alert(errorData.error || 'Hiba történt az időpont foglalásakor');
        // If booking failed, we should probably delete the created slot
        // But for now, just show the error
      }
    } catch (error) {
      console.error('Error creating and booking new slot:', error);
      alert('Hiba történt az időpont létrehozásakor vagy foglalásakor');
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

  // Only show for surgeons, admins, and fogpótlástanász
  // Wait for role to load before making decision
  if (!roleLoaded) {
    // Still loading role, show nothing for now
    return null;
  }
  
  // Role is loaded, check if user is surgeon, admin, or fogpótlástanász
  if (userRole !== 'sebészorvos' && userRole !== 'admin' && userRole !== 'fogpótlástanász') {
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
            {appointments.map((appointment) => {
              const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
              const displayCim = appointment.cim || DEFAULT_CIM;
              return (
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
                      <div>Cím: {displayCim}</div>
                      {appointment.teremszam && (
                        <div>Teremszám: {appointment.teremszam}</div>
                      )}
                      <div>Fogpótlástanász: {appointment.dentistEmail || 'Nincs megadva'}</div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDownloadCalendar(appointment.id)}
                    className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    title="Naptár fájl letöltése"
                  >
                    <Download className="w-4 h-4" />
                    .ics
                  </button>
                  {!isViewOnly && (userRole === 'sebészorvos' || userRole === 'admin' || userRole === 'fogpótlástanász') && (
                    <button
                      onClick={() => handleCancelAppointment(appointment.id)}
                      className="text-sm text-red-600 hover:text-red-800 flex items-center gap-1"
                      title="Időpont lemondása"
                    >
                      <X className="w-4 h-4" />
                      Lemondás
                    </button>
                  )}
                </div>
              </div>
            );
            })}
          </div>
        </div>
      )}

      {/* Book New Appointment */}
      {!isViewOnly && (
        <div className="space-y-4">
          {/* New slot creation for fogpótlástanász and admin */}
          {(userRole === 'fogpótlástanász' || userRole === 'admin') && (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-900">Új időpont kiírása és foglalása</h4>
                {!showNewSlotForm && (
                  <button
                    onClick={() => setShowNewSlotForm(true)}
                    className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Új időpont
                  </button>
                )}
              </div>
              {showNewSlotForm && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Dátum és idő
                    </label>
                    <DateTimePicker
                      selected={newSlotDateTime}
                      onChange={(date: Date | null) => setNewSlotDateTime(date)}
                      minDate={new Date()}
                      placeholder="Válasszon dátumot és időt"
                    />
                  </div>
                  {availableCims.length > 1 ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Cím
                      </label>
                      <select
                        value={newSlotCim || DEFAULT_CIM}
                        onChange={(e) => setNewSlotCim(e.target.value)}
                        className="form-input w-full"
                      >
                        {availableCims.map(cim => (
                          <option key={cim} value={cim}>{cim}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <input type="hidden" value={DEFAULT_CIM} />
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Teremszám
                    </label>
                    <input
                      type="text"
                      value={newSlotTeremszam}
                      onChange={(e) => setNewSlotTeremszam(e.target.value)}
                      className="form-input w-full"
                      placeholder="Pl. 611"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCreateAndBookNewSlot}
                      disabled={!newSlotDateTime}
                      className="btn-primary flex-1 flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Időpont kiírása és foglalása
                    </button>
                    <button
                      onClick={() => {
                        setShowNewSlotForm(false);
                        setNewSlotDateTime(null);
                        setNewSlotCim('');
                        setNewSlotTeremszam('');
                      }}
                      className="btn-secondary"
                    >
                      Mégse
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Existing slot selection */}
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
                {availableSlotsOnly.map((slot) => {
                  const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
                  const displayCim = slot.cim || DEFAULT_CIM;
                  return (
                    <option key={slot.id} value={slot.id}>
                      {formatDateTime(slot.startTime)}
                      {` - ${displayCim}`}
                      {slot.teremszam ? ` (Terem: ${slot.teremszam})` : ''}
                      {slot.userEmail ? ` - ${slot.userEmail}` : ''}
                    </option>
                  );
                })}
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
            <div className="space-y-3">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                <div className="text-sm text-gray-700">
                  <span className="font-medium">Kiválasztott időpont:</span>{' '}
                  {formatDateTime(availableSlotsOnly.find(s => s.id === selectedSlot)?.startTime || '')}
                </div>
                {(() => {
                  const selectedSlotData = availableSlotsOnly.find(s => s.id === selectedSlot);
                  return (
                    <>
                      {(() => {
                        const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
                        const displayCim = selectedSlotData?.cim || DEFAULT_CIM;
                        return (
                          <div className="text-sm text-gray-600 mt-1">
                            <span className="font-medium">Cím:</span> {displayCim}
                          </div>
                        );
                      })()}
                      <div className="text-sm text-gray-600 mt-1">
                        <span className="font-medium">Teremszám:</span> {selectedSlotData?.teremszam || 'Nincs megadva'}
                      </div>
                      {selectedSlotData?.userEmail && (
                        <div className="text-sm text-gray-600 mt-1">
                          <span className="font-medium">Fogpótlástanász:</span> {selectedSlotData.userEmail}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              
              {/* Cím és teremszám módosítása */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-md">
                <h5 className="text-sm font-medium text-gray-700 mb-2">Cím és teremszám módosítása (opcionális)</h5>
                <div className="space-y-2">
                  {availableCims.length > 1 ? (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Cím
                      </label>
                      <select
                        value={customCim || DEFAULT_CIM}
                        onChange={(e) => setCustomCim(e.target.value)}
                        className="form-input w-full text-sm"
                      >
                        {availableCims.map(cim => (
                          <option key={cim} value={cim}>{cim}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500">
                      <span className="font-medium">Cím:</span> {DEFAULT_CIM}
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Teremszám
                    </label>
                    <input
                      type="text"
                      value={customTeremszam}
                      onChange={(e) => setCustomTeremszam(e.target.value)}
                      className="form-input w-full text-sm"
                      placeholder={availableSlotsOnly.find(s => s.id === selectedSlot)?.teremszam || 'Pl. 611'}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
          {availableSlotsOnly.length > 0 && (
            <button
              onClick={handleBookAppointment}
              disabled={!selectedSlot || isViewOnly || (!patientId && !onSavePatientBeforeBooking)}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <Clock className="w-4 h-4" />
              {isNewPatient || isPatientDirty ? 'Beteg mentése és időpont foglalása' : 'Időpont foglalása'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}


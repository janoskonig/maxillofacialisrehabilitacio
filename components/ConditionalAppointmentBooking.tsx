'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Calendar, Clock, User, Mail, AlertCircle, Plus, X } from 'lucide-react';
import { Patient } from '@/lib/types';

interface TimeSlot {
  id: string;
  startTime: string;
  status: 'available' | 'booked';
  cim?: string | null;
  teremszam?: string | null;
  userEmail?: string;
  dentistName?: string | null;
}

interface PendingAppointment {
  id: string;
  patientId: string;
  timeSlotId: string;
  startTime: string;
  patientName: string | null;
  patientTaj: string | null;
  patientEmail: string | null;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

interface ConditionalAppointmentBookingProps {
  patientId?: string | null; // If provided, use this patient instead of selecting
  patientEmail?: string | null; // Patient email for validation
}

export function ConditionalAppointmentBooking({ patientId, patientEmail }: ConditionalAppointmentBookingProps = {}) {
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [pendingAppointments, setPendingAppointments] = useState<PendingAppointment[]>([]);
  const [rejectedAppointments, setRejectedAppointments] = useState<PendingAppointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [alternativeSlots, setAlternativeSlots] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const isLoadingRef = useRef(false);

  const loadAvailableSlots = useCallback(async () => {
    try {
      // Több oldal lekérdezése, hogy minden szabad időpontot megkapjunk
      let allSlots: TimeSlot[] = [];
      let page = 1;
      let hasMore = true;
      const limit = 100; // Nagyobb limit, hogy kevesebb kérés legyen
      const maxPages = 100; // Biztonsági limit, hogy ne legyen végtelen ciklus
      
      while (hasMore && page <= maxPages) {
        const response = await fetch(`/api/time-slots?onlyAvailable=true&page=${page}&limit=${limit}`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          const slots = data.timeSlots || [];
          allSlots = [...allSlots, ...slots];
          
          // Ellenőrizzük a paginációt: ha nincs több oldal, vagy kevesebb elemet kaptunk, akkor vége
          const pagination = data.pagination;
          if (pagination && page >= pagination.totalPages) {
            hasMore = false;
          } else if (slots.length < limit) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          hasMore = false;
        }
      }
      
      // Csak a jövőbeli időpontokat jelenítjük meg (4 óra késleltetéssel)
      const now = new Date();
      const fourHoursFromNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);
      const futureSlots = allSlots.filter((slot: TimeSlot) => 
        new Date(slot.startTime) >= fourHoursFromNow
      );
      setAvailableSlots(futureSlots);
    } catch (error) {
      console.error('Error loading time slots:', error);
    }
  }, []);

  const loadPendingAppointments = useCallback(async () => {
    try {
      const url = patientId 
        ? `/api/appointments?patientId=${patientId}`
        : '/api/appointments';
      const response = await fetch(url, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        const allAppointments = data.appointments || [];
        // Szűrjük a pending és rejected státuszú időpontokat
        const pending = allAppointments.filter((apt: any) => 
          apt.approvalStatus === 'pending'
        );
        const rejected = allAppointments.filter((apt: any) => 
          apt.approvalStatus === 'rejected'
        );
        setPendingAppointments(pending);
        setRejectedAppointments(rejected);
      }
    } catch (error) {
      console.error('Error loading appointments:', error);
    }
  }, [patientId]);

  const loadPatients = useCallback(async () => {
    // If patientId is provided, don't load patients list
    if (patientId) {
      return;
    }
    
    try {
      const response = await fetch('/api/patients', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        // Csak azokat a betegeket jelenítjük meg, akiknek van email címe
        const patientsWithEmail = (data.patients || []).filter((p: Patient) => 
          p.email && p.email.trim() !== ''
        );
        setPatients(patientsWithEmail);
      }
    } catch (error) {
      console.error('Error loading patients:', error);
    }
  }, [patientId]);

  const loadData = useCallback(async () => {
    // Prevent concurrent loads
    if (isLoadingRef.current) {
      return;
    }
    
    try {
      isLoadingRef.current = true;
      setLoading(true);
      await Promise.all([
        loadAvailableSlots(),
        loadPendingAppointments(),
        loadPatients(),
      ]);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  }, [loadAvailableSlots, loadPendingAppointments, loadPatients]);

  // Set selected patient if patientId is provided
  useEffect(() => {
    if (patientId) {
      setSelectedPatient(patientId);
    }
  }, [patientId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreatePendingAppointment = useCallback(async () => {
    const effectivePatientId = patientId || selectedPatient;
    
    if (!effectivePatientId || !selectedSlot) {
      alert('Kérjük, válasszon beteget és időpontot!');
      return;
    }

    // If patientId is provided, use patientEmail prop, otherwise check from patients list
    if (patientId) {
      if (!patientEmail || patientEmail.trim() === '') {
        alert('A betegnek nincs email címe. A feltételes időpontválasztáshoz email cím szükséges.');
        return;
      }
    } else {
      const selectedPatientData = patients.find(p => p.id === selectedPatient);
      if (!selectedPatientData || !selectedPatientData.email) {
        alert('A kiválasztott betegnek nincs email címe. A feltételes időpontválasztáshoz email cím szükséges.');
        return;
      }
    }

    if (!confirm('Biztosan létre szeretné hozni ezt a feltételes időpontot? A páciens emailben értesítést kap és jóváhagyhatja vagy elvetheti az időpontot.')) {
      return;
    }

    try {
      setCreating(true);
      const response = await fetch('/api/appointments/pending', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          patientId: effectivePatientId,
          timeSlotId: selectedSlot,
          alternativeTimeSlotIds: alternativeSlots.filter(id => id && id !== selectedSlot),
        }),
      });

      if (response.ok) {
        await loadData();
        if (!patientId) {
          setSelectedPatient('');
        }
        setSelectedSlot('');
        setAlternativeSlots([]);
        alert('Feltételes időpont sikeresen létrehozva! A páciens emailben értesítést kapott.');
      } else {
        const data = await response.json();
        alert(data.error || 'Hiba történt a feltételes időpont létrehozásakor');
      }
    } catch (error) {
      console.error('Error creating pending appointment:', error);
      alert('Hiba történt a feltételes időpont létrehozásakor');
    } finally {
      setCreating(false);
    }
  }, [patientId, patientEmail, selectedPatient, selectedSlot, alternativeSlots, patients, loadData]);

  const addAlternativeSlot = useCallback(() => {
    if (selectedSlot && !alternativeSlots.includes(selectedSlot)) {
      setAlternativeSlots([...alternativeSlots, '']);
    } else {
      setAlternativeSlots([...alternativeSlots, '']);
    }
  }, [selectedSlot, alternativeSlots]);

  const removeAlternativeSlot = useCallback((index: number) => {
    setAlternativeSlots(alternativeSlots.filter((_, i) => i !== index));
  }, [alternativeSlots]);

  const updateAlternativeSlot = useCallback((index: number, slotId: string) => {
    const newAlternatives = [...alternativeSlots];
    newAlternatives[index] = slotId;
    setAlternativeSlots(newAlternatives);
  }, [alternativeSlots]);

  const formatDateTime = useCallback((dateTime: string) => {
    const date = new Date(dateTime);
    return date.toLocaleString('hu-HU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, []);

  const availableSlotsOnly = useMemo(
    () => availableSlots.filter(slot => slot.status === 'available'),
    [availableSlots]
  );

  if (loading) {
    return (
      <div className="card text-center py-8">
        <p className="text-gray-500">Betöltés...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Create Conditional Appointment */}
      <div className="card p-6 border-l-4 border-blue-500">
        <div className="flex items-center gap-2 mb-4">
          <Mail className="w-5 h-5 text-blue-500" />
          <h3 className="text-xl font-bold text-gray-900">Feltételes időpontválasztás</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Hozzon létre egy időpontot, amelyet a páciens emailben jóváhagyhat vagy elvethet. 
          A páciens új időpontot is kérhet, ha az ajánlott időpont nem megfelelő.
        </p>
        <div className="space-y-4">
          {!patientId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Beteg (csak email címmel rendelkező betegek)
              </label>
              <select
                value={selectedPatient}
                onChange={(e) => setSelectedPatient(e.target.value)}
                className="form-input w-full"
                disabled={creating}
              >
                <option value="">Válasszon beteget...</option>
                {patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.nev || 'Név nélküli'} {patient.taj ? `(${patient.taj})` : ''} - {patient.email}
                  </option>
                ))}
              </select>
              {patients.length === 0 && (
                <p className="text-sm text-amber-600 mt-2 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  Nincs olyan beteg, akinek email címe lenne. A feltételes időpontválasztáshoz email cím szükséges.
                </p>
              )}
            </div>
          )}
          {patientId && (!patientEmail || patientEmail.trim() === '') && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded">
              <p className="text-sm text-amber-800 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                A betegnek nincs email címe. A feltételes időpontválasztáshoz email cím szükséges.
              </p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Szabad időpont
            </label>
            <select
              value={selectedSlot}
              onChange={(e) => setSelectedSlot(e.target.value)}
              className="form-input w-full"
              disabled={creating}
            >
              <option value="">Válasszon időpontot...</option>
              {availableSlotsOnly.map((slot) => {
                const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
                const displayCim = slot.cim || DEFAULT_CIM;
                return (
                  <option key={slot.id} value={slot.id}>
                    {formatDateTime(slot.startTime)}
                    {slot.dentistName ? ` - ${slot.dentistName}` : ''}
                    {` - ${displayCim}`}
                    {slot.teremszam ? ` (Terem: ${slot.teremszam})` : ''}
                    {slot.userEmail ? ` - ${slot.userEmail}` : ''}
                  </option>
                );
              })}
            </select>
            {availableSlotsOnly.length === 0 && (
              <p className="text-sm text-gray-500 mt-2">
                Jelenleg nincs elérhető szabad időpont.
              </p>
            )}
          </div>
          
          {/* Alternatív időpontok */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Alternatív időpontok (opcionális)
              </label>
              <button
                type="button"
                onClick={addAlternativeSlot}
                className="flex items-center gap-1 px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
                disabled={creating}
              >
                <Plus className="w-4 h-4" />
                Hozzáadás
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-2">
              Ha a beteg elutasítja az első időpontot, automatikusan az első alternatívát fogjuk felajánlani, majd a másodikat stb.
            </p>
            {alternativeSlots.length > 0 && (
              <div className="space-y-2">
                {alternativeSlots.map((altSlotId, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <select
                      value={altSlotId}
                      onChange={(e) => updateAlternativeSlot(index, e.target.value)}
                      className="form-input flex-1"
                      disabled={creating}
                    >
                      <option value="">Válasszon alternatív időpontot...</option>
                      {availableSlotsOnly
                        .filter(slot => slot.id !== selectedSlot && !alternativeSlots.includes(slot.id) || slot.id === altSlotId)
                        .map((slot) => {
                          const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
                          const displayCim = slot.cim || DEFAULT_CIM;
                          return (
                            <option key={slot.id} value={slot.id}>
                              {formatDateTime(slot.startTime)}
                              {slot.dentistName ? ` - ${slot.dentistName}` : ''}
                              {` - ${displayCim}`}
                              {slot.teremszam ? ` (Terem: ${slot.teremszam})` : ''}
                              {slot.userEmail ? ` - ${slot.userEmail}` : ''}
                            </option>
                          );
                        })}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeAlternativeSlot(index)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                      disabled={creating}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <button
            onClick={handleCreatePendingAppointment}
            disabled={
              (!patientId && !selectedPatient) || 
              !selectedSlot || 
              creating || 
              (!patientId && patients.length === 0) || 
              (patientId ? (!patientEmail || patientEmail.trim() === '') : false)
            }
            className="btn-primary w-full"
          >
            {creating ? 'Létrehozás...' : 'Feltételes időpont létrehozása'}
          </button>
        </div>
      </div>

      {/* Pending Appointments */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-5 h-5 text-gray-500" />
          <h3 className="text-xl font-bold text-gray-900">
            {patientId ? 'Jóváhagyásra váró időpontok (ehhez a beteghez)' : 'Jóváhagyásra váró időpontok'}
          </h3>
        </div>
        {pendingAppointments.length === 0 ? (
          <div className="text-center py-8">
            <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">Jelenleg nincs jóváhagyásra váró időpont.</p>
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
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Időpont
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Létrehozva
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Státusz
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {pendingAppointments.map((appointment) => (
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
                        <Mail className="w-4 h-4 text-gray-400 mr-2" />
                        <span className="text-sm text-gray-900">
                          {appointment.patientEmail || 'Nincs email'}
                        </span>
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
                        {new Date(appointment.createdAt).toLocaleString('hu-HU')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                        Várakozik
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Rejected Appointments */}
      {rejectedAppointments.length > 0 && (
        <div className="card mt-6">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-5 h-5 text-gray-500" />
            <h3 className="text-xl font-bold text-gray-900">
              {patientId ? 'Elutasított időpontok (ehhez a beteghez)' : 'Elutasított időpontok'}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Beteg
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Időpont
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Létrehozva
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Státusz
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {rejectedAppointments.map((appointment) => (
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
                        <Mail className="w-4 h-4 text-gray-400 mr-2" />
                        <span className="text-sm text-gray-900">
                          {appointment.patientEmail || 'Nincs email'}
                        </span>
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
                        {new Date(appointment.createdAt).toLocaleString('hu-HU')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        Elutasítva
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}


'use client';

import { useState } from 'react';
import { Calendar, Clock, Download, CheckCircle2, Plus, X, XCircle, AlertCircle, Clock as ClockIcon, Edit2 } from 'lucide-react';
import { formatDateTime, digitsOnly } from '@/lib/dateUtils';
import { DateTimePicker } from './DateTimePicker';
import { Patient } from '@/lib/types';
import {
  useAppointmentBooking,
  type Appointment,
  type AppointmentType,
} from '@/hooks/useAppointmentBooking';

interface AppointmentBookingSectionProps {
  patientId: string | null | undefined;
  episodeId?: string | null;
  pool?: 'consult' | 'work' | 'control';
  isViewOnly?: boolean;
  onSavePatientBeforeBooking?: () => Promise<Patient>;
  isPatientDirty?: boolean;
  isNewPatient?: boolean;
  onPatientSaved?: (savedPatient: Patient) => void;
}

export function AppointmentBookingSection({ 
  patientId, 
  episodeId,
  pool = 'consult',
  isViewOnly = false,
  onSavePatientBeforeBooking,
  isPatientDirty = false,
  isNewPatient = false,
  onPatientSaved
}: AppointmentBookingSectionProps) {
  const {
    availableSlots,
    appointments,
    loading,
    userRole,
    roleLoaded,
    availableCims,
    DEFAULT_CIM,
    bookAppointment,
    cancelAppointment,
    modifyAppointment,
    updateAppointmentStatus,
    createAndBookSlot,
    downloadCalendar,
  } = useAppointmentBooking(patientId);

  // UI form state
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [showNewSlotForm, setShowNewSlotForm] = useState(false);
  const [newSlotDateTime, setNewSlotDateTime] = useState<Date | null>(null);
  const [newSlotTeremszam, setNewSlotTeremszam] = useState<string>('');
  const [newSlotCim, setNewSlotCim] = useState<string>('');
  const [newSlotAppointmentType, setNewSlotAppointmentType] = useState<AppointmentType | null>(null);
  const [customCim, setCustomCim] = useState<string>('');
  const [customTeremszam, setCustomTeremszam] = useState<string>('');
  const [selectedAppointmentType, setSelectedAppointmentType] = useState<AppointmentType | null>(null);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [newModifyDateTime, setNewModifyDateTime] = useState<Date | null>(null);
  const [newModifyTeremszam, setNewModifyTeremszam] = useState<string>('');
  const [newModifyAppointmentType, setNewModifyAppointmentType] = useState<AppointmentType | null>(null);
  const [editingStatus, setEditingStatus] = useState<Appointment | null>(null);
  const [statusForm, setStatusForm] = useState<{
    appointmentStatus: 'cancelled_by_doctor' | 'cancelled_by_patient' | 'completed' | 'no_show' | null;
    completionNotes: string;
    isLate: boolean;
    appointmentType: AppointmentType | null;
  }>({
    appointmentStatus: null,
    completionNotes: '',
    isLate: false,
    appointmentType: null,
  });

  const resolvePatientId = async (actionLabel = 'foglalása'): Promise<string | null> => {
    let currentPatientId = patientId;
    if ((isNewPatient || isPatientDirty) && onSavePatientBeforeBooking) {
      try {
        const savedPatient = await onSavePatientBeforeBooking();
        currentPatientId = savedPatient.id;
        if (onPatientSaved) {
          onPatientSaved(savedPatient);
        }
      } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : 'Hiba történt a beteg mentésekor';
        alert(`Hiba a beteg mentésekor: ${errorMessage}. Az időpont ${actionLabel} megszakadt.`);
        return null;
      }
    }
    if (!currentPatientId) {
      alert('Hiba: A beteg ID nem elérhető. Kérjük, mentse el először a beteg adatait.');
      return null;
    }
    return currentPatientId;
  };

  const handleBookAppointment = async () => {
    if (!selectedSlot) {
      alert('Kérjük, válasszon időpontot!');
      return;
    }

    const resolvedPatientId = await resolvePatientId();
    if (!resolvedPatientId) return;

    if (!confirm('Biztosan le szeretné foglalni ezt az időpontot?')) return;

    const result = await bookAppointment({
      patientId: resolvedPatientId,
      timeSlotId: selectedSlot,
      episodeId: episodeId ?? null,
      pool: pool ?? (episodeId ? 'work' : 'consult'),
      cim: customCim || (availableCims.length === 1 ? DEFAULT_CIM : null),
      teremszam: customTeremszam.trim() || null,
      appointmentType: selectedAppointmentType || null,
    });

    if (result.success) {
      setSelectedSlot('');
      setCustomCim('');
      setCustomTeremszam('');
      setSelectedAppointmentType(null);
      alert('Időpont sikeresen lefoglalva! A fogpótlástanász értesítést kapott.');
    } else {
      alert(result.error || 'Hiba történt az időpont foglalásakor');
    }
  };

  const handleDownloadCalendar = async (appointmentId: string) => {
    const result = await downloadCalendar(appointmentId);
    if (!result.success) {
      alert(result.error || 'Hiba történt a naptár fájl letöltésekor');
    }
  };

  const handleCancelAppointment = async (appointmentId: string) => {
    if (!confirm('Biztosan le szeretné mondani ezt az időpontot?')) return;

    const result = await cancelAppointment(appointmentId);
    if (result.success) {
      alert('Időpont sikeresen lemondva!');
    } else {
      alert(result.error || 'Hiba történt az időpont lemondásakor');
    }
  };

  const handleModifyAppointment = (appointment: Appointment) => {
    setEditingAppointment(appointment);
    setNewModifyDateTime(null);
    setNewModifyTeremszam('');
    setNewModifyAppointmentType(appointment.appointmentType || null);
  };

  const handleSaveModification = async () => {
    if (!editingAppointment || !newModifyDateTime) {
      alert('Kérjük, válasszon dátumot és időt!');
      return;
    }

    if (newModifyDateTime <= new Date()) {
      alert('Az időpont csak jövőbeli dátum lehet!');
      return;
    }

    if (!confirm('Biztosan módosítani szeretné ezt az időpontot? A fogpótlástanász és a beteg értesítést kap.')) return;

    const result = await modifyAppointment(editingAppointment.id, {
      startTime: newModifyDateTime,
      teremszam: newModifyTeremszam.trim() || null,
      appointmentType: newModifyAppointmentType || null,
    });

    if (result.success) {
      setEditingAppointment(null);
      setNewModifyDateTime(null);
      setNewModifyTeremszam('');
      alert('Időpont sikeresen módosítva! A fogpótlástanász és a beteg (ha van email-címe) értesítést kapott.');
    } else {
      alert(result.error || 'Hiba történt az időpont módosításakor');
    }
  };

  const handleEditStatus = (appointment: Appointment) => {
    setEditingStatus(appointment);
    setStatusForm({
      appointmentStatus: appointment.appointmentStatus || null,
      completionNotes: appointment.completionNotes || '',
      isLate: appointment.isLate || false,
      appointmentType: appointment.appointmentType || null,
    });
  };

  const handleSaveStatus = async () => {
    if (!editingStatus) return;

    if (statusForm.appointmentStatus === 'completed' && !statusForm.completionNotes.trim()) {
      alert('A "mi történt?" mező kitöltése kötelező sikeresen teljesült időpont esetén.');
      return;
    }

    const result = await updateAppointmentStatus(editingStatus.id, {
      appointmentStatus: statusForm.appointmentStatus,
      completionNotes: statusForm.appointmentStatus === 'completed' ? statusForm.completionNotes : null,
      isLate: statusForm.isLate,
      appointmentType: statusForm.appointmentType,
    });

    if (result.success) {
      setEditingStatus(null);
      setStatusForm({
        appointmentStatus: null,
        completionNotes: '',
        isLate: false,
        appointmentType: null,
      });
      alert('Időpont státusza sikeresen frissítve!');
    } else {
      alert(result.error || 'Hiba történt az időpont státuszának frissítésekor');
    }
  };

  const handleCreateAndBookNewSlot = async () => {
    if (!newSlotDateTime) {
      alert('Kérjük, válasszon dátumot és időt!');
      return;
    }

    if (newSlotDateTime <= new Date()) {
      alert('Az időpont csak jövőbeli dátum lehet!');
      return;
    }

    const resolvedPatientId = await resolvePatientId('létrehozása');
    if (!resolvedPatientId) return;

    if (!confirm('Biztosan létre szeretné hozni ezt az időpontot és rögtön lefoglalni a betegnek?')) return;

    const result = await createAndBookSlot({
      patientId: resolvedPatientId,
      startTime: newSlotDateTime,
      cim: newSlotCim || DEFAULT_CIM,
      teremszam: newSlotTeremszam.trim() || null,
      appointmentType: newSlotAppointmentType || null,
    });

    if (result.success) {
      setNewSlotDateTime(null);
      setNewSlotCim('');
      setNewSlotTeremszam('');
      setNewSlotAppointmentType(null);
      setShowNewSlotForm(false);
      alert('Új időpont sikeresen létrehozva és lefoglalva a betegnek!');
    } else {
      alert(result.error || 'Hiba történt az időpont létrehozásakor vagy foglalásakor');
    }
  };

  if (!roleLoaded) {
    return null;
  }
  
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
      {/* Modification Modal */}
      {editingAppointment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">Időpont módosítása</h3>
              <button
                onClick={() => {
                  setEditingAppointment(null);
                  setNewModifyDateTime(null);
                  setNewModifyTeremszam('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Jelenlegi időpont:</strong> {formatDateTime(editingAppointment.startTime)}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Új dátum és idő megadása
                </label>
                <DateTimePicker
                  selected={newModifyDateTime}
                  onChange={(date: Date | null) => setNewModifyDateTime(date)}
                  minDate={new Date()}
                  placeholder="Válasszon dátumot és időt"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Teremszám (opcionális)
                </label>
                <input
                  type="text"
                  value={newModifyTeremszam}
                  onChange={(e) => setNewModifyTeremszam(digitsOnly(e.target.value))}
                  className="form-input w-full"
                  placeholder="Pl. 611"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Időpont típusa
                </label>
                <select
                  value={newModifyAppointmentType || ''}
                  onChange={(e) => setNewModifyAppointmentType(e.target.value as any || null)}
                  className="form-input w-full"
                >
                  <option value="">Nincs megadva</option>
                  <option value="elso_konzultacio">Első konzultáció</option>
                  <option value="munkafazis">Munkafázis</option>
                  <option value="kontroll">Kontroll</option>
                </select>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setEditingAppointment(null);
                    setNewModifyDateTime(null);
                    setNewModifyTeremszam('');
                    setNewModifyAppointmentType(null);
                  }}
                  className="btn-secondary"
                >
                  Mégse
                </button>
                <button
                  onClick={handleSaveModification}
                  disabled={!newModifyDateTime}
                  className="btn-primary"
                >
                  Módosítás mentése
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Status Edit Modal */}
      {editingStatus && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">Időpont státusz szerkesztése</h3>
              <button
                onClick={() => {
                  setEditingStatus(null);
                  setStatusForm({
                    appointmentStatus: null,
                    completionNotes: '',
                    isLate: false,
                    appointmentType: null,
                  });
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Időpont:</strong> {formatDateTime(editingStatus.startTime)}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Státusz
                </label>
                <select
                  value={statusForm.appointmentStatus || ''}
                  onChange={(e) => {
                    const value = e.target.value || null;
                    setStatusForm({
                      ...statusForm,
                      appointmentStatus: value as any,
                      completionNotes: value === 'completed' ? statusForm.completionNotes : '',
                    });
                  }}
                  className="form-input w-full"
                >
                  <option value="">Nincs státusz (normál időpont)</option>
                  <option value="cancelled_by_doctor">Lemondta az orvos</option>
                  <option value="cancelled_by_patient">Lemondta a beteg</option>
                  <option value="completed">Sikeresen teljesült</option>
                  <option value="no_show">Nem jelent meg</option>
                </select>
              </div>
              {statusForm.appointmentStatus === 'completed' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Mi történt? <span className="text-red-600">*</span>
                  </label>
                  <textarea
                    value={statusForm.completionNotes}
                    onChange={(e) => setStatusForm({ ...statusForm, completionNotes: e.target.value })}
                    className="form-input w-full"
                    rows={3}
                    placeholder="Rövid leírás arról, hogy mi történt az időpont során..."
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Időpont típusa
                </label>
                <select
                  value={statusForm.appointmentType || ''}
                  onChange={(e) => setStatusForm({ ...statusForm, appointmentType: e.target.value as any || null })}
                  className="form-input w-full"
                >
                  <option value="">Nincs megadva</option>
                  <option value="elso_konzultacio">Első konzultáció</option>
                  <option value="munkafazis">Munkafázis</option>
                  <option value="kontroll">Kontroll</option>
                </select>
              </div>
              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={statusForm.isLate}
                    onChange={(e) => setStatusForm({ ...statusForm, isLate: e.target.checked })}
                    className="form-checkbox"
                  />
                  <span className="text-sm font-medium text-gray-700">Késett a beteg</span>
                </label>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setEditingStatus(null);
                    setStatusForm({
                      appointmentStatus: null,
                      completionNotes: '',
                      isLate: false,
                      appointmentType: null,
                    });
                  }}
                  className="btn-secondary"
                >
                  Mégse
                </button>
                <button
                  onClick={handleSaveStatus}
                  className="btn-primary"
                >
                  Mentés
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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
                      {(appointment.stepLabel || appointment.stepCode || appointment.pool) && (
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                          {(appointment.stepLabel || appointment.stepCode) && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 text-xs font-medium">
                              {appointment.stepLabel || appointment.stepCode}
                            </span>
                          )}
                          {appointment.pool && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">
                              {appointment.pool === 'consult' ? 'Konzultáció' : appointment.pool === 'work' ? 'Munka' : appointment.pool === 'control' ? 'Kontroll' : appointment.pool}
                            </span>
                          )}
                          {appointment.episodeId && (
                            <span className="text-gray-400 text-xs" title={appointment.episodeId}>
                              Epizód #{appointment.episodeId.slice(0, 8)}
                            </span>
                          )}
                        </div>
                      )}
                      <div>Cím: {displayCim}</div>
                      {appointment.teremszam && (
                        <div>Teremszám: {appointment.teremszam}</div>
                      )}
                      <div>Fogpótlástanász: {appointment.dentistEmail || 'Nincs megadva'}</div>
                      {appointment.appointmentType && (
                        <div className="mt-1">
                          <span className="text-xs font-medium text-gray-600">Típus: </span>
                          <span className="text-xs text-gray-700">
                            {appointment.appointmentType === 'elso_konzultacio' && 'Első konzultáció'}
                            {appointment.appointmentType === 'munkafazis' && 'Munkafázis'}
                            {appointment.appointmentType === 'kontroll' && 'Kontroll'}
                          </span>
                        </div>
                      )}
                      <div className="mt-2 pt-2 border-t border-green-200 space-y-1">
                        {appointment.createdAt && (
                          <div>
                            <span className="text-xs font-medium text-gray-600">Létrehozva: </span>
                            <span className="text-xs text-gray-700">
                              {formatDateTime(appointment.createdAt)}
                            </span>
                          </div>
                        )}
                        {appointment.approvedAt && (
                          <div>
                            <span className="text-xs font-medium text-gray-600">Elfogadva: </span>
                            <span className="text-xs text-gray-700">
                              {formatDateTime(appointment.approvedAt)}
                            </span>
                          </div>
                        )}
                        {appointment.createdBy && (
                          <div>
                            <span className="text-xs font-medium text-gray-600">Foglalta: </span>
                            <span className="text-xs text-gray-700">
                              {appointment.createdBy}
                            </span>
                          </div>
                        )}
                        {(appointment.timeSlotSource || appointment.createdVia) && (
                          <div>
                            <span className="text-xs font-medium text-gray-600">Forrás: </span>
                            <span className="text-xs text-gray-700">
                              {appointment.createdVia === 'worklist'
                                ? 'Munkalista'
                                : appointment.createdVia === 'patient_form'
                                  ? 'Beteg űrlap'
                                  : appointment.createdVia === 'admin_override'
                                    ? 'Admin felülírás'
                                    : appointment.createdVia === 'surgeon_override'
                                      ? 'Orvosi felülírás'
                                      : appointment.timeSlotSource === 'google_calendar'
                                        ? 'Google Naptár szinkron'
                                        : appointment.timeSlotSource === 'manual'
                                          ? 'Manuális'
                                          : 'Manuális'}{appointment.timeSlotSource === 'google_calendar' && appointment.createdVia && appointment.createdVia !== 'google_import' ? ' (.ics)' : ''}
                            </span>
                          </div>
                        )}
                      </div>
                      {(() => {
                        if (appointment.isLate) {
                          return (
                            <div className="flex items-center gap-1 mt-1 text-orange-600">
                              <ClockIcon className="w-3 h-3" />
                              <span>Késett a beteg</span>
                            </div>
                          );
                        }
                        if (appointment.appointmentStatus === 'cancelled_by_doctor') {
                          return (
                            <div className="flex items-center gap-1 mt-1 text-red-600">
                              <XCircle className="w-3 h-3" />
                              <span>Lemondta az orvos</span>
                            </div>
                          );
                        }
                        if (appointment.appointmentStatus === 'cancelled_by_patient') {
                          return (
                            <div className="flex items-center gap-1 mt-1 text-red-600">
                              <XCircle className="w-3 h-3" />
                              <span>Lemondta a beteg</span>
                            </div>
                          );
                        }
                        if (appointment.appointmentStatus === 'completed') {
                          return (
                            <div className="mt-1">
                              <div className="flex items-center gap-1 text-green-600">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Sikeresen teljesült</span>
                              </div>
                              {appointment.completionNotes && (
                                <div className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap break-words">
                                  {appointment.completionNotes}
                                </div>
                              )}
                            </div>
                          );
                        }
                        if (appointment.appointmentStatus === 'no_show') {
                          return (
                            <div className="flex items-center gap-1 mt-1 text-red-600">
                              <AlertCircle className="w-3 h-3" />
                              <span>Nem jelent meg</span>
                            </div>
                          );
                        }
                        return null;
                      })()}
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
                    <>
                      <button
                        onClick={() => handleModifyAppointment(appointment)}
                        className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        title="Időpont módosítása"
                      >
                        <Edit2 className="w-4 h-4" />
                        Módosítás
                      </button>
                      <button
                        onClick={() => handleEditStatus(appointment)}
                        className="text-sm text-purple-600 hover:text-purple-800 flex items-center gap-1"
                        title="Státusz szerkesztése"
                      >
                        <Edit2 className="w-4 h-4" />
                        Státusz
                      </button>
                      <button
                        onClick={() => handleCancelAppointment(appointment.id)}
                        className="text-sm text-red-600 hover:text-red-800 flex items-center gap-1"
                        title="Időpont lemondása"
                      >
                        <X className="w-4 h-4" />
                        Lemondás
                      </button>
                    </>
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
                      onChange={(e) => setNewSlotTeremszam(digitsOnly(e.target.value))}
                      className="form-input w-full"
                      placeholder="Pl. 611"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Időpont típusa
                    </label>
                    <select
                      value={newSlotAppointmentType || ''}
                      onChange={(e) => setNewSlotAppointmentType(e.target.value as any || null)}
                      className="form-input w-full"
                    >
                      <option value="">Nincs megadva</option>
                      <option value="elso_konzultacio">Első konzultáció</option>
                      <option value="munkafazis">Munkafázis</option>
                      <option value="kontroll">Kontroll</option>
                    </select>
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
                        setNewSlotAppointmentType(null);
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
                      onChange={(e) => setCustomTeremszam(digitsOnly(e.target.value))}
                      className="form-input w-full text-sm"
                      placeholder={availableSlotsOnly.find(s => s.id === selectedSlot)?.teremszam || 'Pl. 611'}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Időpont típusa
                    </label>
                    <select
                      value={selectedAppointmentType || ''}
                      onChange={(e) => setSelectedAppointmentType(e.target.value as any || null)}
                      className="form-input w-full text-sm"
                    >
                      <option value="">Nincs megadva</option>
                      <option value="elso_konzultacio">Első konzultáció</option>
                      <option value="munkafazis">Munkafázis</option>
                      <option value="kontroll">Kontroll</option>
                    </select>
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

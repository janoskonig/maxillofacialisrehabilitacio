'use client';

import { DashboardWidget } from '../DashboardWidget';
import { Calendar, Clock, MapPin, Edit2, CheckCircle2, AlertCircle, XCircle, RotateCcw, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import { useState, useCallback, useEffect } from 'react';
import { getAppointmentTypeChip, APPOINTMENT_TYPE_OPTIONS } from '@/lib/appointment-constants';
import { extractApiError, formatApiError } from '@/lib/extract-api-error';

interface Appointment {
  id: string;
  patientId: string;
  startTime: string;
  patientName: string | null;
  patientTaj: string | null;
  cim: string | null;
  teremszam: string | null;
  appointmentStatus?: string | null;
  completionNotes?: string | null;
  isLate?: boolean | null;
  dentistEmail?: string | null;
  dentistName?: string | null;
  // Type flag + plan-step context (see /api/dashboard nextAppointments).
  appointmentType?: string | null;
  typeLabel?: string | null;
  episodeId?: string | null;
  stepCode?: string | null;
  workPhaseId?: string | null;
  attemptNumber?: number | null;
  stepLabel?: string | null;
  rebookNeeded?: boolean | null;
}

interface TodaysAppointmentsWidgetProps {
  appointments: Appointment[];
  onUpdate?: () => void;
}

export function TodaysAppointmentsWidget({ appointments: initialAppointments, onUpdate }: TodaysAppointmentsWidgetProps) {
  const router = useRouter();
  const [appointments, setAppointments] = useState<Appointment[]>(initialAppointments);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Separate inline state for the "Sikertelen – újra kell" (unsuccessful) flow,
  // which goes through the dedicated attempt-outcome endpoint (reason required).
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryReason, setRetryReason] = useState('');
  const [retrySaving, setRetrySaving] = useState(false);

  // Update local state when prop changes
  useEffect(() => {
    setAppointments(initialAppointments);
  }, [initialAppointments]);
  const [statusForm, setStatusForm] = useState<{
    appointmentStatus: 'cancelled_by_doctor' | 'cancelled_by_patient' | 'completed' | 'no_show' | null;
    completionNotes: string;
    isLate: boolean;
    appointmentType: string;
    typeLabel: string;
  }>({
    appointmentStatus: null,
    completionNotes: '',
    isLate: false,
    appointmentType: '',
    typeLabel: '',
  });

  const handlePatientNameClick = (patientId: string | null | undefined, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (patientId) {
      router.push(`/patients/${patientId}/view`);
    } else {
      console.warn('Patient ID is missing for appointment');
    }
  };

  // Deep-link into the patient booking flow for a reopened step. The patient
  // view surfaces the worklist where the now-pending step is bookable; the query
  // params are forward-compat hints for preselecting it.
  const handleRebook = useCallback((appointment: Appointment, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!appointment.patientId) return;
    const params = new URLSearchParams();
    if (appointment.episodeId) params.set('rebookEpisode', appointment.episodeId);
    if (appointment.stepCode) params.set('rebookStep', appointment.stepCode);
    const qs = params.toString();
    router.push(`/patients/${appointment.patientId}/view${qs ? `?${qs}` : ''}`);
  }, [router]);

  const handleEditStatus = useCallback((appointment: Appointment) => {
    setEditingId(appointment.id);
    setRetryingId(null);
    const validStatuses = ['cancelled_by_doctor', 'cancelled_by_patient', 'completed', 'no_show'] as const;
    const status = appointment.appointmentStatus && validStatuses.includes(appointment.appointmentStatus as any)
      ? appointment.appointmentStatus as 'cancelled_by_doctor' | 'cancelled_by_patient' | 'completed' | 'no_show'
      : null;
    setStatusForm({
      appointmentStatus: status,
      completionNotes: appointment.completionNotes || '',
      isLate: appointment.isLate || false,
      appointmentType: appointment.appointmentType || '',
      typeLabel: appointment.typeLabel || '',
    });
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setStatusForm({
      appointmentStatus: null,
      completionNotes: '',
      isLate: false,
      appointmentType: '',
      typeLabel: '',
    });
  }, []);

  const handleSaveStatus = useCallback(async (appointmentId: string) => {
    // Validate: if status is 'completed', completionNotes is required
    if (statusForm.appointmentStatus === 'completed' && !statusForm.completionNotes.trim()) {
      alert('A "mi történt?" mező kitöltése kötelező sikeresen teljesült időpont esetén.');
      return;
    }

    try {
      const response = await fetch(`/api/appointments/${appointmentId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          appointmentStatus: statusForm.appointmentStatus,
          completionNotes: statusForm.appointmentStatus === 'completed' ? statusForm.completionNotes : null,
          isLate: statusForm.isLate,
          appointmentType: statusForm.appointmentType || null,
          typeLabel: statusForm.typeLabel,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        // Update local state
        setAppointments(prev => prev.map(apt =>
          apt.id === appointmentId
            ? {
                ...apt,
                appointmentStatus: data.appointment.appointmentStatus,
                completionNotes: data.appointment.completionNotes,
                isLate: data.appointment.isLate || false,
                appointmentType: data.appointment.appointmentType ?? apt.appointmentType,
                typeLabel: data.appointment.typeLabel ?? statusForm.typeLabel ?? apt.typeLabel,
              }
            : apt
        ));
        setEditingId(null);
        setStatusForm({ appointmentStatus: null, completionNotes: '', isLate: false, appointmentType: '', typeLabel: '' });
        // Notify parent to refresh data (recomputes rebookNeeded authoritatively)
        if (onUpdate) {
          onUpdate();
        }
      } else {
        alert(formatApiError(await extractApiError(response, 'Hiba történt az időpont státuszának frissítésekor')));
      }
    } catch (error) {
      console.error('Error updating appointment status:', error);
      alert('Hiba történt az időpont státuszának frissítésekor');
    }
  }, [statusForm, onUpdate]);

  const getStatusLabel = useCallback((status: string | null | undefined, isLate?: boolean | null) => {
    if (isLate && !status) {
      return { label: 'Késett', color: 'text-orange-600 dark:text-orange-300', bgColor: 'bg-orange-50 dark:bg-orange-950/40', icon: Clock };
    }
    switch (status) {
      case 'cancelled_by_doctor':
        return { label: 'Lemondta az orvos', color: 'text-red-600 dark:text-red-300', bgColor: 'bg-red-50 dark:bg-red-950/40', icon: XCircle };
      case 'cancelled_by_patient':
        return { label: 'Lemondta a beteg', color: 'text-red-600 dark:text-red-300', bgColor: 'bg-red-50 dark:bg-red-950/40', icon: XCircle };
      case 'completed':
        return { label: 'Sikeresen teljesült', color: 'text-green-600 dark:text-green-300', bgColor: 'bg-green-50 dark:bg-green-950/40', icon: CheckCircle2 };
      case 'no_show':
        return { label: 'Nem jelent meg', color: 'text-red-600 dark:text-red-300', bgColor: 'bg-red-50 dark:bg-red-950/40', icon: AlertCircle };
      case 'unsuccessful':
        return { label: 'Sikertelen – újra kell', color: 'text-amber-600 dark:text-amber-300', bgColor: 'bg-amber-50 dark:bg-amber-950/40', icon: RotateCcw };
      default:
        return null;
    }
  }, []);

  const handleQuickStatus = useCallback(async (appointmentId: string, status: 'completed' | 'no_show') => {
    // Only handle no_show quickly, completed requires notes so open edit form with status pre-selected
    if (status === 'completed') {
      const appointment = appointments.find(a => a.id === appointmentId);
      if (appointment) {
        handleEditStatus(appointment);
        setStatusForm(prev => ({ ...prev, appointmentStatus: 'completed', completionNotes: '' }));
      }
      return;
    }

    try {
      const response = await fetch(`/api/appointments/${appointmentId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          appointmentStatus: status,
          completionNotes: null,
          isLate: false,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setAppointments(prev => prev.map(apt =>
          apt.id === appointmentId
            ? {
                ...apt,
                appointmentStatus: data.appointment.appointmentStatus,
                completionNotes: data.appointment.completionNotes,
                isLate: data.appointment.isLate || false,
                // Optimistic: a no-show on a plan step reopens it for rebooking.
                rebookNeeded: !!(apt.episodeId && apt.stepCode) || apt.rebookNeeded,
              }
            : apt
        ));
        if (onUpdate) {
          onUpdate();
        }
      } else {
        alert(formatApiError(await extractApiError(response, 'Hiba történt az időpont státuszának frissítésekor')));
      }
    } catch (error) {
      console.error('Error updating appointment status:', error);
      alert('Hiba történt az időpont státuszának frissítésekor');
    }
  }, [appointments, onUpdate, handleEditStatus]);

  const handleStartRetry = useCallback((appointment: Appointment) => {
    setRetryingId(appointment.id);
    setEditingId(null);
    setRetryReason('');
  }, []);

  const handleSaveRetry = useCallback(async (appointmentId: string) => {
    const reason = retryReason.trim();
    if (reason.length < 5) {
      alert('Az indok megadása kötelező (legalább 5 karakter).');
      return;
    }
    setRetrySaving(true);
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/attempt-outcome`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'mark_unsuccessful', reason }),
      });
      if (response.ok) {
        setAppointments(prev => prev.map(apt =>
          apt.id === appointmentId
            ? { ...apt, appointmentStatus: 'unsuccessful', rebookNeeded: true }
            : apt
        ));
        setRetryingId(null);
        setRetryReason('');
        if (onUpdate) {
          onUpdate();
        }
      } else {
        alert(formatApiError(await extractApiError(response, 'Hiba történt a sikertelen-jelöléskor')));
      }
    } catch (error) {
      console.error('Error marking appointment unsuccessful:', error);
      alert('Hiba történt a sikertelen-jelöléskor');
    } finally {
      setRetrySaving(false);
    }
  }, [retryReason, onUpdate]);

  if (appointments.length === 0) {
    return (
      <DashboardWidget title="Következő időpontok (ma)" icon={<Calendar className="w-5 h-5" />}>
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-full w-16 h-16 mx-auto mb-3 flex items-center justify-center">
            <Calendar className="w-8 h-8 text-gray-400 dark:text-gray-500" />
          </div>
          <p className="text-body-sm">Nincsenek mai időpontok</p>
        </div>
      </DashboardWidget>
    );
  }

  return (
    <DashboardWidget title="Következő időpontok (ma)" icon={<Calendar className="w-5 h-5" />} collapsible>
      <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
        {appointments.map((appointment) => {
          const startTime = new Date(appointment.startTime);
          const isUpcoming = startTime > new Date();
          const statusInfo = getStatusLabel(appointment.appointmentStatus, appointment.isLate);
          const isEditing = editingId === appointment.id;
          const isRetrying = retryingId === appointment.id;
          const chip = getAppointmentTypeChip(appointment.appointmentType, appointment.typeLabel);
          const isPlanStep = !!(appointment.episodeId && appointment.stepCode);
          const showRebook = !!appointment.rebookNeeded;

          return (
            <div
              key={appointment.id}
              className={`px-3 py-2 rounded-lg border transition-all duration-200 animate-fade-in ${
                showRebook
                  ? 'border-amber-300/70 bg-amber-50/60 dark:border-amber-700/50 dark:bg-amber-950/30'
                  : isUpcoming
                  ? 'border-medical-primary/30 bg-gradient-to-br from-medical-primary/5 to-medical-accent/5 hover:shadow-soft'
                  : 'border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800 hover:shadow-soft'
              }`}
            >
              <div className="flex items-start justify-between gap-1.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <div className={`p-1 rounded-md ${isUpcoming ? 'bg-medical-primary/10' : 'bg-gray-200 dark:bg-gray-700'}`}>
                      <Clock className={`w-3.5 h-3.5 ${isUpcoming ? 'text-medical-primary' : 'text-gray-500 dark:text-gray-400'} flex-shrink-0`} />
                    </div>
                    <span className="font-bold text-sm text-gray-900 dark:text-gray-100 tabular-nums">
                      {format(startTime, 'HH:mm', { locale: hu })}
                    </span>
                    {/* Appointment type flag */}
                    {chip && (
                      <span
                        className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 ${chip.className}`}
                        title="Időpont típusa"
                      >
                        <span aria-hidden>{chip.emoji}</span>
                        <span className="truncate max-w-[160px]">{chip.label}</span>
                      </span>
                    )}
                    {!isUpcoming && (
                      <span className="badge badge-gray text-[10px] leading-tight py-0 px-1.5">(már elmúlt)</span>
                    )}
                  </div>
                  <div
                    onClick={(e) => handlePatientNameClick(appointment.patientId, e)}
                    className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate leading-snug cursor-pointer hover:text-medical-primary transition-colors"
                    title="Beteg megtekintése"
                  >
                    {appointment.patientName || 'Névtelen beteg'}
                  </div>
                  {/* Plan-step context */}
                  {isPlanStep && appointment.stepLabel && (
                    <div className="text-xs text-gray-600 dark:text-gray-400 leading-snug mt-0.5">
                      Lépés: <span className="font-medium text-gray-800 dark:text-gray-200">{appointment.stepLabel}</span>
                      {appointment.attemptNumber && appointment.attemptNumber > 1 && (
                        <span> · {appointment.attemptNumber}. próba</span>
                      )}
                    </div>
                  )}
                  {appointment.dentistName && (
                    <div className="text-xs text-gray-700 dark:text-gray-300 font-medium leading-snug mt-0.5">
                      {appointment.dentistName}
                    </div>
                  )}
                  {appointment.teremszam && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-gray-500 dark:text-gray-400 leading-snug">
                      <MapPin className="w-3 h-3 flex-shrink-0" />
                      <span>{appointment.teremszam}. terem</span>
                    </div>
                  )}

                  {/* Status display */}
                  {!isEditing && !isRetrying && statusInfo && (
                    <div className={`badge mt-1.5 text-xs py-0.5 ${statusInfo.bgColor.includes('green') ? 'badge-success' : statusInfo.bgColor.includes('red') ? 'badge-error' : statusInfo.bgColor.includes('amber') ? 'badge-warning' : statusInfo.bgColor.includes('orange') ? 'badge-warning' : 'badge-primary'}`}>
                      <statusInfo.icon className="w-3 h-3 mr-0.5" />
                      <span>{statusInfo.label}</span>
                    </div>
                  )}

                  {/* Quick action buttons (outcomes) */}
                  {!isEditing && !isRetrying && !appointment.appointmentStatus && (
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      <button
                        onClick={() => handleQuickStatus(appointment.id, 'completed')}
                        className="text-[11px] px-2 py-1 bg-medical-success/10 text-medical-success border border-medical-success/20 rounded-md hover:bg-medical-success/20 transition-all duration-200 font-medium"
                        title="Sikeresen teljesült (megjegyzéssel)"
                      >
                        ✓ Teljesült
                      </button>
                      {isPlanStep && (
                        <button
                          onClick={() => handleStartRetry(appointment)}
                          className="text-[11px] px-2 py-1 bg-amber-500/10 text-amber-600 dark:text-amber-300 border border-amber-500/20 rounded-md hover:bg-amber-500/20 transition-all duration-200 font-medium"
                          title="Sikertelen próba – a lépést újra kell foglalni"
                        >
                          ↻ Sikertelen – újra kell
                        </button>
                      )}
                      <button
                        onClick={() => handleQuickStatus(appointment.id, 'no_show')}
                        className="text-[11px] px-2 py-1 bg-medical-error/10 text-medical-error border border-medical-error/20 rounded-md hover:bg-medical-error/20 transition-all duration-200 font-medium"
                        title="Nem jelent meg"
                      >
                        ✗ Nem jelent meg
                      </button>
                    </div>
                  )}

                  {/* Completion notes display */}
                  {!isEditing && !isRetrying && appointment.completionNotes && (
                    <div className="text-xs text-gray-700 dark:text-gray-300 mt-1.5 px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-800 leading-snug">
                      {appointment.completionNotes}
                    </div>
                  )}

                  {/* Rebook-needed banner — the outcome→rebook connection */}
                  {!isEditing && !isRetrying && showRebook && (
                    <div className="mt-2 pt-2 border-t border-dashed border-amber-400/50 flex items-center gap-2">
                      <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" /> Újrafoglalás szükséges
                      </span>
                      <button
                        onClick={(e) => handleRebook(appointment, e)}
                        className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-md bg-medical-primary text-white hover:bg-medical-primary/90 transition-all duration-200 inline-flex items-center gap-1"
                        title="Új időpont foglalása ehhez a lépéshez"
                      >
                        Újrafoglalás <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  )}

                  {/* Retry (unsuccessful) inline form — attempt-outcome endpoint */}
                  {isRetrying && (
                    <div className="mt-3 space-y-2 pt-2 border-t border-amber-300/60">
                      <div className="text-xs font-semibold text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
                        <RotateCcw className="w-3.5 h-3.5" /> Sikertelen próba — a lépés visszanyílik újrafoglalásra
                      </div>
                      <div>
                        <label className="form-label text-xs">
                          Indok <span className="text-medical-error">*</span>
                        </label>
                        <textarea
                          value={retryReason}
                          onChange={(e) => setRetryReason(e.target.value)}
                          className="form-input text-xs"
                          rows={2}
                          placeholder="pl. rossz illeszkedés, új lenyomat kell…"
                        />
                      </div>
                      <div className="flex gap-2 justify-end pt-1">
                        <button onClick={() => { setRetryingId(null); setRetryReason(''); }} className="btn-secondary text-xs px-3 py-1.5" disabled={retrySaving}>
                          Mégse
                        </button>
                        <button onClick={() => handleSaveRetry(appointment.id)} className="btn-primary text-xs px-3 py-1.5" disabled={retrySaving}>
                          {retrySaving ? 'Mentés…' : 'Mentés → újrafoglalás'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Edit form */}
                  {isEditing && (
                    <div className="mt-3 space-y-2 pt-2 border-t border-gray-200 dark:border-gray-800">
                      <div>
                        <label className="form-label text-xs">
                          Típus
                        </label>
                        <select
                          value={statusForm.appointmentType}
                          onChange={(e) => setStatusForm({ ...statusForm, appointmentType: e.target.value })}
                          className="form-input text-xs"
                        >
                          <option value="">Nincs megadva</option>
                          {APPOINTMENT_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="form-label text-xs">
                          Címke (szabad szöveg)
                        </label>
                        <input
                          type="text"
                          value={statusForm.typeLabel}
                          onChange={(e) => setStatusForm({ ...statusForm, typeLabel: e.target.value })}
                          className="form-input text-xs"
                          maxLength={120}
                          placeholder="pl. implantátum kontroll 6h"
                        />
                      </div>
                      <div>
                        <label className="form-label text-xs">
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
                          className="form-input text-xs"
                        >
                          <option value="">Nincs státusz (normál időpont)</option>
                          <option value="cancelled_by_doctor">Lemondta az orvos</option>
                          <option value="cancelled_by_patient">Lemondta a beteg</option>
                          <option value="completed">Sikeresen teljesült</option>
                          <option value="no_show">Nem jelent meg</option>
                        </select>
                      </div>
                      {statusForm.appointmentStatus && (
                        <div>
                          <label className="form-label text-xs">
                            Megjegyzés {statusForm.appointmentStatus === 'completed' && <span className="text-medical-error">*</span>}
                          </label>
                          <textarea
                            value={statusForm.completionNotes}
                            onChange={(e) => setStatusForm({ ...statusForm, completionNotes: e.target.value })}
                            className="form-input text-xs"
                            rows={2}
                            placeholder="Rövid leírás arról, hogy mi történt..."
                          />
                        </div>
                      )}
                      <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={statusForm.isLate}
                            onChange={(e) => setStatusForm({ ...statusForm, isLate: e.target.checked })}
                            className="w-4 h-4 rounded border-gray-300 dark:border-gray-700 text-medical-primary focus:ring-medical-primary"
                          />
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Késett a beteg</span>
                        </label>
                      </div>
                      <div className="flex gap-2 justify-end pt-1">
                        <button
                          onClick={handleCancelEdit}
                          className="btn-secondary text-xs px-3 py-1.5"
                        >
                          Mégse
                        </button>
                        <button
                          onClick={() => handleSaveStatus(appointment.id)}
                          className="btn-primary text-xs px-3 py-1.5"
                        >
                          Mentés
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Edit button */}
                {!isEditing && !isRetrying && (
                  <button
                    onClick={() => handleEditStatus(appointment)}
                    className="flex-shrink-0 p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-all duration-200 -mr-0.5"
                    title="Státusz / típus szerkesztése"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </DashboardWidget>
  );
}

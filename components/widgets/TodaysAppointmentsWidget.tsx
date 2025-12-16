'use client';

import { DashboardWidget } from '../DashboardWidget';
import { Calendar, Clock, MapPin, Edit2, CheckCircle2, AlertCircle, XCircle, X } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import { useState, useCallback, useEffect } from 'react';

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
}

interface TodaysAppointmentsWidgetProps {
  appointments: Appointment[];
  onUpdate?: () => void;
}

export function TodaysAppointmentsWidget({ appointments: initialAppointments, onUpdate }: TodaysAppointmentsWidgetProps) {
  const router = useRouter();
  const [appointments, setAppointments] = useState<Appointment[]>(initialAppointments);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Update local state when prop changes
  useEffect(() => {
    setAppointments(initialAppointments);
  }, [initialAppointments]);
  const [statusForm, setStatusForm] = useState<{
    appointmentStatus: 'cancelled_by_doctor' | 'cancelled_by_patient' | 'completed' | 'no_show' | null;
    completionNotes: string;
    isLate: boolean;
  }>({
    appointmentStatus: null,
    completionNotes: '',
    isLate: false,
  });

  const handleAppointmentClick = (patientId: string | null | undefined, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (patientId) {
      router.push(`/?patientId=${patientId}`);
    } else {
      console.warn('Patient ID is missing for appointment');
    }
  };

  const handleEditStatus = useCallback((appointment: Appointment) => {
    setEditingId(appointment.id);
    const validStatuses = ['cancelled_by_doctor', 'cancelled_by_patient', 'completed', 'no_show'] as const;
    const status = appointment.appointmentStatus && validStatuses.includes(appointment.appointmentStatus as any)
      ? appointment.appointmentStatus as 'cancelled_by_doctor' | 'cancelled_by_patient' | 'completed' | 'no_show'
      : null;
    setStatusForm({
      appointmentStatus: status,
      completionNotes: appointment.completionNotes || '',
      isLate: appointment.isLate || false,
    });
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setStatusForm({
      appointmentStatus: null,
      completionNotes: '',
      isLate: false,
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
                isLate: data.appointment.isLate || false
              }
            : apt
        ));
        setEditingId(null);
        setStatusForm({
          appointmentStatus: null,
          completionNotes: '',
          isLate: false,
        });
        // Notify parent to refresh data
        if (onUpdate) {
          onUpdate();
        }
      } else {
        const errorData = await response.json();
        alert(errorData.error || 'Hiba történt az időpont státuszának frissítésekor');
      }
    } catch (error) {
      console.error('Error updating appointment status:', error);
      alert('Hiba történt az időpont státuszának frissítésekor');
    }
  }, [statusForm]);

  const getStatusLabel = useCallback((status: string | null | undefined, isLate?: boolean | null) => {
    if (isLate && !status) {
      return { label: 'Késett', color: 'text-orange-600', bgColor: 'bg-orange-50', icon: Clock };
    }
    switch (status) {
      case 'cancelled_by_doctor':
        return { label: 'Lemondta az orvos', color: 'text-red-600', bgColor: 'bg-red-50', icon: XCircle };
      case 'cancelled_by_patient':
        return { label: 'Lemondta a beteg', color: 'text-red-600', bgColor: 'bg-red-50', icon: XCircle };
      case 'completed':
        return { label: 'Sikeresen teljesült', color: 'text-green-600', bgColor: 'bg-green-50', icon: CheckCircle2 };
      case 'no_show':
        return { label: 'Nem jelent meg', color: 'text-red-600', bgColor: 'bg-red-50', icon: AlertCircle };
      default:
        return null;
    }
  }, []);

  const handleQuickStatus = useCallback(async (appointmentId: string, status: 'completed' | 'no_show') => {
    // Only handle no_show quickly, completed requires notes so open edit form with status pre-selected
    if (status === 'completed') {
      const appointment = appointments.find(a => a.id === appointmentId);
      if (appointment) {
        setEditingId(appointmentId);
        setStatusForm({
          appointmentStatus: 'completed',
          completionNotes: '',
          isLate: false,
        });
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
                isLate: data.appointment.isLate || false
              }
            : apt
        ));
        if (onUpdate) {
          onUpdate();
        }
      } else {
        const errorData = await response.json();
        alert(errorData.error || 'Hiba történt az időpont státuszának frissítésekor');
      }
    } catch (error) {
      console.error('Error updating appointment status:', error);
      alert('Hiba történt az időpont státuszának frissítésekor');
    }
  }, [onUpdate]);

  if (appointments.length === 0) {
    return (
      <DashboardWidget title="Következő időpontok (ma)" icon={<Calendar className="w-5 h-5" />}>
        <div className="text-center py-8 text-gray-500">
          <div className="p-4 bg-gray-100 rounded-full w-16 h-16 mx-auto mb-3 flex items-center justify-center">
            <Calendar className="w-8 h-8 text-gray-400" />
          </div>
          <p className="text-body-sm">Nincsenek mai időpontok</p>
        </div>
      </DashboardWidget>
    );
  }

  return (
    <DashboardWidget title="Következő időpontok (ma)" icon={<Calendar className="w-5 h-5" />} collapsible>
      <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
        {appointments.map((appointment) => {
          const startTime = new Date(appointment.startTime);
          const isUpcoming = startTime > new Date();
          const statusInfo = getStatusLabel(appointment.appointmentStatus, appointment.isLate);
          const isEditing = editingId === appointment.id;
          
          return (
            <div
              key={appointment.id}
              className={`p-4 rounded-xl border transition-all duration-200 animate-fade-in ${
                isUpcoming
                  ? 'border-medical-primary/30 bg-gradient-to-br from-medical-primary/5 to-medical-accent/5 hover:shadow-soft'
                  : 'border-gray-200 bg-gray-50/50 hover:shadow-soft'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`p-1.5 rounded-lg ${isUpcoming ? 'bg-medical-primary/10' : 'bg-gray-200'}`}>
                      <Clock className={`w-4 h-4 ${isUpcoming ? 'text-medical-primary' : 'text-gray-500'} flex-shrink-0`} />
                    </div>
                    <span className="font-bold text-base text-gray-900">
                      {format(startTime, 'HH:mm', { locale: hu })}
                    </span>
                    {!isUpcoming && (
                      <span className="badge badge-gray text-xs">(már elmúlt)</span>
                    )}
                  </div>
                  <div
                    className="font-semibold text-base text-gray-900 truncate mb-1"
                  >
                    {appointment.patientName || 'Névtelen beteg'}
                  </div>
                  {appointment.patientTaj && (
                    <div className="text-body-sm text-gray-600 mt-0.5">
                      TAJ: {appointment.patientTaj}
                    </div>
                  )}
                  {(appointment.cim || appointment.teremszam) && (
                    <div className="flex items-center gap-1.5 mt-2 text-body-sm text-gray-500">
                      <MapPin className="w-3.5 h-3.5" />
                      {appointment.cim && <span>{appointment.cim}</span>}
                      {appointment.teremszam && <span>• {appointment.teremszam}. terem</span>}
                    </div>
                  )}
                  
                  {/* Status display */}
                  {!isEditing && statusInfo && (
                    <div className={`badge mt-2 ${statusInfo.bgColor.includes('green') ? 'badge-success' : statusInfo.bgColor.includes('red') ? 'badge-error' : statusInfo.bgColor.includes('orange') ? 'badge-warning' : 'badge-primary'}`}>
                      <statusInfo.icon className="w-3 h-3 mr-1" />
                      <span>{statusInfo.label}</span>
                    </div>
                  )}
                  
                  {/* Quick action buttons */}
                  {!isEditing && !appointment.appointmentStatus && (
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => handleEditStatus(appointment)}
                        className="text-xs px-3 py-1.5 bg-medical-success/10 text-medical-success border border-medical-success/20 rounded-lg hover:bg-medical-success/20 transition-all duration-200 font-medium"
                        title="Sikeresen teljesült (megjegyzéssel)"
                      >
                        ✓ Teljesült
                      </button>
                      <button
                        onClick={() => handleQuickStatus(appointment.id, 'no_show')}
                        className="text-xs px-3 py-1.5 bg-medical-error/10 text-medical-error border border-medical-error/20 rounded-lg hover:bg-medical-error/20 transition-all duration-200 font-medium"
                        title="Nem jelent meg"
                      >
                        ✗ Nem jelent meg
                      </button>
                    </div>
                  )}
                  
                  {/* Completion notes display */}
                  {!isEditing && appointment.completionNotes && (
                    <div className="text-body-sm text-gray-700 mt-2 px-3 py-2 bg-gray-100 rounded-lg border border-gray-200">
                      {appointment.completionNotes}
                    </div>
                  )}

                  {/* Edit form */}
                  {isEditing && (
                    <div className="mt-4 space-y-3 pt-3 border-t border-gray-200">
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
                      {(statusForm.appointmentStatus === 'completed' || statusForm.appointmentStatus) && (
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
                            className="w-4 h-4 rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                          />
                          <span className="text-xs font-medium text-gray-700">Késett a beteg</span>
                        </label>
                      </div>
                      <div className="flex gap-2 justify-end pt-2">
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
                {!isEditing && (
                  <button
                    onClick={() => handleEditStatus(appointment)}
                    className="flex-shrink-0 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all duration-200"
                    title="Státusz szerkesztése"
                  >
                    <Edit2 className="w-4 h-4" />
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


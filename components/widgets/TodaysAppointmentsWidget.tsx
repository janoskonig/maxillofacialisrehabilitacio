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

  const handleAppointmentClick = (patientId: string) => {
    router.push(`/?patientId=${patientId}`);
  };

  const handleEditStatus = useCallback((appointment: Appointment) => {
    setEditingId(appointment.id);
    setStatusForm({
      appointmentStatus: appointment.appointmentStatus || null,
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
        <div className="text-center py-6 text-gray-500">
          <Calendar className="w-12 h-12 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">Nincsenek mai időpontok</p>
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
              className={`p-3 rounded-lg border transition-colors ${
                isUpcoming
                  ? 'border-blue-200 bg-blue-50'
                  : 'border-gray-200 bg-gray-50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <span className="font-semibold text-sm sm:text-base text-gray-900">
                      {format(startTime, 'HH:mm', { locale: hu })}
                    </span>
                    {!isUpcoming && (
                      <span className="text-xs text-gray-500">(már elmúlt)</span>
                    )}
                  </div>
                  <div
                    onClick={() => handleAppointmentClick(appointment.patientId)}
                    className="font-medium text-sm sm:text-base text-blue-600 hover:text-blue-800 hover:underline cursor-pointer truncate transition-colors"
                  >
                    {appointment.patientName || 'Névtelen beteg'}
                  </div>
                  {appointment.patientTaj && (
                    <div className="text-xs text-gray-600 mt-0.5">
                      TAJ: {appointment.patientTaj}
                    </div>
                  )}
                  {(appointment.cim || appointment.teremszam) && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                      <MapPin className="w-3 h-3" />
                      {appointment.cim && <span>{appointment.cim}</span>}
                      {appointment.teremszam && <span>• {appointment.teremszam}. terem</span>}
                    </div>
                  )}
                  
                  {/* Status display */}
                  {!isEditing && statusInfo && (
                    <div className={`flex items-center gap-1 mt-2 px-2 py-1 rounded text-xs ${statusInfo.bgColor} ${statusInfo.color}`}>
                      <statusInfo.icon className="w-3 h-3" />
                      <span>{statusInfo.label}</span>
                    </div>
                  )}
                  
                  {/* Quick action buttons */}
                  {!isEditing && !appointment.appointmentStatus && (
                    <div className="flex gap-1 mt-2">
                      <button
                        onClick={() => handleEditStatus(appointment)}
                        className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                        title="Sikeresen teljesült (megjegyzéssel)"
                      >
                        ✓ Teljesült
                      </button>
                      <button
                        onClick={() => handleQuickStatus(appointment.id, 'no_show')}
                        className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                        title="Nem jelent meg"
                      >
                        ✗ Nem jelent meg
                      </button>
                    </div>
                  )}
                  
                  {/* Completion notes display */}
                  {!isEditing && appointment.completionNotes && (
                    <div className="text-xs text-gray-600 mt-1 px-2 py-1 bg-gray-100 rounded">
                      {appointment.completionNotes}
                    </div>
                  )}

                  {/* Edit form */}
                  {isEditing && (
                    <div className="mt-3 space-y-2 pt-2 border-t border-gray-200">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
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
                          className="w-full text-xs border border-gray-300 rounded px-2 py-1"
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
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Megjegyzés {statusForm.appointmentStatus === 'completed' && <span className="text-red-600">*</span>}
                          </label>
                          <textarea
                            value={statusForm.completionNotes}
                            onChange={(e) => setStatusForm({ ...statusForm, completionNotes: e.target.value })}
                            className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                            rows={2}
                            placeholder="Rövid leírás arról, hogy mi történt..."
                          />
                        </div>
                      )}
                      <div>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={statusForm.isLate}
                            onChange={(e) => setStatusForm({ ...statusForm, isLate: e.target.checked })}
                            className="w-3 h-3"
                          />
                          <span className="text-xs font-medium text-gray-700">Késett a beteg</span>
                        </label>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={handleCancelEdit}
                          className="text-xs px-2 py-1 text-gray-600 hover:text-gray-800"
                        >
                          Mégse
                        </button>
                        <button
                          onClick={() => handleSaveStatus(appointment.id)}
                          className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
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
                    className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 transition-colors"
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


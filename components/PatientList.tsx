'use client';

import { useState, useEffect, useMemo, memo } from 'react';
import { Patient } from '@/lib/types';
import { Phone, Mail, Calendar, FileText, Eye, Pencil, CheckCircle2, XCircle, Clock, Trash2, ArrowUp, ArrowDown, Image, Camera, AlertCircle, Clock as ClockIcon, MessageCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatDateForDisplay, calculateAge } from '@/lib/dateUtils';
import { PatientCard } from './PatientCard';
import { useIsMobile } from '@/hooks/useMediaQuery';

interface PatientListProps {
  patients: Patient[];
  onView: (patient: Patient) => void;
  onEdit?: (patient: Patient) => void;
  onDelete?: (patient: Patient) => void;
  onViewOP?: (patient: Patient) => void;
  onViewFoto?: (patient: Patient) => void;
  canEdit?: boolean;
  canDelete?: boolean;
  userRole?: 'admin' | 'editor' | 'viewer' | 'fogpótlástanász' | 'technikus' | 'sebészorvos';
  sortField?: 'nev' | 'idopont' | 'createdAt' | null;
  sortDirection?: 'asc' | 'desc';
  onSort?: (field: 'nev' | 'idopont' | 'createdAt') => void;
  searchQuery?: string;
}

interface AppointmentInfo {
  id: string;
  startTime: string;
  dentistEmail: string | null;
  dentistName?: string | null;
  appointmentStatus?: 'cancelled_by_doctor' | 'cancelled_by_patient' | 'completed' | 'no_show' | null;
  completionNotes?: string | null;
  isLate?: boolean;
}

function PatientListComponent({ patients, onView, onEdit, onDelete, onViewOP, onViewFoto, canEdit = false, canDelete = false, userRole, sortField, sortDirection = 'asc', onSort, searchQuery = '' }: PatientListProps) {
  const [appointments, setAppointments] = useState<Record<string, AppointmentInfo>>({});
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [opDocuments, setOpDocuments] = useState<Record<string, number>>({});
  const [fotoDocuments, setFotoDocuments] = useState<Record<string, number>>({});
  const isMobile = useIsMobile();
  const router = useRouter();

  // Load appointments for all roles
  // Optimalizálás: csak akkor töltjük újra, ha a betegek ID-ja változott
  const patientIdsString = useMemo(() => patients.map(p => p.id).filter(Boolean).join(','), [patients]);
  useEffect(() => {
    if (patientIdsString) {
      loadAppointments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientIdsString]);

  // Load OP documents for quick access
  // Optimalizálás: csak akkor töltjük újra, ha a betegek ID-ja változott
  useEffect(() => {
    if (patientIdsString) {
      loadOpDocuments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientIdsString]);

  // Load foto documents for quick access
  // Optimalizálás: csak akkor töltjük újra, ha a betegek ID-ja változott
  useEffect(() => {
    if (patientIdsString) {
      loadFotoDocuments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientIdsString]);

  const loadOpDocuments = async () => {
    // Optimalizálás: batch API hívás minden beteghez egyszerre
    const patientIds = patients.filter(p => p.id).map(p => p.id!);
    
    if (patientIds.length === 0) {
      setOpDocuments({});
      return;
    }

    try {
      const response = await fetch('/api/patients/documents/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ patientIds }),
      });

      if (response.ok) {
        const data = await response.json();
        setOpDocuments(data.opDocuments || {});
      } else {
        console.error('Failed to load OP documents batch');
        setOpDocuments({});
      }
    } catch (error) {
      // Silently fail - not critical
      console.error('Error loading OP documents batch:', error);
      setOpDocuments({});
    }
  };

  const loadFotoDocuments = async () => {
    // Optimalizálás: batch API hívás minden beteghez egyszerre
    const patientIds = patients.filter(p => p.id).map(p => p.id!);
    
    if (patientIds.length === 0) {
      setFotoDocuments({});
      return;
    }

    try {
      const response = await fetch('/api/patients/documents/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ patientIds }),
      });

      if (response.ok) {
        const data = await response.json();
        setFotoDocuments(data.fotoDocuments || {});
      } else {
        console.error('Failed to load foto documents batch');
        setFotoDocuments({});
      }
    } catch (error) {
      // Silently fail - not critical
      console.error('Error loading foto documents batch:', error);
      setFotoDocuments({});
    }
  };


  // Sort patients by appointment if needed
  const sortedPatients = useMemo(() => {
    if (sortField === 'idopont') {
      // Sort by appointment proximity (closest first)
      return [...patients].sort((a, b) => {
        const aptA = appointments[a.id || ''];
        const aptB = appointments[b.id || ''];
        
        // Patients without appointments go to the end
        if (!aptA && !aptB) return 0;
        if (!aptA) return 1;
        if (!aptB) return -1;
        
        const dateA = new Date(aptA.startTime).getTime();
        const dateB = new Date(aptB.startTime).getTime();
        const now = Date.now();
        // 4 órás késleltetés: az időpontok rendezésekor is figyelembe vesszük a 4 órás késleltetést
        const fourHoursFromNow = now - 4 * 60 * 60 * 1000;
        
        // Calculate distance from 4 hours ago (to account for the delay)
        const distA = Math.abs(dateA - fourHoursFromNow);
        const distB = Math.abs(dateB - fourHoursFromNow);
        
        const comparison = distA - distB;
        return sortDirection === 'asc' ? comparison : -comparison;
      });
    }
    return patients;
  }, [patients, appointments, sortField, sortDirection]);

  const loadAppointments = async () => {
    try {
      setLoadingAppointments(true);
      
      // Optimalizálás: batch API hívás minden beteghez egyszerre
      const patientIds = patients.filter(p => p.id).map(p => p.id!);
      
      if (patientIds.length === 0) {
        setAppointments({});
        return;
      }

      const response = await fetch('/api/appointments/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ patientIds }),
      });

      if (response.ok) {
        const data = await response.json();
        setAppointments(data.appointments || {});
      } else {
        console.error('Failed to load appointments batch');
        setAppointments({});
      }
    } catch (error) {
      console.error('Error loading appointments:', error);
      setAppointments({});
    } finally {
      setLoadingAppointments(false);
    }
  };
  // Helper function to render sortable header
  const renderSortableHeader = (label: string, field: 'nev' | 'idopont' | 'createdAt', className?: string) => {
    const isActive = sortField === field;
    const SortIcon = isActive 
      ? (sortDirection === 'asc' ? ArrowUp : ArrowDown)
      : null;
    
    return (
      <th 
        className={`px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-200/50 select-none transition-colors duration-150 ${
          isActive ? 'bg-medical-primary/10 text-medical-primary' : ''
        } ${className || ''}`}
        onClick={() => onSort?.(field)}
      >
        <div className="flex items-center gap-1.5">
          <span>{label}</span>
          {SortIcon && (
            <SortIcon className={`w-3.5 h-3.5 ${isActive ? 'text-medical-primary' : 'text-gray-400'}`} />
          )}
        </div>
      </th>
    );
  };

  if (sortedPatients.length === 0) {
    return (
      <div className="card text-center py-6">
        <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" />
        <h3 className="text-base font-medium text-gray-900 mb-1">Nincs találat</h3>
        <p className="text-sm text-gray-500">
          {patients.length === 0 
            ? "Kezdje az első betegadat hozzáadásával."
            : "Próbálja módosítani a keresési feltételeket."
          }
        </p>
      </div>
    );
  }

  // Mobile: Card view
  if (isMobile) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4">
          {sortedPatients.map((patient) => {
            const appointment = appointments[patient.id || ''];
            return (
              <PatientCard
                key={patient.id}
                patient={patient}
                appointment={appointment}
                opDocumentCount={opDocuments[patient.id || ''] || 0}
                fotoDocumentCount={fotoDocuments[patient.id || ''] || 0}
                onView={onView}
                onEdit={canEdit ? onEdit : undefined}
                onDelete={canDelete ? onDelete : undefined}
                onViewOP={onViewOP}
                onViewFoto={onViewFoto}
                canEdit={canEdit}
                canDelete={canDelete}
                userRole={userRole}
              />
            );
          })}
        </div>
      </div>
    );
  }

  // Desktop: Table view
  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gradient-to-r from-gray-50 to-gray-100/50">
            <tr>
              {renderSortableHeader(searchQuery.trim() ? 'Keresési eredmény' : 'Beteg', 'nev')}
              <th className="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider w-20">
                Foto
              </th>
              <th className="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider w-20">
                OP
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                TAJ szám
              </th>
              <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-32">
                Kapcsolat
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Kezelőorvos
              </th>
              {renderSortableHeader('Következő időpont', 'idopont', 'w-32')}
              {renderSortableHeader('Létrehozva', 'createdAt')}
              <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Műveletek
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {sortedPatients.map((patient, index) => {
              const hasNoDoctor = !patient.kezeleoorvos;
              const isEven = index % 2 === 0;
              return (
              <tr 
                key={patient.id} 
                className={`transition-all duration-150 ${
                  hasNoDoctor 
                    ? "bg-red-50/50 hover:bg-red-100/70 border-l-2 border-l-medical-error" 
                    : isEven 
                      ? "bg-white hover:bg-gray-50/80" 
                      : "bg-gray-50/30 hover:bg-gray-100/60"
                }`}
              >
                <td className="px-3 py-3 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-9 w-9">
                      <div className="h-9 w-9 rounded-full bg-gradient-to-br from-medical-primary to-medical-primary-light flex items-center justify-center shadow-soft">
                        <span className="text-xs font-semibold text-white">
                          {patient.nev ? patient.nev.split(' ').map(n => n.charAt(0)).join('').substring(0, 2) : '??'}
                        </span>
                      </div>
                    </div>
                    <div className="ml-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="text-sm font-semibold text-gray-900 cursor-pointer text-medical-primary hover:text-medical-primary-dark hover:underline transition-colors"
                          onClick={() => {
                            // Ha van szerkesztési jogosultság, akkor szerkesztés, különben csak megtekintés
                            if (canEdit && onEdit) {
                              onEdit(patient);
                            } else {
                              onView(patient);
                            }
                          }}
                          title={canEdit && onEdit ? "Beteg szerkesztése" : "Beteg megtekintése"}
                        >
                          {patient.nev}
                        </div>
                        {patient.halalDatum && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-700" title={`Halál dátuma: ${formatDateForDisplay(patient.halalDatum)}`}>
                            ✝
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {patient.nem === 'ferfi' ? 'Férfi' : patient.nem === 'no' ? 'Nő' : ''} 
                        {patient.nem && (() => {
                          const age = calculateAge(patient.szuletesiDatum);
                          return age !== null ? ` • ${age} éves` : '';
                        })()}
                        {patient.halalDatum && (
                          <span className="text-gray-600 ml-1">• Halál: {formatDateForDisplay(patient.halalDatum)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-center">
                  {fotoDocuments[patient.id || ''] > 0 ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onViewFoto) {
                          onViewFoto(patient);
                        } else {
                          onView(patient);
                        }
                      }}
                      className="inline-flex items-center justify-center p-1.5 rounded-full bg-medical-success/10 text-medical-success border border-medical-success/20 hover:bg-medical-success/20 transition-all duration-200"
                      title={`${fotoDocuments[patient.id || '']} foto dokumentum`}
                    >
                      <Camera className="w-4 h-4" />
                      <span className="ml-1 text-xs font-medium">{fotoDocuments[patient.id || '']}</span>
                    </button>
                  ) : (
                    <span className="text-xs text-gray-300">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {opDocuments[patient.id || ''] > 0 ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onViewOP) {
                          onViewOP(patient);
                        } else {
                          onView(patient);
                        }
                      }}
                      className="inline-flex items-center justify-center p-1.5 rounded-full bg-medical-primary/10 text-medical-primary border border-medical-primary/20 hover:bg-medical-primary/20 transition-all duration-200"
                      title={`${opDocuments[patient.id || '']} OP dokumentum`}
                    >
                      <Image className="w-4 h-4" />
                      <span className="ml-1 text-xs font-medium">{opDocuments[patient.id || '']}</span>
                    </button>
                  ) : (
                    <span className="text-xs text-gray-300">-</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="text-xs text-gray-900">{patient.taj || '-'}</div>
                </td>
                <td className="px-2 py-2 whitespace-nowrap w-32">
                  <div 
                    className="flex items-center text-xs text-gray-900 truncate"
                    title={patient.email ? `Telefon: ${patient.telefonszam || '-'}\nEmail: ${patient.email}` : `Telefon: ${patient.telefonszam || '-'}`}
                  >
                    <Phone className="w-3 h-3 mr-0.5 text-gray-400 flex-shrink-0" />
                    <span className="truncate">{patient.telefonszam || '-'}</span>
                  </div>
                  {patient.email && (
                    <div 
                      className="flex items-center text-xs text-gray-500 truncate"
                      title={patient.email}
                    >
                      <Mail className="w-2.5 h-2.5 mr-0.5 text-gray-400 flex-shrink-0" />
                      <span className="truncate">{patient.email}</span>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex items-center text-xs text-gray-900">
                    <svg className="w-3 h-3 mr-1 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2C12 2 8 4 8 8C8 10 10 12 12 14C14 12 16 10 16 8C16 4 12 2 12 2Z" />
                      <path d="M12 14V22" />
                      <path d="M8 16C8 16 6 18 6 20" />
                      <path d="M16 16C16 16 18 18 18 20" />
                    </svg>
                    {patient.kezeleoorvos || 'Kezelőorvosra vár'}
                  </div>
                </td>
                <td className="px-2 py-2 w-32">
                  {loadingAppointments ? (
                    <div className="text-xs text-gray-500">...</div>
                  ) : appointments[patient.id || ''] ? (
                    <div className="text-xs">
                      <div className="flex items-center text-gray-900 mb-0.5">
                        <Clock className="w-3 h-3 mr-0.5 text-medical-primary flex-shrink-0" />
                        <span className="font-medium">
                          {(() => {
                            const dateStr = appointments[patient.id || ''].startTime;
                            if (!dateStr) return formatDateForDisplay(dateStr);
                            try {
                              const date = new Date(dateStr);
                              if (isNaN(date.getTime())) return formatDateForDisplay(dateStr);
                              const year = date.getFullYear();
                              const month = String(date.getMonth() + 1).padStart(2, '0');
                              const day = String(date.getDate()).padStart(2, '0');
                              const hours = String(date.getHours()).padStart(2, '0');
                              const minutes = String(date.getMinutes()).padStart(2, '0');
                              return `${year}-${month}-${day} ${hours}:${minutes}`;
                            } catch {
                              return formatDateForDisplay(dateStr);
                            }
                          })()}
                        </span>
                      </div>
                      {appointments[patient.id || ''].dentistEmail && (
                        <div className="text-xs text-gray-600 truncate" title={appointments[patient.id || ''].dentistEmail || undefined}>
                          {appointments[patient.id || ''].dentistName || appointments[patient.id || ''].dentistEmail}
                        </div>
                      )}
                      {(() => {
                        const apt = appointments[patient.id || ''];
                        if (apt.isLate) {
                          return (
                            <div className="flex items-center gap-0.5 mt-0.5 text-orange-600" title="Késett a beteg">
                              <ClockIcon className="w-2.5 h-2.5" />
                              <span className="text-xs">Késett</span>
                            </div>
                          );
                        }
                        if (apt.appointmentStatus === 'cancelled_by_doctor') {
                          return (
                            <div className="flex items-center gap-0.5 mt-0.5 text-red-600" title="Lemondta az orvos">
                              <XCircle className="w-2.5 h-2.5" />
                              <span className="text-xs">Lemondta az orvos</span>
                            </div>
                          );
                        }
                        if (apt.appointmentStatus === 'cancelled_by_patient') {
                          return (
                            <div className="flex items-center gap-0.5 mt-0.5 text-red-600" title="Lemondta a beteg">
                              <XCircle className="w-2.5 h-2.5" />
                              <span className="text-xs">Lemondta a beteg</span>
                            </div>
                          );
                        }
                        if (apt.appointmentStatus === 'completed') {
                          return (
                            <div className="flex items-center gap-0.5 mt-0.5 text-green-600" title={apt.completionNotes || 'Sikeresen teljesült'}>
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              <span className="text-xs">Teljesült</span>
                            </div>
                          );
                        }
                        if (apt.appointmentStatus === 'no_show') {
                          return (
                            <div className="flex items-center gap-0.5 mt-0.5 text-red-600" title="Nem jelent meg">
                              <AlertCircle className="w-2.5 h-2.5" />
                              <span className="text-xs">Nem jelent meg</span>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400">-</div>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="text-xs text-gray-500">
                    {patient.createdAt && (
                      <div className="flex items-center mb-0.5">
                        <Calendar className="w-3 h-3 mr-1 text-gray-400" />
                        {formatDateForDisplay(patient.createdAt)}
                      </div>
                    )}
                    {patient.createdBy ? (
                      <div className="text-xs text-gray-600 truncate" title={patient.createdBy}>
                        {patient.createdBy.split('@')[0]}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-600">
                        A beteg regisztrált
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-right text-xs font-medium">
                  <div className="flex justify-end space-x-1.5">
                    <button
                      onClick={() => router.push(`/patients/${patient.id}`)}
                      className="text-blue-600 hover:text-blue-800"
                      title={patient.email ? "Kapcsolattartás (chat és érintkezési napló)" : "Kapcsolattartás (érintkezési napló - nincs email-cím)"}
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onView(patient)}
                      className="text-medical-primary hover:text-blue-700"
                      title="Beteg megtekintése"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    {canEdit && onEdit && (
                      <button
                        onClick={() => onEdit(patient)}
                        className="text-medical-accent hover:text-amber-600"
                        title="Beteg szerkesztése"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canDelete && onDelete && (
                      <button
                        onClick={() => onDelete(patient)}
                        className="text-red-600 hover:text-red-800"
                        title="Beteg törlése"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Memoizálás a teljesítmény javításához
export const PatientList = memo(PatientListComponent, (prevProps, nextProps) => {
  // Egyedi összehasonlítás a props-okhoz
  return (
    prevProps.patients === nextProps.patients &&
    prevProps.canEdit === nextProps.canEdit &&
    prevProps.canDelete === nextProps.canDelete &&
    prevProps.userRole === nextProps.userRole &&
    prevProps.sortField === nextProps.sortField &&
    prevProps.sortDirection === nextProps.sortDirection &&
    prevProps.onView === nextProps.onView &&
    prevProps.onEdit === nextProps.onEdit &&
    prevProps.onDelete === nextProps.onDelete &&
    prevProps.onViewOP === nextProps.onViewOP &&
    prevProps.onViewFoto === nextProps.onViewFoto &&
    prevProps.onSort === nextProps.onSort
  );
});

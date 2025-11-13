'use client';

import { useState, useEffect, useMemo, memo } from 'react';
import { Patient } from '@/lib/types';
import { Phone, Mail, Calendar, FileText, Eye, Pencil, CheckCircle2, XCircle, Clock, Trash2, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDateForDisplay, calculateAge } from '@/lib/dateUtils';

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface PatientListProps {
  patients: Patient[];
  onView: (patient: Patient) => void;
  onEdit?: (patient: Patient) => void;
  onDelete?: (patient: Patient) => void;
  canEdit?: boolean;
  canDelete?: boolean;
  userRole?: 'admin' | 'editor' | 'viewer' | 'fogpótlástanász' | 'technikus' | 'sebészorvos';
  sortField?: 'nev' | 'idopont' | 'createdAt' | null;
  sortDirection?: 'asc' | 'desc';
  onSort?: (field: 'nev' | 'idopont' | 'createdAt') => void;
  pagination?: PaginationInfo;
  onPageChange?: (page: number) => void;
}

interface AppointmentInfo {
  id: string;
  startTime: string;
  dentistEmail: string | null;
  dentistName?: string | null;
}

function PatientListComponent({ patients, onView, onEdit, onDelete, canEdit = false, canDelete = false, userRole, sortField, sortDirection = 'asc', onSort, pagination, onPageChange }: PatientListProps) {
  const [appointments, setAppointments] = useState<Record<string, AppointmentInfo>>({});
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  
  // Use pagination from props if available, otherwise use client-side pagination as fallback
  const currentPage = pagination?.page || 1;
  const totalPages = pagination?.totalPages || Math.ceil(patients.length / 50);
  const itemsPerPage = pagination?.limit || 50;

  // Load appointments for all roles
  useEffect(() => {
    loadAppointments();
  }, [patients]);

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
  
  // Pagináció - csak ha nincs server-side pagination
  const paginatedPatients = pagination 
    ? sortedPatients // Server-side pagination esetén már paginated az adat
    : sortedPatients.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  const handlePageChange = (page: number) => {
    if (onPageChange) {
      onPageChange(page);
    }
  };

  const loadAppointments = async () => {
    try {
      setLoadingAppointments(true);
      const appointmentsMap: Record<string, AppointmentInfo> = {};
      const now = new Date();
      const fourHoursFromNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);
      
      // Load all appointments paginated
      let page = 1;
      let hasMore = true;
      const allAppointments: any[] = [];
      
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
      
      // Group appointments by patient ID
      const patientAppointments: Record<string, any[]> = {};
      allAppointments.forEach((apt: any) => {
        if (!patientAppointments[apt.patientId]) {
          patientAppointments[apt.patientId] = [];
        }
        patientAppointments[apt.patientId].push(apt);
      });
      
      // For each patient, find the next (earliest future) appointment
      // 4 órás késleltetés: csak azokat az időpontokat jelenítjük meg, amelyek kezdete legalább 4 órával a jelenlegi időpont után van
      Object.keys(patientAppointments).forEach((patientId) => {
        const apts = patientAppointments[patientId];
        
        // Filter appointments with 4 hour delay and sort by start time
        const futureAppointments = apts
          .filter((apt: any) => new Date(apt.startTime) >= fourHoursFromNow)
          .sort((a: any, b: any) => 
            new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
          );
        
        // Only show appointments with 4 hour delay - don't show appointments that are more than 4 hours past
        if (futureAppointments.length > 0) {
          const nextApt = futureAppointments[0];
          appointmentsMap[patientId] = {
            id: nextApt.id,
            startTime: nextApt.startTime,
            dentistEmail: nextApt.dentistEmail,
            dentistName: nextApt.dentistName,
          };
        }
        // If no future appointments (with 4 hour delay), don't add anything to appointmentsMap
        // This way the patient won't show an appointment in the list
      });
      
      setAppointments(appointmentsMap);
    } catch (error) {
      console.error('Error loading appointments:', error);
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
        className={`px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none ${
          isActive ? 'bg-gray-100' : ''
        } ${className || ''}`}
        onClick={() => onSort?.(field)}
      >
        <div className="flex items-center gap-1">
          <span>{label}</span>
          {SortIcon && (
            <SortIcon className="w-3 h-3 text-medical-primary" />
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

  return (
    <div className="card p-0">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {renderSortableHeader('Beteg', 'nev')}
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                TAJ szám
              </th>
              <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                Kapcsolat
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Kezelőorvos
              </th>
              {renderSortableHeader('Időpont', 'idopont', 'w-32')}
              {userRole !== 'sebészorvos' && (
                <>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tervezett fogpótlás (felső)
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tervezett fogpótlás (alsó)
                  </th>
                </>
              )}
              {renderSortableHeader('Létrehozva', 'createdAt')}
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Műveletek
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {paginatedPatients.map((patient) => {
              const hasNoDoctor = !patient.kezeleoorvos;
              return (
              <tr 
                key={patient.id} 
                className={hasNoDoctor ? "bg-red-50 hover:bg-red-100" : "hover:bg-gray-50"}
              >
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-8 w-8">
                      <div className="h-8 w-8 rounded-full bg-medical-primary flex items-center justify-center">
                        <span className="text-xs font-medium text-white">
                          {patient.nev ? patient.nev.split(' ').map(n => n.charAt(0)).join('').substring(0, 2) : '??'}
                        </span>
                      </div>
                    </div>
                    <div className="ml-2">
                      <div
                        className="text-xs font-medium text-gray-900 cursor-pointer text-medical-primary hover:underline"
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
                      <div className="text-xs text-gray-500">
                        {patient.nem === 'ferfi' ? 'Férfi' : patient.nem === 'no' ? 'Nő' : ''} 
                        {patient.nem && (() => {
                          const age = calculateAge(patient.szuletesiDatum);
                          return age !== null ? ` • ${age} éves` : '';
                        })()}
                      </div>
                    </div>
                  </div>
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
                          {formatDateForDisplay(appointments[patient.id || ''].startTime)}
                        </span>
                      </div>
                      {appointments[patient.id || ''].dentistEmail && (
                        <div className="text-xs text-gray-600 truncate" title={appointments[patient.id || ''].dentistEmail || undefined}>
                          {appointments[patient.id || ''].dentistName || appointments[patient.id || ''].dentistEmail}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400">-</div>
                  )}
                </td>
                {userRole !== 'sebészorvos' && (
                  <>
                    <td className="px-3 py-2">
                      <div className="text-xs text-gray-900">
                        {patient.kezelesiTervFelso && Array.isArray(patient.kezelesiTervFelso) && patient.kezelesiTervFelso.length > 0 ? (
                          <div className="space-y-1">
                            {patient.kezelesiTervFelso.map((terv: any, idx: number) => (
                              <div key={idx} className="border-b border-gray-100 pb-1 last:border-0 last:pb-0">
                                <div className="font-medium text-xs">{terv.tipus || '-'}</div>
                                {terv.tervezettAtadasDatuma && (
                                  <div className="text-xs text-gray-500 flex items-center mt-0.5">
                                    <Calendar className="w-2.5 h-2.5 mr-0.5" />
                                    {formatDateForDisplay(terv.tervezettAtadasDatuma)}
                                  </div>
                                )}
                                <div className="mt-0.5">
                                  {terv.elkeszult ? (
                                    <span className="inline" title="Elkészült">
                                      <CheckCircle2 className="w-2.5 h-2.5 text-green-600" />
                                    </span>
                                  ) : (
                                    <span className="inline" title="Nincs elkészítve">
                                      <XCircle className="w-2.5 h-2.5 text-gray-400" />
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : '-'}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-gray-900">
                        {patient.kezelesiTervAlso && Array.isArray(patient.kezelesiTervAlso) && patient.kezelesiTervAlso.length > 0 ? (
                          <div className="space-y-1">
                            {patient.kezelesiTervAlso.map((terv: any, idx: number) => (
                              <div key={idx} className="border-b border-gray-100 pb-1 last:border-0 last:pb-0">
                                <div className="font-medium text-xs">{terv.tipus || '-'}</div>
                                {terv.tervezettAtadasDatuma && (
                                  <div className="text-xs text-gray-500 flex items-center mt-0.5">
                                    <Calendar className="w-2.5 h-2.5 mr-0.5" />
                                    {formatDateForDisplay(terv.tervezettAtadasDatuma)}
                                  </div>
                                )}
                                <div className="mt-0.5">
                                  {terv.elkeszult ? (
                                    <span className="inline" title="Elkészült">
                                      <CheckCircle2 className="w-2.5 h-2.5 text-green-600" />
                                    </span>
                                  ) : (
                                    <span className="inline" title="Nincs elkészítve">
                                      <XCircle className="w-2.5 h-2.5 text-gray-400" />
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : '-'}
                      </div>
                    </td>
                  </>
                )}
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex items-center text-xs text-gray-500">
                    <Calendar className="w-3 h-3 mr-1 text-gray-400" />
                    {patient.createdAt && formatDateForDisplay(patient.createdAt)}
                  </div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-right text-xs font-medium">
                  <div className="flex justify-end space-x-1.5">
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
      
      {/* Pagináció */}
      {totalPages > 1 && (
        <div className="mt-4 px-4 py-3 flex items-center justify-between border-t border-gray-200">
          <div className="text-sm text-gray-600">
            Oldal {currentPage} / {totalPages} (összesen {pagination?.total ?? sortedPatients.length} beteg)
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className={`px-3 py-2 rounded-md text-sm font-medium ${
                currentPage === 1
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => handlePageChange(pageNum)}
                    className={`px-3 py-2 rounded-md text-sm font-medium ${
                      currentPage === pageNum
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className={`px-3 py-2 rounded-md text-sm font-medium ${
                currentPage === totalPages
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
              }`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
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
    prevProps.onSort === nextProps.onSort
  );
});

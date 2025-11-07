'use client';

import { Patient } from '@/lib/types';
import { Phone, Mail, Calendar, FileText, Eye, Pencil, CheckCircle2, XCircle } from 'lucide-react';
import { formatDateForDisplay, calculateAge } from '@/lib/dateUtils';

interface PatientListProps {
  patients: Patient[];
  onView: (patient: Patient) => void;
  onEdit?: (patient: Patient) => void;
  canEdit?: boolean;
}

export function PatientList({ patients, onView, onEdit, canEdit = false }: PatientListProps) {
  if (patients.length === 0) {
    return (
      <div className="card text-center py-12">
        <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Nincs találat</h3>
        <p className="text-gray-500">
          {patients.length === 0 
            ? "Kezdje az első betegadat hozzáadásával."
            : "Próbálja módosítani a keresési feltételeket."
          }
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Beteg
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                TAJ szám
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Kapcsolat
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Kezelőorvos
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Tervezett fogpótlás (felső)
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Tervezett fogpótlás (alsó)
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Létrehozva
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Műveletek
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {patients.map((patient) => {
              const hasNoDoctor = !patient.kezeleoorvos;
              return (
              <tr 
                key={patient.id} 
                className={hasNoDoctor ? "bg-red-50 hover:bg-red-100" : "hover:bg-gray-50"}
              >
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-10 w-10">
                      <div className="h-10 w-10 rounded-full bg-medical-primary flex items-center justify-center">
                        <span className="text-sm font-medium text-white">
                          {patient.nev ? patient.nev.split(' ').map(n => n.charAt(0)).join('').substring(0, 2) : '??'}
                        </span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <div
                        className="text-sm font-medium text-gray-900 cursor-pointer text-medical-primary hover:underline"
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
                      <div className="text-sm text-gray-500">
                        {patient.nem === 'ferfi' ? 'Férfi' : patient.nem === 'no' ? 'Nő' : ''} 
                        {patient.nem && (() => {
                          const age = calculateAge(patient.szuletesiDatum);
                          return age !== null ? ` • ${age} éves` : '';
                        })()}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{patient.taj || '-'}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center text-sm text-gray-900">
                    <Phone className="w-4 h-4 mr-1 text-gray-400" />
                    {patient.telefonszam || '-'}
                  </div>
                  {patient.email && (
                    <div className="flex items-center text-sm text-gray-500 mt-1">
                      <Mail className="w-4 h-4 mr-1 text-gray-400" />
                      {patient.email}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center text-sm text-gray-900">
                    <svg className="w-4 h-4 mr-1 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2C12 2 8 4 8 8C8 10 10 12 12 14C14 12 16 10 16 8C16 4 12 2 12 2Z" />
                      <path d="M12 14V22" />
                      <path d="M8 16C8 16 6 18 6 20" />
                      <path d="M16 16C16 16 18 18 18 20" />
                    </svg>
                    {patient.kezeleoorvos || 'Kezelőorvosra vár'}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-gray-900">
                    {patient.kezelesiTervFelso && Array.isArray(patient.kezelesiTervFelso) && patient.kezelesiTervFelso.length > 0 ? (
                      <div className="space-y-2">
                        {patient.kezelesiTervFelso.map((terv: any, idx: number) => (
                          <div key={idx} className="border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                            <div className="font-medium text-xs">{terv.tipus || '-'}</div>
                            {terv.tervezettAtadasDatuma && (
                              <div className="text-xs text-gray-500 flex items-center mt-1">
                                <Calendar className="w-3 h-3 mr-1" />
                                {formatDateForDisplay(terv.tervezettAtadasDatuma)}
                              </div>
                            )}
                            <div className="mt-1">
                              {terv.elkeszult ? (
                                <span className="inline" title="Elkészült">
                                  <CheckCircle2 className="w-3 h-3 text-green-600" />
                                </span>
                              ) : (
                                <span className="inline" title="Nincs elkészítve">
                                  <XCircle className="w-3 h-3 text-gray-400" />
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : '-'}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-gray-900">
                    {patient.kezelesiTervAlso && Array.isArray(patient.kezelesiTervAlso) && patient.kezelesiTervAlso.length > 0 ? (
                      <div className="space-y-2">
                        {patient.kezelesiTervAlso.map((terv: any, idx: number) => (
                          <div key={idx} className="border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                            <div className="font-medium text-xs">{terv.tipus || '-'}</div>
                            {terv.tervezettAtadasDatuma && (
                              <div className="text-xs text-gray-500 flex items-center mt-1">
                                <Calendar className="w-3 h-3 mr-1" />
                                {formatDateForDisplay(terv.tervezettAtadasDatuma)}
                              </div>
                            )}
                            <div className="mt-1">
                              {terv.elkeszult ? (
                                <span className="inline" title="Elkészült">
                                  <CheckCircle2 className="w-3 h-3 text-green-600" />
                                </span>
                              ) : (
                                <span className="inline" title="Nincs elkészítve">
                                  <XCircle className="w-3 h-3 text-gray-400" />
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : '-'}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center text-sm text-gray-500">
                    <Calendar className="w-4 h-4 mr-1 text-gray-400" />
                    {patient.createdAt && formatDateForDisplay(patient.createdAt)}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div className="flex justify-end space-x-2">
                    <button
                      onClick={() => onView(patient)}
                      className="text-medical-primary hover:text-blue-700"
                      title="Beteg megtekintése"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    {canEdit && onEdit && (
                      <button
                        onClick={() => onEdit(patient)}
                        className="text-medical-accent hover:text-amber-600"
                        title="Beteg szerkesztése"
                      >
                        <Pencil className="w-4 h-4" />
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

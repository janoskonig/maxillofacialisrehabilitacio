'use client';

import { Patient } from '@/lib/types';
import { Phone, Mail, Calendar, FileText, Eye } from 'lucide-react';
import { formatDateForDisplay } from '@/lib/dateUtils';

interface PatientListProps {
  patients: Patient[];
  onView: (patient: Patient) => void;
}

export function PatientList({ patients, onView }: PatientListProps) {
  if (patients.length === 0) {
    return (
      <div className="card text-center py-12">
        <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Nincs beteg találva</h3>
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
                Műtét típusa
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
            {patients.map((patient) => (
              <tr key={patient.id} className="hover:bg-gray-50">
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
                      <div className="text-sm font-medium text-gray-900">
                        {patient.nev}
                      </div>
                      <div className="text-sm text-gray-500">
                        {patient.nem === 'ferfi' ? 'Férfi' : patient.nem === 'no' ? 'Nő' : 'Egyéb'} • 
                        {patient.szuletesiDatum && ` Született: ${formatDateForDisplay(patient.szuletesiDatum)}`}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{patient.taj || '-'}</div>
                  {patient.beutaloIntezmeny && (
                    <div className="text-sm text-gray-500">{patient.beutaloIntezmeny}</div>
                  )}
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
                <td className="px-6 py-4">
                  <div className="text-sm text-gray-900 max-w-xs truncate">
                    {patient.mutetRovidLeirasa || '-'}
                  </div>
                  {patient.szovettaniDiagnozis && (
                    <div className="text-sm text-gray-500 mt-1">
                      Szövettani diagnózis: {patient.szovettaniDiagnozis}
                    </div>
                  )}
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
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

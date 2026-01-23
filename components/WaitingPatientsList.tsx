'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MobileTable } from './mobile/MobileTable';
import { MobileKeyValueGrid } from './mobile/MobileKeyValueGrid';
import { Eye } from 'lucide-react';

interface WaitingPatient {
  id: string;
  nev: string | null;
  taj: string | null;
  kezeleoorvos: string | null;
  betegLetrehozva: string;
  status: 'pending' | 'nincs_idopont';
}

interface WaitingPatientsListProps {
  osszes: number;
  pending: number;
  nincsIdopont: number;
  betegek: WaitingPatient[];
}

export function WaitingPatientsList({ osszes, pending, nincsIdopont, betegek }: WaitingPatientsListProps) {
  const router = useRouter();
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'nincs_idopont'>('all');

  const filteredPatients = filterStatus === 'all' 
    ? betegek 
    : betegek.filter(p => p.status === filterStatus);

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('hu-HU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  const getStatusBadge = (status: string) => {
    if (status === 'pending') {
      return (
        <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-orange-100 text-orange-700 rounded">
          Jóváhagyásra vár
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded">
        Nincs időpont
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Összesítő kártyák */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-600 font-medium">Összesen</p>
          <p className="text-2xl font-bold text-blue-900">{osszes}</p>
        </div>
        <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
          <p className="text-sm text-orange-600 font-medium">Jóváhagyásra vár</p>
          <p className="text-2xl font-bold text-orange-900">{pending}</p>
        </div>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-600 font-medium">Nincs időpont</p>
          <p className="text-2xl font-bold text-gray-900">{nincsIdopont}</p>
        </div>
      </div>

      {/* Szűrő */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilterStatus('all')}
          className={`px-4 py-2 rounded text-sm font-medium ${
            filterStatus === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Összes ({osszes})
        </button>
        <button
          onClick={() => setFilterStatus('pending')}
          className={`px-4 py-2 rounded text-sm font-medium ${
            filterStatus === 'pending'
              ? 'bg-orange-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Jóváhagyásra vár ({pending})
        </button>
        <button
          onClick={() => setFilterStatus('nincs_idopont')}
          className={`px-4 py-2 rounded text-sm font-medium ${
            filterStatus === 'nincs_idopont'
              ? 'bg-gray-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Nincs időpont ({nincsIdopont})
        </button>
      </div>

      {/* Táblázat */}
      <MobileTable
        items={filteredPatients}
        renderRow={(patient) => (
          <>
            <td className="px-4 py-3 text-sm text-gray-900">
              {patient.nev || '-'}
            </td>
            <td className="px-4 py-3 text-sm text-gray-900">
              {patient.taj || '-'}
            </td>
            <td className="px-4 py-3 text-sm text-gray-900">
              {patient.kezeleoorvos || '-'}
            </td>
            <td className="px-4 py-3 text-sm text-gray-900">
              {formatDate(patient.betegLetrehozva)}
            </td>
            <td className="px-4 py-3 text-sm">
              {getStatusBadge(patient.status)}
            </td>
            <td className="px-4 py-3 text-sm">
              <button
                onClick={() => router.push(`/?patientId=${patient.id}`)}
                className="text-blue-600 hover:text-blue-800 font-medium mobile-touch-target"
              >
                Megtekintés
              </button>
            </td>
          </>
        )}
        renderCard={(patient) => (
          <div className="mobile-card">
            {/* Top row: Név + Státusz */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900 truncate flex-1">
                {patient.nev || '-'}
              </h3>
              <div className="flex-shrink-0 ml-2">
                {getStatusBadge(patient.status)}
              </div>
            </div>

            {/* Middle: Key-value sorok */}
            <MobileKeyValueGrid
              items={[
                { key: 'TAJ', value: patient.taj || '-' },
                { key: 'Kezelőorvos', value: patient.kezeleoorvos || '-' },
                { key: 'Beteg létrehozva', value: formatDate(patient.betegLetrehozva) },
              ]}
              className="mb-3"
            />

            {/* Bottom: Actions */}
            <div className="pt-3 border-t border-gray-200">
              <button
                onClick={() => router.push(`/?patientId=${patient.id}`)}
                className="w-full btn-primary flex items-center justify-center gap-2 mobile-touch-target"
              >
                <Eye className="w-4 h-4" />
                Megtekintés
              </button>
            </div>
          </div>
        )}
        keyExtractor={(patient) => patient.id}
        emptyState={
          <div className="text-center py-8 text-gray-500">
            Nincs beteg a kiválasztott szűrővel
          </div>
        }
        renderHeader={() => (
          <>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Név</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">TAJ</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Kezelőorvos</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Beteg létrehozva</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Státusz</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Műveletek</th>
          </>
        )}
      />
    </div>
  );
}

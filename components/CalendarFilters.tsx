'use client';

import { Filter, X } from 'lucide-react';
import { useState } from 'react';

interface CalendarFiltersProps {
  dentists: Array<{ email: string; name: string | null }>;
  selectedDentist: string | null;
  selectedStatus: string | null;
  onDentistChange: (dentist: string | null) => void;
  onStatusChange: (status: string | null) => void;
  onClear: () => void;
}

export function CalendarFilters({
  dentists,
  selectedDentist,
  selectedStatus,
  onDentistChange,
  onStatusChange,
  onClear,
}: CalendarFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
  const hasActiveFilters = selectedDentist !== null || selectedStatus !== null;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`btn-secondary flex items-center gap-2 text-sm px-3 py-1.5 ${
          hasActiveFilters ? 'bg-blue-50 border-blue-300' : ''
        }`}
      >
        <Filter className="w-3.5 h-3.5" />
        Szűrők
        {hasActiveFilters && (
          <span className="bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {(selectedDentist ? 1 : 0) + (selectedStatus ? 1 : 0)}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border z-50 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Szűrők</h3>
              {hasActiveFilters && (
                <button
                  onClick={() => {
                    onClear();
                    setIsOpen(false);
                  }}
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  Törlés
                </button>
              )}
            </div>

            <div className="space-y-4">
              {/* Dentist Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Fogpótlástanász
                </label>
                <select
                  value={selectedDentist || ''}
                  onChange={(e) => onDentistChange(e.target.value || null)}
                  className="form-select w-full text-sm"
                >
                  <option value="">Összes</option>
                  {dentists.map((dentist) => (
                    <option key={dentist.email} value={dentist.email}>
                      {dentist.name || dentist.email}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Státusz
                </label>
                <select
                  value={selectedStatus || ''}
                  onChange={(e) => onStatusChange(e.target.value || null)}
                  className="form-select w-full text-sm"
                >
                  <option value="">Összes</option>
                  <option value="upcoming">Várható</option>
                  <option value="completed">Teljesült</option>
                  <option value="cancelled_by_doctor">Lemondva (orvos)</option>
                  <option value="cancelled_by_patient">Lemondva (beteg)</option>
                  <option value="no_show">Nem jelent meg</option>
                </select>
              </div>
            </div>

            <button
              onClick={() => setIsOpen(false)}
              className="mt-4 w-full btn-primary text-sm py-2"
            >
              Alkalmaz
            </button>
          </div>
        </>
      )}
    </div>
  );
}


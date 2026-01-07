'use client';

import { useState, useEffect } from 'react';
import { Clock, User, ArrowRight } from 'lucide-react';

interface PatientChange {
  id: string;
  patientId: string;
  fieldName: string;
  fieldDisplayName: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  changedAt: string;
  ipAddress: string | null;
}

interface PatientHistoryProps {
  patientId: string;
}

export function PatientHistory({ patientId }: PatientHistoryProps) {
  const [changes, setChanges] = useState<PatientChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterField, setFilterField] = useState<string>('');
  const [filterUser, setFilterUser] = useState<string>('');

  useEffect(() => {
    const fetchChanges = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (filterField) params.append('field_name', filterField);
        if (filterUser) params.append('changed_by', filterUser);
        
        const response = await fetch(`/api/patients/${patientId}/changes?${params.toString()}`);
        
        if (!response.ok) {
          throw new Error('Hiba történt a változások lekérdezésekor');
        }
        
        const data = await response.json();
        setChanges(data.changes || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ismeretlen hiba');
      } finally {
        setLoading(false);
      }
    };

    fetchChanges();
  }, [patientId, filterField, filterUser]);

  const formatDateTime = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString('hu-HU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  const formatValue = (value: string | null): string => {
    if (!value || value === '') return '(üres)';
    
    // Try to parse JSON if it looks like JSON
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object') {
        return JSON.stringify(parsed, null, 2);
      }
    } catch {
      // Not JSON, return as is
    }
    
    return value;
  };

  const getUserDisplayName = (email: string): string => {
    return email.split('@')[0];
  };

  // Group changes by date
  const groupedChanges = changes.reduce((acc, change) => {
    const date = new Date(change.changedAt).toLocaleDateString('hu-HU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(change);
    return acc;
  }, {} as Record<string, PatientChange[]>);

  // Get unique field names and users for filters
  const uniqueFields = Array.from(new Set(changes.map(c => c.fieldName))).sort();
  const uniqueUsers = Array.from(new Set(changes.map(c => c.changedBy))).sort();

  if (loading) {
    return (
      <div className="card p-8 text-center">
        <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4 animate-pulse" />
        <p className="text-gray-500">Betöltés...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6">
        <div className="text-red-600">
          <p className="font-medium">Hiba történt</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (changes.length === 0) {
    return (
      <div className="card p-8 text-center">
        <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-500">Nincsenek változások</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="card p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Mező szűrése
            </label>
            <select
              value={filterField}
              onChange={(e) => setFilterField(e.target.value)}
              className="form-select w-full"
            >
              <option value="">Összes mező</option>
              {uniqueFields.map((field) => {
                const change = changes.find(c => c.fieldName === field);
                return (
                  <option key={field} value={field}>
                    {change?.fieldDisplayName || field}
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Felhasználó szűrése
            </label>
            <select
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              className="form-select w-full"
            >
              <option value="">Összes felhasználó</option>
              {uniqueUsers.map((user) => (
                <option key={user} value={user}>
                  {getUserDisplayName(user)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="space-y-6">
        {Object.entries(groupedChanges)
          .sort(([dateA], [dateB]) => {
            // Sort dates descending (newest first)
            return new Date(dateB).getTime() - new Date(dateA).getTime();
          })
          .map(([date, dateChanges]) => (
            <div key={date} className="card p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-200">
                {date}
              </h3>
              <div className="space-y-4">
                {dateChanges.map((change) => (
                  <div
                    key={change.id}
                    className="flex gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    {/* Timeline indicator */}
                    <div className="flex-shrink-0">
                      <div className="w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="font-medium text-gray-900">
                            {change.fieldDisplayName}
                          </h4>
                          <div className="flex items-center gap-2 mt-1 text-sm text-gray-600">
                            <User className="w-4 h-4" />
                            <span>{getUserDisplayName(change.changedBy)}</span>
                            <span className="mx-1">•</span>
                            <Clock className="w-4 h-4" />
                            <span>{formatDateTime(change.changedAt)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Value change */}
                      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="p-3 bg-red-50 border border-red-200 rounded">
                          <div className="text-xs font-medium text-red-700 mb-1">
                            Régi érték
                          </div>
                          <div className="text-sm text-gray-800 break-words">
                            {formatValue(change.oldValue)}
                          </div>
                        </div>
                        <div className="flex items-center justify-center">
                          <ArrowRight className="w-5 h-5 text-gray-400" />
                        </div>
                        <div className="p-3 bg-green-50 border border-green-200 rounded">
                          <div className="text-xs font-medium text-green-700 mb-1">
                            Új érték
                          </div>
                          <div className="text-sm text-gray-800 break-words">
                            {formatValue(change.newValue)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}


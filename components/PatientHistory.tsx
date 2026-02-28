'use client';

import { useState, useEffect } from 'react';
import { Clock, User, ArrowRight, FileText, Eye, X } from 'lucide-react';
import { formatDateTime } from '@/lib/dateUtils';

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

interface Snapshot {
  id: string;
  createdAt: string;
  createdByUserId: string | null;
  createdByEmail: string | null;
  source: string;
}

interface SnapshotDetail {
  id: string;
  snapshotData: any; // Full patient object
  createdAt: string;
  createdByUserId: string | null;
  createdByEmail: string | null;
  source: string;
}

export function PatientHistory({ patientId }: PatientHistoryProps) {
  const [changes, setChanges] = useState<PatientChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterField, setFilterField] = useState<string>('');
  const [filterUser, setFilterUser] = useState<string>('');
  
  // Snapshots state
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(true);
  const [selectedSnapshot, setSelectedSnapshot] = useState<SnapshotDetail | null>(null);
  const [snapshotDetailLoading, setSnapshotDetailLoading] = useState(false);

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

  // Fetch snapshots
  useEffect(() => {
    const fetchSnapshots = async () => {
      try {
        setSnapshotsLoading(true);
        const response = await fetch(`/api/patients/${patientId}/snapshots`, {
          credentials: 'include',
        });
        
        if (!response.ok) {
          throw new Error('Hiba történt a snapshotok lekérdezésekor');
        }
        
        const data = await response.json();
        setSnapshots(data.snapshots || []);
      } catch (err) {
        console.error('Error fetching snapshots:', err);
        // Don't show error for snapshots, just log it
      } finally {
        setSnapshotsLoading(false);
      }
    };

    fetchSnapshots();
  }, [patientId]);

  const handleViewSnapshot = async (snapshotId: string) => {
    try {
      setSnapshotDetailLoading(true);
      const response = await fetch(`/api/patients/${patientId}/snapshots/${snapshotId}`, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Hiba történt a snapshot lekérdezésekor');
      }
      
      const data = await response.json();
      setSelectedSnapshot(data.snapshot);
    } catch (err) {
      console.error('Error fetching snapshot detail:', err);
      alert('Hiba történt a snapshot betöltésekor');
    } finally {
      setSnapshotDetailLoading(false);
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
      {/* Snapshots Section */}
      <div className="card p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5 text-medical-primary" />
          Verziók
        </h2>
        
        {snapshotsLoading ? (
          <div className="text-center py-4">
            <Clock className="w-8 h-8 text-gray-400 mx-auto mb-2 animate-pulse" />
            <p className="text-sm text-gray-500">Betöltés...</p>
          </div>
        ) : snapshots.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-gray-500">Nincsenek mentett verziók</p>
            <p className="text-sm text-gray-400 mt-1">
              A manuális mentések után itt jelennek meg a verziók.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {snapshots.map((snapshot) => (
              <div
                key={snapshot.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-900">
                      {formatDateTime(snapshot.createdAt)}
                    </span>
                  </div>
                  {snapshot.createdByEmail && (
                    <div className="flex items-center gap-2 mt-1 text-sm text-gray-600">
                      <User className="w-4 h-4" />
                      <span>{getUserDisplayName(snapshot.createdByEmail)}</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleViewSnapshot(snapshot.id)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-sm font-medium"
                  disabled={snapshotDetailLoading}
                >
                  <Eye className="w-4 h-4" />
                  Megtekintés
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Snapshot Detail Modal */}
      {selectedSnapshot && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Snapshot részletek
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  {formatDateTime(selectedSnapshot.createdAt)}
                  {selectedSnapshot.createdByEmail && (
                    <> • {getUserDisplayName(selectedSnapshot.createdByEmail)}</>
                  )}
                </p>
              </div>
              <button
                onClick={() => setSelectedSnapshot(null)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Bezárás"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <pre className="bg-gray-50 p-4 rounded-lg border border-gray-200 text-sm overflow-x-auto">
                {JSON.stringify(selectedSnapshot.snapshotData, null, 2)}
              </pre>
            </div>
            <div className="p-6 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setSelectedSnapshot(null)}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-md transition-colors"
              >
                Bezárás
              </button>
            </div>
          </div>
        </div>
      )}

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


'use client';

import { useState, useEffect } from 'react';
import { X, Users, Search, Check, Building2, Plus } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

interface Doctor {
  id: string;
  name: string;
  email: string;
  intezmeny: string | null;
}

interface CreateGroupChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGroupCreated?: () => void;
  existingGroupId?: string | null; // Ha van, akkor résztvevőket adunk hozzá
}

export function CreateGroupChatModal({ isOpen, onClose, onGroupCreated, existingGroupId }: CreateGroupChatModalProps) {
  const { showToast } = useToast();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [institutions, setInstitutions] = useState<string[]>([]);
  const [selectedDoctors, setSelectedDoctors] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInstitution, setSelectedInstitution] = useState<string>('');
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchDoctors();
      fetchInstitutions();
      // Reset state
      setSelectedDoctors(new Set());
      setSearchQuery('');
      setSelectedInstitution('');
      setGroupName('');
    }
  }, [isOpen]);

  const fetchDoctors = async () => {
    try {
      const response = await fetch('/api/users/doctors', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba az orvosok betöltésekor');
      }

      const data = await response.json();
      setDoctors(data.doctors || []);
    } catch (error) {
      console.error('Hiba az orvosok betöltésekor:', error);
      showToast('Hiba történt az orvosok betöltésekor', 'error');
    }
  };

  const fetchInstitutions = async () => {
    try {
      const response = await fetch('/api/institutions', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba az intézmények betöltésekor');
      }

      const data = await response.json();
      setInstitutions(data.institutions || []);
    } catch (error) {
      console.error('Hiba az intézmények betöltésekor:', error);
    }
  };

  const handleAddByInstitution = async () => {
    if (!selectedInstitution) {
      showToast('Kérjük, válasszon intézményt', 'error');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`/api/users/doctors/by-institution?institution=${encodeURIComponent(selectedInstitution)}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba az orvosok betöltésekor');
      }

      const data = await response.json();
      const institutionDoctors = data.doctors || [];
      
      // Add all doctors from institution to selected list
      const newSelected = new Set(selectedDoctors);
      institutionDoctors.forEach((doctor: Doctor) => {
        newSelected.add(doctor.id);
      });
      
      setSelectedDoctors(newSelected);
      showToast(`${institutionDoctors.length} orvos hozzáadva az intézményből`, 'success');
      setSelectedInstitution(''); // Reset selection
    } catch (error) {
      console.error('Hiba az intézmény orvosainak betöltésekor:', error);
      showToast('Hiba történt az orvosok betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleDoctor = (doctorId: string) => {
    const newSelected = new Set(selectedDoctors);
    if (newSelected.has(doctorId)) {
      newSelected.delete(doctorId);
    } else {
      // No limit - add doctor
      newSelected.add(doctorId);
    }
    setSelectedDoctors(newSelected);
  };

  const handleCreateGroup = async () => {
    if (selectedDoctors.size === 0) {
      showToast('Kérjük, válasszon legalább egy orvost', 'error');
      return;
    }

    try {
      setCreating(true);

      if (existingGroupId) {
        // Add participants to existing group
        const response = await fetch(`/api/doctor-messages/groups/${existingGroupId}/participants`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            participantIds: Array.from(selectedDoctors),
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Hiba a résztvevők hozzáadásakor');
        }

        showToast('Résztvevők sikeresen hozzáadva', 'success');
      } else {
        // Create new group
        const response = await fetch('/api/doctor-messages/groups', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            participantIds: Array.from(selectedDoctors),
            name: groupName.trim() || null,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Hiba a csoportos beszélgetés létrehozásakor');
        }

        showToast('Csoportos beszélgetés sikeresen létrehozva', 'success');
      }

      onGroupCreated?.();
      onClose();
    } catch (error: any) {
      console.error('Hiba a csoportos beszélgetés létrehozásakor:', error);
      showToast(error.message || 'Hiba történt a csoportos beszélgetés létrehozásakor', 'error');
    } finally {
      setCreating(false);
    }
  };

  const filteredDoctors = doctors.filter(doctor => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      doctor.name.toLowerCase().includes(query) ||
      doctor.email.toLowerCase().includes(query) ||
      (doctor.intezmeny && doctor.intezmeny.toLowerCase().includes(query))
    );
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            <Users className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-900">
              {existingGroupId ? 'Résztvevők hozzáadása' : 'Új csoportos beszélgetés'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Group Name - only for new groups */}
          {!existingGroupId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Csoport neve (opcionális)
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="pl. Sebészeti konzílium"
                className="form-input w-full"
              />
            </div>
          )}

          {/* Add by Institution */}
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="w-5 h-5 text-gray-600" />
              <h3 className="font-medium text-gray-900">Hozzáadás intézmény szerint</h3>
            </div>
            <div className="flex gap-2">
              <select
                value={selectedInstitution}
                onChange={(e) => setSelectedInstitution(e.target.value)}
                className="form-select flex-1"
                disabled={loading}
              >
                <option value="">Válasszon intézményt...</option>
                {institutions.map((institution) => (
                  <option key={institution} value={institution}>
                    {institution}
                  </option>
                ))}
              </select>
              <button
                onClick={handleAddByInstitution}
                disabled={!selectedInstitution || loading}
                className="btn-secondary flex items-center gap-2 px-4"
              >
                {loading ? '...' : (
                  <>
                    <Plus className="w-4 h-4" />
                    Hozzáadás
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Search */}
          <div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Orvos keresése..."
                className="form-input w-full pl-10"
              />
            </div>
          </div>

          {/* Selected Count */}
          {selectedDoctors.size > 0 && (
            <div className="text-sm text-gray-600">
              {selectedDoctors.size} orvos kiválasztva
            </div>
          )}

          {/* Doctors List */}
          <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
            {filteredDoctors.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                Nincs találat
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {filteredDoctors.map((doctor) => {
                  const isSelected = selectedDoctors.has(doctor.id);
                  return (
                    <div
                      key={doctor.id}
                      onClick={() => handleToggleDoctor(doctor.id)}
                      className={`p-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                        isSelected ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">{doctor.name}</div>
                          <div className="text-sm text-gray-500">{doctor.email}</div>
                          {doctor.intezmeny && (
                            <div className="text-xs text-gray-400 mt-0.5">{doctor.intezmeny}</div>
                          )}
                        </div>
                        {isSelected && (
                          <Check className="w-5 h-5 text-blue-600" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="btn-secondary px-4 py-2"
            disabled={creating}
          >
            Mégse
          </button>
          <button
            onClick={handleCreateGroup}
            disabled={selectedDoctors.size === 0 || creating}
            className="btn-primary px-4 py-2 flex items-center gap-2"
          >
            {creating ? (existingGroupId ? 'Hozzáadás...' : 'Létrehozás...') : (
              <>
                <Users className="w-4 h-4" />
                {existingGroupId ? 'Résztvevők hozzáadása' : 'Csoportos beszélgetés létrehozása'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}


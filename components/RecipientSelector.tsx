'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Search, User, Users, Building2, Plus } from 'lucide-react';

interface Doctor {
  id: string;
  name: string;
  email: string;
  intezmeny: string | null;
}

interface RecipientSelectorProps {
  selectedRecipients: Doctor[];
  onRecipientsChange: (recipients: Doctor[]) => void;
  placeholder?: string;
}

export function RecipientSelector({
  selectedRecipients,
  onRecipientsChange,
  placeholder = 'Címzett(ek) keresése...',
}: RecipientSelectorProps) {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [institutions, setInstitutions] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [addedInstitutions, setAddedInstitutions] = useState<Set<string>>(new Set());
  const [showDropdown, setShowDropdown] = useState(false);
  const [showInstitutionSelector, setShowInstitutionSelector] = useState(false);
  const [loading, setLoading] = useState(false);
  const [addingInstitution, setAddingInstitution] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const institutionSelectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'RecipientSelector.tsx:36',message:'useEffect triggered, fetching data',data:{timestamp:Date.now()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    fetchDoctors();
    fetchInstitutions();
  }, []);

  const fetchInstitutions = async () => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'RecipientSelector.tsx:41',message:'fetchInstitutions called',data:{timestamp:Date.now()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    try {
      const response = await fetch('/api/institutions', {
        credentials: 'include',
      });
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'RecipientSelector.tsx:48',message:'fetchInstitutions response',data:{ok:response.ok,status:response.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      if (!response.ok) {
        throw new Error('Hiba az intézmények betöltésekor');
      }

      const data = await response.json();
      setInstitutions(data.institutions || []);
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'RecipientSelector.tsx:58',message:'fetchInstitutions error',data:{error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      console.error('Hiba az intézmények betöltésekor:', error);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      // Close dropdown if clicking outside
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        inputRef.current &&
        !inputRef.current.contains(target)
      ) {
        setShowDropdown(false);
      }

      // Close institution selector if clicking outside
      if (
        institutionSelectorRef.current &&
        !institutionSelectorRef.current.contains(target) &&
        !(target as HTMLElement).closest('[data-institution-selector-button]')
      ) {
        setShowInstitutionSelector(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchDoctors = async () => {
    try {
      setLoading(true);
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
    } finally {
      setLoading(false);
    }
  };

  const handleAddInstitution = async (institution: string) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'RecipientSelector.tsx:106',message:'handleAddInstitution entry',data:{institution,currentRecipientsCount:selectedRecipients.length,addedInstitutions:Array.from(addedInstitutions)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (addedInstitutions.has(institution)) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'RecipientSelector.tsx:109',message:'Institution already added, returning early',data:{institution},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      return; // Already added
    }

    try {
      setAddingInstitution(true);
      const response = await fetch(`/api/users/doctors/by-institution?institution=${encodeURIComponent(institution)}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba az orvosok betöltésekor');
      }

      const data = await response.json();
      const institutionDoctors = data.doctors || [];
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'RecipientSelector.tsx:125',message:'Institution doctors fetched',data:{institution,institutionDoctorsCount:institutionDoctors.length,currentRecipientsCount:selectedRecipients.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      // Add all doctors from institution, excluding already selected ones
      const newRecipients = [...selectedRecipients];
      const currentRecipientIds = new Set(selectedRecipients.map(r => r.id));
      let addedCount = 0;
      
      institutionDoctors.forEach((doctor: Doctor) => {
        if (!currentRecipientIds.has(doctor.id)) {
          // No limit - add all doctors
          newRecipients.push(doctor);
          addedCount++;
        }
      });
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'RecipientSelector.tsx:137',message:'After adding institution doctors',data:{institution,addedCount,newRecipientsCount:newRecipients.length},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      onRecipientsChange(newRecipients);
      setAddedInstitutions(new Set([...Array.from(addedInstitutions), institution]));
      setShowInstitutionSelector(false);
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'RecipientSelector.tsx:145',message:'Error adding institution',data:{institution,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      console.error('Hiba az intézmény orvosainak betöltésekor:', error);
    } finally {
      setAddingInstitution(false);
    }
  };

  const handleRemoveInstitution = (institution: string) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'RecipientSelector.tsx:147',message:'handleRemoveInstitution entry',data:{institution,currentRecipientsCount:selectedRecipients.length,addedInstitutions:Array.from(addedInstitutions)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    // Remove all doctors from this institution
    const newRecipients = selectedRecipients.filter(r => r.intezmeny !== institution);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'RecipientSelector.tsx:150',message:'After filtering recipients',data:{institution,removedCount:selectedRecipients.length - newRecipients.length,newRecipientsCount:newRecipients.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    onRecipientsChange(newRecipients);
    
    const newAddedInstitutions = new Set(addedInstitutions);
    newAddedInstitutions.delete(institution);
    setAddedInstitutions(newAddedInstitutions);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'RecipientSelector.tsx:156',message:'After updating addedInstitutions',data:{institution,newAddedInstitutions:Array.from(newAddedInstitutions)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
  };

  const filteredDoctors = doctors.filter(doctor => {
    // Exclude already selected doctors
    if (selectedRecipients.some(r => r.id === doctor.id)) {
      return false;
    }

    // Filter by search query
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      doctor.name.toLowerCase().includes(query) ||
      doctor.email.toLowerCase().includes(query) ||
      (doctor.intezmeny && doctor.intezmeny.toLowerCase().includes(query))
    );
  });

  const handleSelectDoctor = (doctor: Doctor) => {
    // No limit - add doctor
    onRecipientsChange([...selectedRecipients, doctor]);
    setSearchQuery('');
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  const handleRemoveRecipient = (doctorId: string) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'RecipientSelector.tsx:187',message:'handleRemoveRecipient entry',data:{doctorId,currentRecipientsCount:selectedRecipients.length,addedInstitutions:Array.from(addedInstitutions)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    const removedDoctor = selectedRecipients.find(r => r.id === doctorId);
    const newRecipients = selectedRecipients.filter(r => r.id !== doctorId);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'RecipientSelector.tsx:191',message:'After removing recipient',data:{doctorId,removedDoctorInstitution:removedDoctor?.intezmeny,newRecipientsCount:newRecipients.length,shouldRemoveInstitution:removedDoctor?.intezmeny && !newRecipients.some(r => r.intezmeny === removedDoctor.intezmeny)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    onRecipientsChange(newRecipients);
    
    // Check if institution should be removed from addedInstitutions
    if (removedDoctor?.intezmeny) {
      const hasOtherDoctorsFromInstitution = newRecipients.some(r => r.intezmeny === removedDoctor.intezmeny);
      if (!hasOtherDoctorsFromInstitution && addedInstitutions.has(removedDoctor.intezmeny)) {
        const newAddedInstitutions = new Set(addedInstitutions);
        newAddedInstitutions.delete(removedDoctor.intezmeny);
        setAddedInstitutions(newAddedInstitutions);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'RecipientSelector.tsx:201',message:'Removed institution from addedInstitutions',data:{institution:removedDoctor.intezmeny},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
      }
    }
  };

  const handleInputFocus = () => {
    setShowDropdown(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setShowDropdown(true);
  };

  return (
    <div className="relative">
      {/* Selected Recipients */}
      {selectedRecipients.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedRecipients.map((recipient) => (
            <div
              key={recipient.id}
              className="flex items-center gap-1.5 bg-blue-100 text-blue-800 px-2 py-1 rounded-md text-sm"
            >
              <User className="w-3.5 h-3.5" />
              <span>{recipient.name}</span>
              <button
                onClick={() => handleRemoveRecipient(recipient.id)}
                className="hover:bg-blue-200 rounded p-0.5 transition-colors"
                type="button"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Added Institutions */}
      {addedInstitutions.size > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {Array.from(addedInstitutions).map((institution) => (
            <div
              key={institution}
              className="flex items-center gap-1.5 bg-green-100 text-green-800 px-2 py-1 rounded-md text-sm"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span className="max-w-[150px] truncate">{institution}</span>
              <button
                onClick={() => handleRemoveInstitution(institution)}
                className="hover:bg-green-200 rounded p-0.5 transition-colors"
                type="button"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Institution Selector */}
      <div className="mb-2 relative">
        <button
          data-institution-selector-button
          onClick={() => setShowInstitutionSelector(!showInstitutionSelector)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
          type="button"
          disabled={addingInstitution}
        >
          <Building2 className="w-4 h-4" />
          <Plus className="w-4 h-4" />
          <span>Intézmény hozzáadása</span>
        </button>
        {showInstitutionSelector && (
          <div
            ref={institutionSelectorRef}
            className="absolute z-50 mt-2 w-full border border-gray-200 rounded-lg bg-white shadow-lg max-h-60 overflow-y-auto"
          >
            <div className="p-2">
              {institutions.length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-sm">Nincs elérhető intézmény</div>
              ) : (
                institutions.map((institution) => {
                  const isAdded = addedInstitutions.has(institution);
                  return (
                    <div
                      key={institution}
                      className={`p-2 rounded text-sm transition-colors ${
                        isAdded
                          ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                          : 'hover:bg-gray-50 cursor-pointer'
                      }`}
                      onClick={() => !isAdded && handleAddInstitution(institution)}
                    >
                      <div className="flex items-center justify-between">
                        <span>{institution}</span>
                        {isAdded && (
                          <span className="text-xs text-green-600">✓ Hozzáadva</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          placeholder={placeholder}
          className="form-input w-full pl-10 pr-10"
        />
        {selectedRecipients.length > 1 && (
          <Users className="absolute right-3 top-1/2 transform -translate-y-1/2 text-blue-600 w-4 h-4" />
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto"
        >
          {loading ? (
            <div className="p-4 text-center text-gray-500 text-sm">Betöltés...</div>
          ) : filteredDoctors.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              {searchQuery ? 'Nincs találat' : 'Minden orvos hozzá van adva'}
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredDoctors.map((doctor) => (
                <div
                  key={doctor.id}
                  onClick={() => handleSelectDoctor(doctor)}
                  className="p-3 cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <div className="font-medium text-sm text-gray-900">{doctor.name}</div>
                  <div className="text-xs text-gray-500">{doctor.email}</div>
                  {doctor.intezmeny && (
                    <div className="text-xs text-gray-400 mt-0.5">{doctor.intezmeny}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Hint */}
      {selectedRecipients.length === 0 && (
        <div className="text-xs text-gray-500 mt-1">
          Írjon be egy nevet vagy válasszon a listából
        </div>
      )}
      {selectedRecipients.length > 1 && (
        <div className="text-xs text-blue-600 mt-1 flex items-center gap-1">
          <Users className="w-3 h-3" />
          Csoportos beszélgetés lesz ({selectedRecipients.length} résztvevő)
        </div>
      )}
    </div>
  );
}


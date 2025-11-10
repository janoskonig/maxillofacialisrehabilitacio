'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Patient, patientSchema, beutaloIntezmenyOptions, nyakiBlokkdisszekcioOptions, fabianFejerdyProtetikaiOsztalyOptions, kezelesiTervOptions, kezelesiTervArcotErintoTipusOptions, kezelesiTervArcotErintoElhorgonyzasOptions } from '@/lib/types';
import { formatDateForInput } from '@/lib/dateUtils';
import { X, Calendar, User, Phone, Mail, MapPin, FileText, AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { AppointmentBookingSection } from './AppointmentBookingSection';
import { getCurrentUser } from '@/lib/auth';
import { DatePicker } from './DatePicker';

const DRAFT_STORAGE_KEY_PREFIX = 'patientFormDraft_';
const DRAFT_TIMESTAMP_KEY_PREFIX = 'patientFormDraftTimestamp_';

// Helper to get storage keys based on patient ID
const getDraftStorageKey = (patientId: string | undefined | null): string => {
  return patientId ? `${DRAFT_STORAGE_KEY_PREFIX}${patientId}` : `${DRAFT_STORAGE_KEY_PREFIX}new`;
};

const getDraftTimestampKey = (patientId: string | undefined | null): string => {
  return patientId ? `${DRAFT_TIMESTAMP_KEY_PREFIX}${patientId}` : `${DRAFT_TIMESTAMP_KEY_PREFIX}new`;
};

// Fog állapot típus
type ToothStatus = { status?: 'D' | 'F' | 'M'; description?: string } | string;

// Helper függvény: string-et objektummá konvertál (visszafelé kompatibilitás)
function normalizeToothData(value: ToothStatus | undefined): { status?: 'D' | 'F' | 'M'; description?: string } | null {
  if (!value) return null;
  if (typeof value === 'string') {
    return { description: value };
  }
  return value;
}

// Helper függvény: fog állapot lekérdezése
function getToothState(value: ToothStatus | undefined): 'empty' | 'present' | 'missing' {
  const normalized = normalizeToothData(value);
  if (!normalized) return 'empty';
  if (normalized.status === 'M') return 'missing';
  return 'present';
}

// ToothCheckbox komponens - háromállapotú
interface ToothCheckboxProps {
  toothNumber: string;
  value: ToothStatus | undefined;
  onChange: () => void;
  disabled?: boolean;
}

function ToothCheckbox({ toothNumber, value, onChange, disabled }: ToothCheckboxProps) {
  const state = getToothState(value);
  const isPresent = state === 'present';
  const isMissing = state === 'missing';
  const isChecked = state !== 'empty';

  return (
    <div className="flex flex-col items-center gap-1">
      <label 
        htmlFor={`tooth-${toothNumber}`}
        className="text-xs text-gray-600 font-medium cursor-pointer"
      >
        {toothNumber}
      </label>
      <div className="relative">
      <input
        id={`tooth-${toothNumber}`}
        type="checkbox"
          checked={isChecked}
        onChange={() => {
          if (!disabled) {
            onChange();
          }
        }}
        onClick={(e) => {
          e.stopPropagation();
        }}
        disabled={disabled}
          className={`w-7 h-7 rounded border-2 focus:ring-2 focus:ring-medical-primary focus:ring-offset-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 appearance-none ${
            isMissing 
              ? 'border-gray-400 bg-gray-200' 
              : isPresent 
                ? 'border-medical-primary text-medical-primary' 
                : 'border-gray-300 text-medical-primary'
          }`}
          style={{
            backgroundImage: isMissing 
              ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'%3E%3Cpath d='M2 2 L12 12 M12 2 L2 12' stroke='%23333' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E")`
              : isChecked && !isMissing
                ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'%3E%3Cpath d='M2 7 L6 11 L12 3' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E")`
                : 'none',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            backgroundSize: '14px 14px'
          }}
        />
      </div>
    </div>
  );
}

interface PatientFormProps {
  patient?: Patient | null;
  onSave: (patient: Patient) => void;
  onCancel: () => void;
  isViewOnly?: boolean;
}

export function PatientForm({ patient, onSave, onCancel, isViewOnly = false }: PatientFormProps) {
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
  const [userRole, setUserRole] = useState<string>('');
  const [kezeloorvosOptions, setKezeloorvosOptions] = useState<string[]>([]);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isNewPatient = !patient && !isViewOnly;
  const patientId = patient?.id || null;

  // State for "vanBeutalo" toggle (default true if bármely beutaló-adat van, or always true for new patients if surgeon role)
  // Note: userRole might not be loaded yet, so we'll update it in useEffect
  const initialVanBeutalo = !!(patient?.beutaloOrvos || patient?.beutaloIntezmeny || patient?.kezelesreErkezesIndoka);
  const [vanBeutalo, setVanBeutalo] = useState(initialVanBeutalo);

  // Get user role and load kezelőorvos options
  useEffect(() => {
    const checkRole = async () => {
      const user = await getCurrentUser();
      if (user) {
        setUserRole(user.role);
        // If surgeon role and new patient, set vanBeutalo to true
        if (user.role === 'sebészorvos' && isNewPatient && !initialVanBeutalo) {
          setVanBeutalo(true);
        }
      }
    };
    checkRole();
  }, [isNewPatient, initialVanBeutalo]);

  // Load kezelőorvos options from API
  useEffect(() => {
    const loadKezeloorvosOptions = async () => {
      try {
        const response = await fetch('/api/users/fogpotlastanasz');
        if (response.ok) {
          const data = await response.json();
          // Extract display names from the users
          const names = data.users.map((user: { displayName: string }) => user.displayName);
          setKezeloorvosOptions(names);
        } else {
          console.error('Failed to load kezelőorvos options');
          // Fallback to empty array if API fails
          setKezeloorvosOptions([]);
        }
      } catch (error) {
        console.error('Error loading kezelőorvos options:', error);
        // Fallback to empty array if API fails
        setKezeloorvosOptions([]);
      }
    };
    loadKezeloorvosOptions();
  }, []);

  // Helper function to load draft from localStorage
  const loadDraft = useCallback((): Patient | null => {
    try {
      const storageKey = getDraftStorageKey(patientId);
      const draftData = localStorage.getItem(storageKey);
      if (!draftData) return null;
      
      const parsed = JSON.parse(draftData);
      return parsed as Patient;
    } catch (error) {
      console.error('Hiba a piszkozat betöltésekor:', error);
      return null;
    }
  }, [patientId]);

  // Helper function to save draft to localStorage
  const saveDraft = useCallback((formData: Partial<Patient>) => {
    try {
      const storageKey = getDraftStorageKey(patientId);
      const timestampKey = getDraftTimestampKey(patientId);
      localStorage.setItem(storageKey, JSON.stringify(formData));
      localStorage.setItem(timestampKey, new Date().toISOString());
    } catch (error) {
      console.error('Hiba a piszkozat mentésekor:', error);
    }
  }, [patientId]);

  // Helper function to clear draft from localStorage
  const clearDraft = useCallback(() => {
    try {
      const storageKey = getDraftStorageKey(patientId);
      const timestampKey = getDraftTimestampKey(patientId);
      localStorage.removeItem(storageKey);
      localStorage.removeItem(timestampKey);
    } catch (error) {
      console.error('Hiba a piszkozat törlésekor:', error);
    }
  }, [patientId]);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    setValue,
    watch,
    reset,
  } = useForm<Patient>({
    resolver: zodResolver(patientSchema),
    defaultValues: patient ? {
      ...patient,
      szuletesiDatum: formatDateForInput(patient.szuletesiDatum),
      mutetIdeje: formatDateForInput(patient.mutetIdeje),
      felvetelDatuma: formatDateForInput(patient.felvetelDatuma),
      kezelesiTervFelso: patient.kezelesiTervFelso?.map(item => ({
        ...item,
        tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma)
      })) || [],
      kezelesiTervAlso: patient.kezelesiTervAlso?.map(item => ({
        ...item,
        tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma)
      })) || [],
      kezelesiTervArcotErinto: patient.kezelesiTervArcotErinto?.map(item => ({
        ...item,
        tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma)
      })) || [],
    } : {
      radioterapia: false,
      chemoterapia: false,
      nemIsmertPoziciokbanImplantatum: false,
      felsoFogpotlasVan: false,
      felsoFogpotlasElegedett: true,
      alsoFogpotlasVan: false,
      alsoFogpotlasElegedett: true,
      kezelesiTervFelso: [],
      kezelesiTervAlso: [],
      kezelesiTervArcotErinto: [],
    },
  });

  // Reset form to mark as not dirty after initial load for existing patients
  useEffect(() => {
    if (patient && !isViewOnly) {
      // Reset form with current values to clear dirty state
      reset(patient ? {
        ...patient,
        szuletesiDatum: formatDateForInput(patient.szuletesiDatum),
        mutetIdeje: formatDateForInput(patient.mutetIdeje),
        felvetelDatuma: formatDateForInput(patient.felvetelDatuma),
        kezelesiTervFelso: patient.kezelesiTervFelso?.map(item => ({
          ...item,
          tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma)
        })) || [],
        kezelesiTervAlso: patient.kezelesiTervAlso?.map(item => ({
          ...item,
          tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma)
        })) || [],
        kezelesiTervArcotErinto: patient.kezelesiTervArcotErinto?.map(item => ({
          ...item,
          tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma)
        })) || [],
      } : undefined, { keepDefaultValues: true });
    }
  }, [patient?.id]); // Only reset when patient ID changes (when opening a different patient)

  const radioterapia = watch('radioterapia');
  const chemoterapia = watch('chemoterapia');
  const kezeleoorvos = watch('kezeleoorvos');
  const nemIsmertPoziciokbanImplantatum = watch('nemIsmertPoziciokbanImplantatum');
  const felsoFogpotlasVan = watch('felsoFogpotlasVan');
  const felsoFogpotlasElegedett = watch('felsoFogpotlasElegedett');
  const alsoFogpotlasVan = watch('alsoFogpotlasVan');
  const alsoFogpotlasElegedett = watch('alsoFogpotlasElegedett');
  const [implantatumok, setImplantatumok] = useState<Record<string, string>>(patient?.meglevoImplantatumok || {});
  const [fogak, setFogak] = useState<Record<string, ToothStatus>>(() => {
    // Visszafelé kompatibilitás: string értékeket megtartjuk, új objektumokat is elfogadunk
    const initial = patient?.meglevoFogak || {};
    return initial as Record<string, ToothStatus>;
  });
  const kezelesiTervFelso = watch('kezelesiTervFelso') || [];
  const kezelesiTervAlso = watch('kezelesiTervAlso') || [];
  const kezelesiTervArcotErinto = watch('kezelesiTervArcotErinto') || [];

  // Watch all form values for auto-save
  const formValues = watch();

  // Load draft when opening patient form (after form is initialized)
  useEffect(() => {
    if (!isViewOnly && !hasRestoredDraft) {
      const draft = loadDraft();
      if (draft) {
        const timestampKey = getDraftTimestampKey(patientId);
        const timestamp = localStorage.getItem(timestampKey);
        const draftDate = timestamp ? new Date(timestamp) : null;
        const now = new Date();
        const hoursSinceDraft = draftDate ? (now.getTime() - draftDate.getTime()) / (1000 * 60 * 60) : 0;
        
        // Only show restore prompt if draft is less than 7 days old
        if (hoursSinceDraft < 168) {
          // For existing patients, always restore silently (no prompt)
          // For new patients, ask for confirmation
          const shouldRestore = isNewPatient 
            ? window.confirm(
                `Van egy mentett piszkozat az űrlapból (${draftDate ? draftDate.toLocaleString('hu-HU') : 'korábban'}). Szeretné visszatölteni?`
              )
            : true; // Always restore for existing patients
          
          if (shouldRestore) {
            // Restore draft data
            Object.keys(draft).forEach((key) => {
              const value = draft[key as keyof Patient];
              if (value !== undefined && value !== null) {
                setValue(key as keyof Patient, value as any, { shouldValidate: false });
              }
            });
            
            // Restore implantatumok and fogak if they exist
            if (draft.meglevoImplantatumok) {
              setImplantatumok(draft.meglevoImplantatumok);
            }
            if (draft.meglevoFogak) {
              setFogak(draft.meglevoFogak);
            }
            if (draft.beutaloOrvos || draft.beutaloIntezmeny || draft.mutetRovidLeirasa) {
              setVanBeutalo(true);
            }
          } else {
            // User chose not to restore, clear the draft
            clearDraft();
          }
        } else {
          // Draft is too old, clear it
          clearDraft();
        }
        setHasRestoredDraft(true);
      } else {
        setHasRestoredDraft(true);
      }
    }
  }, [isViewOnly, hasRestoredDraft, isNewPatient, patientId, loadDraft, clearDraft, setValue, setImplantatumok, setFogak, setVanBeutalo]);

  // Implantátumok frissítése amikor patient változik
  useEffect(() => {
    if (patient?.meglevoImplantatumok) {
      setImplantatumok(patient.meglevoImplantatumok);
    } else {
      setImplantatumok({});
    }
    if (patient?.meglevoFogak) {
      // Visszafelé kompatibilitás: elfogadjuk string és objektum formátumot is
      setFogak(patient.meglevoFogak as Record<string, ToothStatus>);
    } else {
      setFogak({});
    }
  }, [patient]);

  // Auto-save draft to localStorage (only for new patients, not for existing patients without changes)
  useEffect(() => {
    if (isViewOnly || !hasRestoredDraft) {
      return;
    }

    // For existing patients, only save draft if form is dirty (has changes)
    if (!isNewPatient && !isDirty) {
      // No changes for existing patient, clear any existing draft
      clearDraft();
      return;
    }

    // Clear previous timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce: save after 500ms of inactivity
    saveTimeoutRef.current = setTimeout(() => {
      // Normalizáljuk a fogak adatokat mentés előtt
      const normalizedFogak: Record<string, { status?: 'D' | 'F' | 'M'; description?: string }> = {};
      Object.entries(fogak).forEach(([toothNumber, value]) => {
        const normalizedValue = normalizeToothData(value);
        if (normalizedValue) {
          normalizedFogak[toothNumber] = normalizedValue;
        }
      });
      
      const formData: Partial<Patient> = {
        ...formValues,
        meglevoImplantatumok: implantatumok,
        meglevoFogak: normalizedFogak,
      };
      
      // Only save if there's at least some data filled in
      const hasData = Object.values(formData).some(value => {
        if (value === null || value === undefined || value === '') return false;
        if (typeof value === 'object' && Object.keys(value).length === 0) return false;
        if (Array.isArray(value) && value.length === 0) return false;
        return true;
      });

      if (hasData) {
        saveDraft(formData);
      } else {
        clearDraft();
      }
    }, 500);

    // Cleanup timeout on unmount
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [formValues, implantatumok, fogak, isViewOnly, hasRestoredDraft, isNewPatient, isDirty, saveDraft, clearDraft]);

  // Automatikus intézet beállítás a kezelőorvos alapján
  useEffect(() => {
    if (kezeleoorvos && !isViewOnly) {
      // Fogpótlástani Klinika orvosok vezetéknevei (rugalmas névformátum kezelés)
      // A név bármilyen formátumban lehet (pl. "Dr. König", "König János dr.", "König János", stb.)
      const fogpotlastaniKlinikaVezeteknevek = ['Jász', 'Kádár', 'König', 'Takács', 'Körmendi', 'Tasi', 'Vánkos'];
      
      // Ellenőrizzük, hogy a kiválasztott kezelőorvos neve tartalmazza-e valamelyik vezetéknevet
      const isFogpotlastaniKlinika = fogpotlastaniKlinikaVezeteknevek.some(vezeteknev => 
        kezeleoorvos.toLowerCase().includes(vezeteknev.toLowerCase())
      );
      
      if (isFogpotlastaniKlinika) {
        setValue('kezeleoorvosIntezete', 'Fogpótlástani Klinika');
      } else {
        setValue('kezeleoorvosIntezete', 'Fogászati és Szájsebészeti Oktató Intézet');
      }
    }
  }, [kezeleoorvos, setValue, isViewOnly]);

  // Implantátumok frissítése a form-ban
  useEffect(() => {
    setValue('meglevoImplantatumok', implantatumok);
  }, [implantatumok, setValue]);

  // Fogazati státusz frissítése a form-ban - normalizálás mentés előtt
  useEffect(() => {
    // Normalizáljuk az adatokat: string értékeket objektummá konvertáljuk (visszafelé kompatibilitás)
    const normalized: Record<string, { status?: 'D' | 'F' | 'M'; description?: string }> = {};
    Object.entries(fogak).forEach(([toothNumber, value]) => {
      const normalizedValue = normalizeToothData(value);
      if (normalizedValue) {
        normalized[toothNumber] = normalizedValue;
      }
    });
    setValue('meglevoFogak', normalized);
  }, [fogak, setValue]);

  // KEZELÉSI TERV listák kezelése
  const addKezelesiTervFelso = () => {
    if (isViewOnly) return;
    const current = kezelesiTervFelso || [];
    setValue('kezelesiTervFelso', [
      ...current,
      { tipus: 'zárólemez', tervezettAtadasDatuma: null, elkeszult: false }
    ]);
  };

  const removeKezelesiTervFelso = (index: number) => {
    if (isViewOnly) return;
    const current = kezelesiTervFelso || [];
    setValue('kezelesiTervFelso', current.filter((_, i) => i !== index));
  };

  const updateKezelesiTervFelso = (index: number, field: 'tipus' | 'tervezettAtadasDatuma' | 'elkeszult', value: any) => {
    if (isViewOnly) return;
    const current = kezelesiTervFelso || [];
    const updated = [...current];
    updated[index] = { ...updated[index], [field]: value };
    setValue('kezelesiTervFelso', updated);
  };

  const addKezelesiTervAlso = () => {
    if (isViewOnly) return;
    const current = kezelesiTervAlso || [];
    setValue('kezelesiTervAlso', [
      ...current,
      { tipus: 'zárólemez', tervezettAtadasDatuma: null, elkeszult: false }
    ]);
  };

  const removeKezelesiTervAlso = (index: number) => {
    if (isViewOnly) return;
    const current = kezelesiTervAlso || [];
    setValue('kezelesiTervAlso', current.filter((_, i) => i !== index));
  };

  const updateKezelesiTervAlso = (index: number, field: 'tipus' | 'tervezettAtadasDatuma' | 'elkeszult', value: any) => {
    if (isViewOnly) return;
    const current = kezelesiTervAlso || [];
    const updated = [...current];
    updated[index] = { ...updated[index], [field]: value };
    setValue('kezelesiTervAlso', updated);
  };

  const addKezelesiTervArcotErinto = () => {
    if (isViewOnly) return;
    const current = kezelesiTervArcotErinto || [];
    setValue('kezelesiTervArcotErinto', [
      ...current,
      { tipus: 'orrepitézis', elhorgonyzasEszkoze: null, tervezettAtadasDatuma: null, elkeszult: false }
    ]);
  };

  const removeKezelesiTervArcotErinto = (index: number) => {
    if (isViewOnly) return;
    const current = kezelesiTervArcotErinto || [];
    setValue('kezelesiTervArcotErinto', current.filter((_, i) => i !== index));
  };

  const updateKezelesiTervArcotErinto = (index: number, field: 'tipus' | 'elhorgonyzasEszkoze' | 'tervezettAtadasDatuma' | 'elkeszult', value: any) => {
    if (isViewOnly) return;
    const current = kezelesiTervArcotErinto || [];
    const updated = [...current];
    updated[index] = { ...updated[index], [field]: value };
    setValue('kezelesiTervArcotErinto', updated);
  };

  const handleToothToggle = (toothNumber: string) => {
    if (isViewOnly) return;
    
    setImplantatumok(prev => {
      const currentValue = prev[toothNumber];
      if (currentValue !== undefined && currentValue !== null) {
        // Kipipálás - törlés
        const newState = { ...prev };
        delete newState[toothNumber];
        return newState;
      } else {
        // Pipálás - hozzáadás üres stringgel
        return { ...prev, [toothNumber]: '' };
      }
    });
  };

  const handleImplantatumDetailsChange = (toothNumber: string, details: string) => {
    if (isViewOnly) return;
    setImplantatumok(prev => ({ ...prev, [toothNumber]: details }));
  };

  // Háromállapotú toggle: üres → jelen → hiányzik → üres
  const handleToothStatusToggle = (toothNumber: string) => {
    if (isViewOnly) return;
    setFogak(prev => {
      const current = prev[toothNumber];
      const state = getToothState(current);
      
      if (state === 'empty') {
        // Üres → jelen (D/F kiválasztható, de még nincs kiválasztva)
        return { ...prev, [toothNumber]: {} };
      } else if (state === 'present') {
        // Jelen → hiányzik (M)
        return { ...prev, [toothNumber]: { status: 'M' } };
      } else {
        // Hiányzik → üres (törlés)
        const newState = { ...prev };
        delete newState[toothNumber];
        return newState;
      }
    });
  };

  // D vagy F kiválasztása amikor a fog jelen van
  const handleToothStatusSelect = (toothNumber: string, status: 'D' | 'F') => {
    if (isViewOnly) return;
    setFogak(prev => {
      const current = prev[toothNumber];
      const normalized = normalizeToothData(current);
      return { 
        ...prev, 
        [toothNumber]: { 
          status, 
          description: normalized?.description || '' 
        } 
      };
    });
  };

  const handleToothStatusDetailsChange = (toothNumber: string, details: string) => {
    if (isViewOnly) return;
    setFogak(prev => {
      const current = prev[toothNumber];
      const normalized = normalizeToothData(current);
      return { 
        ...prev, 
        [toothNumber]: { 
          status: normalized?.status, 
          description: details 
        } 
      };
    });
  };

  const onSubmit = (data: Patient) => {
    // Clear draft on successful save (for both new and existing patients)
    clearDraft();
    onSave(data);
  };

  // Check if form has unsaved changes
  const hasUnsavedChanges = useCallback(() => {
    if (isViewOnly) return false;
    
    // Check if form is dirty
    if (isDirty) return true;
    
    // Check if implantatumok or fogak have changed
    const originalImplantatumok = patient?.meglevoImplantatumok || {};
    const originalFogak = patient?.meglevoFogak || {};
    
    const implantatumokChanged = JSON.stringify(implantatumok) !== JSON.stringify(originalImplantatumok);
    const fogakChanged = JSON.stringify(fogak) !== JSON.stringify(originalFogak);
    
    if (implantatumokChanged || fogakChanged) return true;
    
    // Check if any form field has value (for new patients)
    if (isNewPatient) {
      const hasAnyValue = Object.values(formValues).some(value => {
        if (value === null || value === undefined || value === '') return false;
        if (typeof value === 'object' && Object.keys(value).length === 0) return false;
        if (Array.isArray(value) && value.length === 0) return false;
        if (typeof value === 'boolean' && value === false) return false;
        return true;
      });
      if (hasAnyValue || Object.keys(implantatumok).length > 0 || Object.keys(fogak).length > 0) {
        return true;
      }
    }
    
    return false;
  }, [isViewOnly, isDirty, patient, implantatumok, fogak, isNewPatient, formValues]);

  // Handle form cancellation - check for unsaved changes
  const handleCancel = () => {
    if (isViewOnly) {
      onCancel();
      return;
    }
    
    // For existing patients: only prompt if form is dirty (has actual changes)
    // For new patients: check if there's any data entered
    if (isNewPatient) {
      // New patient: check if there's any data
      if (hasUnsavedChanges()) {
        const shouldSave = window.confirm(
          'Van nem mentett változás az űrlapban. Szeretné menteni az eddig beírt adatokat piszkozatként? (A piszkozat később visszatölthető, de az adatok csak a "Beteg mentése" gombbal kerülnek az adatbázisba.)'
        );
        
        if (shouldSave) {
          // Save draft before closing
          // Normalizáljuk a fogak adatokat mentés előtt
          const normalizedFogak: Record<string, { status?: 'D' | 'F' | 'M'; description?: string }> = {};
          Object.entries(fogak).forEach(([toothNumber, value]) => {
            const normalizedValue = normalizeToothData(value);
            if (normalizedValue) {
              normalizedFogak[toothNumber] = normalizedValue;
            }
          });
          
          const formData: Partial<Patient> = {
            ...formValues,
            meglevoImplantatumok: implantatumok,
            meglevoFogak: normalizedFogak,
          };
          saveDraft(formData);
        } else {
          // User chose not to save, clear draft
          clearDraft();
        }
      }
    } else {
      // Existing patient: only prompt if form is dirty (has actual changes)
      // The isDirty flag should catch all changes including implantatumok and fogak
      // since we use setValue to update the form when these change
      if (isDirty) {
        const shouldSave = window.confirm(
          'Van nem mentett változás az űrlapban. Szeretné menteni az eddig beírt adatokat piszkozatként? (A piszkozat később visszatölthető, de az adatok csak a "Beteg mentése" gombbal kerülnek az adatbázisba.)'
        );
        
        if (shouldSave) {
          // Save draft before closing
          // Normalizáljuk a fogak adatokat mentés előtt
          const normalizedFogak: Record<string, { status?: 'D' | 'F' | 'M'; description?: string }> = {};
          Object.entries(fogak).forEach(([toothNumber, value]) => {
            const normalizedValue = normalizeToothData(value);
            if (normalizedValue) {
              normalizedFogak[toothNumber] = normalizedValue;
            }
          });
          
          const formData: Partial<Patient> = {
            ...formValues,
            meglevoImplantatumok: implantatumok,
            meglevoFogak: normalizedFogak,
          };
          saveDraft(formData);
        } else {
          // User chose not to save, clear draft
          clearDraft();
        }
      } else {
        // No changes for existing patient, clear any existing draft
        clearDraft();
      }
    }
    
    onCancel();
  };

  // Format TAJ number as XXX-XXX-XXX
  const formatTAJ = (value: string): string => {
    // Remove all non-digits
    const digits = value.replace(/\D/g, '');
    // Limit to 9 digits
    const limited = digits.slice(0, 9);
    // Format as XXX-XXX-XXX
    if (limited.length <= 3) {
      return limited;
    } else if (limited.length <= 6) {
      return `${limited.slice(0, 3)}-${limited.slice(3)}`;
    } else {
      return `${limited.slice(0, 3)}-${limited.slice(3, 6)}-${limited.slice(6)}`;
    }
  };

  // Format phone number: ensure it starts with +36 and limit to 11 digits after
  const formatPhoneNumber = (value: string): string => {
    // If empty, return empty
    if (!value || value.trim() === '') return '';
    
    // Extract all digits from the input
    const digits = value.replace(/\D/g, '');
    
    // If no digits, but user typed something (like +), show +36
    if (digits.length === 0 && value.includes('+')) {
      return '+36';
    }
    
    // If we have digits but doesn't start with +36, add it
    if (digits.length > 0 && !value.startsWith('+36')) {
      // Limit to 11 digits after +36
      const limited = digits.slice(0, 11);
      return `+36${limited}`;
    }
    
    // Already starts with +36
    if (value.startsWith('+36')) {
      // Extract digits after +36
      const afterPrefix = value.substring(3);
      const digitsAfter = afterPrefix.replace(/\D/g, '');
      // Limit to 11 digits
      const limited = digitsAfter.slice(0, 11);
      // If user is deleting and we're left with just +36, allow it
      if (limited.length === 0 && value === '+36') {
        return '+36';
      }
      return limited.length > 0 ? `+36${limited}` : '';
    }
    
    // Fallback: if we somehow have digits but no +36 prefix, add it
    if (digits.length > 0) {
      const limited = digits.slice(0, 11);
      return `+36${limited}`;
    }
    
    return '';
  };

  // Handle TAJ input change
  const handleTAJChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isViewOnly) return;
    const formatted = formatTAJ(e.target.value);
    setValue('taj', formatted, { shouldValidate: true });
  };

  // Handle phone number input change
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isViewOnly) return;
    const formatted = formatPhoneNumber(e.target.value);
    setValue('telefonszam', formatted, { shouldValidate: true });
  };

  // Handle date input change - allow typing, only format on blur
  const handleDateChange = (fieldName: 'szuletesiDatum' | 'mutetIdeje' | 'balesetIdopont', registerOnChange?: (e: React.ChangeEvent<HTMLInputElement>) => void) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isViewOnly) return;
      // Call register's onChange first if provided
      if (registerOnChange) {
        registerOnChange(e);
      }
      // Allow typing freely, just update the value
      setValue(fieldName, e.target.value, { shouldValidate: false });
    };
  };

  // Handle date blur - format to YYYY-MM-DD when user leaves the field
  const handleDateBlur = (fieldName: 'szuletesiDatum' | 'mutetIdeje' | 'balesetIdopont', registerOnBlur?: (e: React.FocusEvent<HTMLInputElement>) => void) => {
    return (e: React.FocusEvent<HTMLInputElement>) => {
      if (isViewOnly) return;
      // Call register's onBlur first if provided
      if (registerOnBlur) {
        registerOnBlur(e);
      }
      const formatted = formatDateForInput(e.target.value);
      if (formatted) {
        setValue(fieldName, formatted, { shouldValidate: true });
      }
    };
  };

  // Watch kezelésre érkezés indoka for conditional logic
  const selectedIndok = watch('kezelesreErkezesIndoka');

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-2xl font-bold text-gray-900">
          {isViewOnly ? 'Beteg megtekintése' : patient ? 'Beteg szerkesztése' : 'Új beteg'}
        </h3>
        <button
          onClick={handleCancel}
          className="text-gray-400 hover:text-gray-600"
          data-patient-form-cancel
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* ALAPADATOK */}
        <div className="card">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <User className="w-5 h-5 mr-2 text-medical-primary" />
            ALAPADATOK
          </h4>
          <div className="space-y-4">
            <div>
              <label className="form-label">NÉV</label>
              <input
                {...register('nev')}
                className="form-input"
                placeholder="Teljes név"
                readOnly={isViewOnly}
              />
              {errors.nev && (
                <p className="text-red-500 text-sm mt-1">{errors.nev.message}</p>
              )}
            </div>
            <div>
              <label className="form-label">TAJ</label>
              <input
                {...register('taj')}
                onChange={handleTAJChange}
                className="form-input"
                placeholder="000-000-000"
                readOnly={isViewOnly}
              />
              {errors.taj && (
                <p className="text-red-500 text-sm mt-1">{errors.taj.message}</p>
              )}
            </div>
            <div>
              <label className="form-label">TELEFONSZÁM</label>
              <input
                {...register('telefonszam')}
                onChange={handlePhoneChange}
                className="form-input"
                placeholder="+36..."
                readOnly={isViewOnly}
              />
              {errors.telefonszam && (
                <p className="text-red-500 text-sm mt-1">{errors.telefonszam.message}</p>
              )}
            </div>
          </div>
        </div>

        {/* SZEMÉLYES ADATOK */}
        <div className="card">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <MapPin className="w-5 h-5 mr-2 text-medical-primary" />
            SZEMÉLYES ADATOK
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Születési dátum</label>
              <DatePicker
                selected={watch('szuletesiDatum') ? new Date(watch('szuletesiDatum') || '') : null}
                onChange={(date: Date | null) => {
                  const formatted = date ? formatDateForInput(date.toISOString().split('T')[0]) : '';
                  setValue('szuletesiDatum', formatted, { shouldValidate: true });
                }}
                placeholder="Válasszon dátumot"
                disabled={isViewOnly}
                maxDate={new Date()}
              />
            </div>
            <div>
              <label className="form-label">Nem</label>
              <select {...register('nem')} className="form-input">
                <option value="">Válasszon...</option>
                <option value="ferfi">Férfi</option>
                <option value="no">Nő</option>
              </select>
            </div>
            <div>
              <label className="form-label">Email</label>
              <input
                {...register('email')}
                type="email"
                className="form-input"
                placeholder="Email cím"
              />
              {errors.email && (
                <p className="text-red-500 text-sm mt-1">{errors.email.message}</p>
              )}
            </div>
            <div>
              <label className="form-label">Cím</label>
              <input
                {...register('cim')}
                className="form-input"
                placeholder="Lakcím"
              />
            </div>
            <div>
              <label className="form-label">Város</label>
              <input
                {...register('varos')}
                className="form-input"
                placeholder="Város"
              />
            </div>
            <div>
              <label className="form-label">Irányítószám</label>
              <input
                {...register('iranyitoszam')}
                className="form-input"
                placeholder="Irányítószám"
              />
            </div>
          </div>
        </div>

        {/* BEUTALÓ */}
        <div className="card">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <FileText className="w-5 h-5 mr-2 text-medical-primary" />
            BEUTALÓ
          </h4>

          <div className="flex items-center mb-4">
            <input
              id="beutalo-toggle"
              type="checkbox"
              checked={vanBeutalo}
              onChange={() => setVanBeutalo((prev) => !prev)}
              className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
              disabled={isViewOnly}
            />
            <label htmlFor="beutalo-toggle" className="ml-2 text-sm text-gray-700">Van beutaló?</label>
          </div>

          {vanBeutalo && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Beutaló orvos</label>
                <input
                  {...register('beutaloOrvos')}
                  className="form-input"
                  placeholder="Beutaló orvos neve"
                  readOnly={isViewOnly}
                  disabled={!vanBeutalo}
                />
              </div>
              <div>
                <label className="form-label">Beutaló intézmény</label>
                <input
                  {...register('beutaloIntezmeny')}
                  list="beutalo-intezmeny-options"
                  className="form-input"
                  placeholder="Beutaló intézmény neve"
                  readOnly={isViewOnly}
                  disabled={!vanBeutalo}
                />
                <datalist id="beutalo-intezmeny-options">
                  {beutaloIntezmenyOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </div>
              <div className="md:col-span-2">
                <label className="form-label">Indokolás</label>
                <textarea
                  {...register('mutetRovidLeirasa')}
                  rows={3}
                  className="form-input"
                  placeholder="Miért kapott beutalót?"
                  readOnly={isViewOnly}
                  disabled={!vanBeutalo}
                />
              </div>
            </div>
          )}
        </div>

        {/* KEZELŐORVOS */}
        {userRole !== 'sebészorvos' && (
        <div className="card">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <User className="w-5 h-5 mr-2 text-medical-primary" />
            KEZELŐORVOS
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Kezelőorvos</label>
              <select {...register('kezeleoorvos')} className="form-input" disabled={isViewOnly}>
                <option value="">Válasszon...</option>
                {kezeloorvosOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Kezelőorvos intézete</label>
              <input
                {...register('kezeleoorvosIntezete')}
                className="form-input"
                placeholder="Automatikusan kitöltődik"
                readOnly
              />
            </div>
          </div>
        </div>
        )}

        {/* ANAMNÉZIS */}
        {userRole !== 'sebészorvos' && (
        <div className="card">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Calendar className="w-5 h-5 mr-2 text-medical-primary" />
            ANAMNÉZIS
          </h4>
          <div className="space-y-4">
            <div>
              <label className="form-label">Kezelésre érkezés indoka</label>
              <select {...register('kezelesreErkezesIndoka')} className="form-input" disabled={isViewOnly}>
                <option value="">Válasszon...</option>
                <option value="traumás sérülés">traumás sérülés</option>
                <option value="veleszületett rendellenesség">veleszületett rendellenesség</option>
                <option value="onkológiai kezelés utáni állapot">onkológiai kezelés utáni állapot</option>
              </select>
            </div>
            {/* Ezeket mindig mutatjuk, conditionaltól függetlenül */}
            <div>
              <label className="form-label">Alkoholfogyasztás</label>
              <textarea
                {...register('alkoholfogyasztas')}
                rows={2}
                className="form-input"
                placeholder="Szabadszavas leírás"
                readOnly={isViewOnly}
              />
            </div>
            <div>
              <label className="form-label">Dohányzás (n szál/nap)</label>
              <input
                {...register('dohanyzasSzam')}
                className="form-input"
                placeholder="pl. 10 szál/nap"
                readOnly={isViewOnly}
              />
            </div>

            {/* TRAUMA kérdések */}
            {selectedIndok === 'traumás sérülés' && (
              <>
                <div>
                  <label className="form-label">Baleset időpontja</label>
                  <DatePicker
                    selected={watch('balesetIdopont') ? new Date(watch('balesetIdopont') || '') : null}
                    onChange={(date: Date | null) => {
                      const formatted = date ? formatDateForInput(date.toISOString().split('T')[0]) : '';
                      setValue('balesetIdopont', formatted, { shouldValidate: true });
                    }}
                    placeholder="Válasszon dátumot"
                    disabled={isViewOnly}
                    maxDate={new Date()}
                  />
                </div>
                <div>
                  <label className="form-label">Baleset etiológiája</label>
                  <textarea
                    {...register('balesetEtiologiaja')}
                    rows={2}
                    className="form-input"
                    placeholder="Szabadszavas leírás (pl. közlekedési baleset, esés stb.)"
                    readOnly={isViewOnly}
                  />
                </div>
                <div>
                  <label className="form-label">Egyéb körülmények, műtétek</label>
                  <textarea
                    {...register('balesetEgyeb')}
                    rows={2}
                    className="form-input"
                    placeholder="Egyéb körülmények, műtétek, stb. (szabadszavas)"
                    readOnly={isViewOnly}
                  />
                </div>
              </>
            )}

            {/* ONKOLOGIA kérdések */}
            {selectedIndok === 'onkológiai kezelés utáni állapot' && (
              <>
                {/* BNO mező */}
                <div>
                  <label className="form-label">BNO</label>
                  <input
                    {...register('bno')}
                    className="form-input"
                    placeholder="BNO"
                    readOnly={isViewOnly}
                  />
                </div>
                {/* Diagnózis mező */}
                <div>
                  <label className="form-label">Diagnózis</label>
                  <input
                    {...register('diagnozis')}
                    className="form-input"
                    placeholder="Diagnózis"
                    readOnly={isViewOnly}
                  />
                </div>
                <div>
                  <label className="form-label">Tumor szövettani típusa</label>
                  <input
                    {...register('szovettaniDiagnozis')}
                    className="form-input"
                    placeholder="Szövettani diagnózis"
                    readOnly={isViewOnly}
                  />
                </div>
                {/* TNM-staging mező */}
                <div>
                  <label className="form-label">TNM-staging</label>
                  <input
                    {...register('tnmStaging')}
                    className="form-input"
                    placeholder="pl. pT3N2bM0, UICC 8. ed."
                    readOnly={isViewOnly}
                  />
                </div>
                {/* Műtét ideje csak onkológiai esetben */}
                <div>
                  <label className="form-label">Műtét ideje</label>
                  <DatePicker
                    selected={watch('mutetIdeje') ? new Date(watch('mutetIdeje') || '') : null}
                    onChange={(date: Date | null) => {
                      const formatted = date ? formatDateForInput(date.toISOString().split('T')[0]) : '';
                      setValue('mutetIdeje', formatted, { shouldValidate: true });
                    }}
                    placeholder="Válasszon dátumot"
                    disabled={isViewOnly}
                    maxDate={new Date()}
                  />
                </div>
                {/* Primer műtét leírása */}
                <div>
                  <label className="form-label">Primer műtét leírása</label>
                  <textarea
                    {...register('primerMutetLeirasa')}
                    rows={2}
                    className="form-input"
                    placeholder="Primer műtét rövid leírása (szabadszavas)"
                    readOnly={isViewOnly}
                  />
                </div>
                {/* Nyaki blokkdisszekció most itt */}
                <div>
                  <label className="form-label">Nyaki blokkdisszekció</label>
                  <select {...register('nyakiBlokkdisszekcio')} className="form-input" disabled={isViewOnly}>
                    <option value="">Válasszon...</option>
                    {nyakiBlokkdisszekcioOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                {/* Adjuváns terápiák blokk (mindig utolsó onkológiai kérdés ebben a conditionalban) */}
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h5 className="text-md font-semibold text-gray-900 mb-4">Adjuváns terápiák</h5>
                  <div className="space-y-4">
                    <div className="flex items-center">
                      <input
                        {...register('radioterapia')}
                        type="checkbox"
                        className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                        disabled={isViewOnly}
                      />
                      <label className="ml-2 text-sm text-gray-700">Radioterápia</label>
                    </div>
                    {radioterapia && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-6">
                        <div>
                          <label className="form-label">Dózis (n Gy)</label>
                          <input
                            {...register('radioterapiaDozis')}
                            className="form-input"
                            placeholder="pl. 60 Gy"
                            readOnly={isViewOnly}
                          />
                        </div>
                        <div>
                          <label className="form-label">Dátumintervallum</label>
                          <input
                            {...register('radioterapiaDatumIntervallum')}
                            className="form-input"
                            placeholder="pl. 2023.01.15 - 2023.03.15"
                            readOnly={isViewOnly}
                          />
                        </div>
                      </div>
                    )}
                    <div className="flex items-center">
                      <input
                        {...register('chemoterapia')}
                        type="checkbox"
                        className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                        disabled={isViewOnly}
                      />
                      <label className="ml-2 text-sm text-gray-700">Kemoterápia</label>
                    </div>
                    {chemoterapia && (
                      <div className="ml-6">
                        <label className="form-label">Mikor, mit, mennyit</label>
                        <textarea
                          {...register('chemoterapiaLeiras')}
                          rows={3}
                          className="form-input"
                          placeholder="Részletes leírás: mikor, milyen készítmény, mennyiség"
                          readOnly={isViewOnly}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* VELESZÜLETETT kérdések */}
            {selectedIndok === 'veleszületett rendellenesség' && (
              <>
                <div>
                  <label className="form-label">Milyen rendellenesség(ek) áll(nak) fenn?</label>
                  <div className="flex flex-col gap-2 ml-4">
                    {["kemény szájpadhasadék", "lágyszájpad inszufficiencia", "állcsonthasadék", "ajakhasadék"]
                      .map(opt => (
                        <label key={opt} className="flex items-center">
                          <input
                            type="checkbox"
                            value={opt}
                            {...register('veleszuletettRendellenessegek')}
                            className="mr-2"
                            disabled={isViewOnly}
                          />
                          {opt}
                        </label>
                      ))}
                  </div>
                </div>
                <div>
                  <label className="form-label">Műtétek leírása, legutolsó beavatkozás</label>
                  <textarea
                    {...register('veleszuletettMutetekLeirasa')}
                    rows={2}
                    className="form-input"
                    placeholder="Műtétek leírása, legutolsó beavatkozás (szabadszavas)"
                    readOnly={isViewOnly}
                  />
                </div>
              </>
            )}

            {/* Közös mezők (mindháromhoz) */}
            {/* Műtét ideje már nem itt, hanem onkológiai esetben */}
          </div>
        </div>
        )}

        {/* BETEGVIZSGÁLAT */}
        {userRole !== 'sebészorvos' && (
        <div className="card">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Calendar className="w-5 h-5 mr-2 text-medical-primary" />
            BETEGVIZSGÁLAT
          </h4>
          <div className="space-y-4">
            {/* Fogazati státusz */}
            <div className="border-t pt-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <h5 className="text-md font-semibold text-gray-900">Felvételi státusz</h5>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (isViewOnly) return;
                      setFogak(prev => {
                        const upperTeeth = [11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28];
                        const upperTeethStr = upperTeeth.map(t => t.toString());
                        
                        // Ellenőrizzük, hogy minden felső fog hiányzik-e
                        const allMissing = upperTeethStr.every(tooth => {
                          const value = prev[tooth];
                          const normalized = normalizeToothData(value);
                          return normalized?.status === 'M';
                        });
                        
                        const newState = { ...prev };
                        if (allMissing) {
                          // Ha minden fog hiányzik, töröljük őket (visszaállítás)
                          upperTeethStr.forEach(tooth => {
                            delete newState[tooth];
                          });
                        } else {
                          // Ha nem minden fog hiányzik, állítsuk be mindet M-re
                          upperTeeth.forEach(tooth => {
                            newState[tooth.toString()] = { status: 'M' };
                          });
                        }
                        return newState;
                      });
                    }}
                    disabled={isViewOnly}
                    className="px-3 py-1.5 text-xs rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Felső állcsont összes fogát hiányzónak jelöli / visszaállítja"
                  >
                    Felső teljes fogatlanság
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isViewOnly) return;
                      setFogak(prev => {
                        const lowerTeeth = [31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48];
                        const lowerTeethStr = lowerTeeth.map(t => t.toString());
                        
                        // Ellenőrizzük, hogy minden alsó fog hiányzik-e
                        const allMissing = lowerTeethStr.every(tooth => {
                          const value = prev[tooth];
                          const normalized = normalizeToothData(value);
                          return normalized?.status === 'M';
                        });
                        
                        const newState = { ...prev };
                        if (allMissing) {
                          // Ha minden fog hiányzik, töröljük őket (visszaállítás)
                          lowerTeethStr.forEach(tooth => {
                            delete newState[tooth];
                          });
                        } else {
                          // Ha nem minden fog hiányzik, állítsuk be mindet M-re
                          lowerTeeth.forEach(tooth => {
                            newState[tooth.toString()] = { status: 'M' };
                          });
                        }
                        return newState;
                      });
                    }}
                    disabled={isViewOnly}
                    className="px-3 py-1.5 text-xs rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Alsó állcsont összes fogát hiányzónak jelöli / visszaállítja"
                  >
                    Alsó teljes fogatlanság
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-3">Kattintás: jelen van → hiányzik → alaphelyzet. Jelen lévő fogaknál D (szuvas) vagy F (tömött) kiválasztható.</p>
              <div className="bg-gray-50 p-4 rounded-lg">
                {/* Felső sor */}
                <div className="flex justify-between mb-2">
                  <div className="flex gap-1">
                    {[18, 17, 16, 15, 14, 13, 12, 11].map(tooth => {
                      const toothStr = tooth.toString();
                      return (
                        <ToothCheckbox
                          key={tooth}
                          toothNumber={toothStr}
                          value={fogak[toothStr]}
                          onChange={() => handleToothStatusToggle(toothStr)}
                          disabled={isViewOnly}
                        />
                      );
                    })}
                  </div>
                  <div className="flex gap-1">
                    {[21, 22, 23, 24, 25, 26, 27, 28].map(tooth => {
                      const toothStr = tooth.toString();
                      return (
                        <ToothCheckbox
                          key={tooth}
                          toothNumber={toothStr}
                          value={fogak[toothStr]}
                          onChange={() => handleToothStatusToggle(toothStr)}
                          disabled={isViewOnly}
                        />
                      );
                    })}
                  </div>
                </div>
                {/* Alsó sor */}
                <div className="flex justify-between">
                  <div className="flex gap-1">
                    {[48, 47, 46, 45, 44, 43, 42, 41].map(tooth => {
                      const toothStr = tooth.toString();
                      return (
                        <ToothCheckbox
                          key={tooth}
                          toothNumber={toothStr}
                          value={fogak[toothStr]}
                          onChange={() => handleToothStatusToggle(toothStr)}
                          disabled={isViewOnly}
                        />
                      );
                    })}
                  </div>
                  <div className="flex gap-1">
                    {[31, 32, 33, 34, 35, 36, 37, 38].map(tooth => {
                      const toothStr = tooth.toString();
                      return (
                        <ToothCheckbox
                          key={tooth}
                          toothNumber={toothStr}
                          value={fogak[toothStr]}
                          onChange={() => handleToothStatusToggle(toothStr)}
                          disabled={isViewOnly}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* DMF-T index számolás és megjelenítés - mindig látható */}
              {(() => {
                let dCount = 0;
                let fCount = 0;
                let mCount = 0;
                
                Object.values(fogak).forEach(value => {
                  const normalized = normalizeToothData(value);
                  if (normalized) {
                    if (normalized.status === 'D') dCount++;
                    else if (normalized.status === 'F') fCount++;
                    else if (normalized.status === 'M') mCount++;
                  }
                });
                
                const dmft = dCount + fCount + mCount;
                
                return (
                  <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <h6 className="font-semibold text-gray-900 mb-2">DMF-T index</h6>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div>
                        <span className="text-gray-600">D (szuvas):</span>
                        <span className="ml-2 font-semibold text-red-700">{dCount}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">F (tömött):</span>
                        <span className="ml-2 font-semibold text-blue-700">{fCount}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">M (hiányzik):</span>
                        <span className="ml-2 font-semibold text-gray-700">{mCount}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">DMF-T:</span>
                        <span className="ml-2 font-bold text-gray-900">{dmft}</span>
                        <span className="ml-1 text-xs text-gray-500">/ 32</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Fog státusz részletek - csak a jelen lévő fogakhoz */}
              {(() => {
                const presentTeeth = Object.keys(fogak).filter(toothNumber => {
                  const value = fogak[toothNumber];
                  const state = getToothState(value);
                  return state === 'present'; // Csak a jelen lévő fogak
                });
                
                return presentTeeth.length > 0 ? (
                <div className="space-y-4 mt-4">
                    <h6 className="font-medium text-gray-700">Fogak állapota (szabadszavas leírás)</h6>
                    {presentTeeth.sort().map(toothNumber => {
                      const value = fogak[toothNumber];
                      const normalized = normalizeToothData(value);
                      const description = normalized?.description || '';
                      const status = normalized?.status;
                      
                      return (
                    <div key={toothNumber} className="border border-gray-200 rounded-md p-4">
                          <div className="flex items-center justify-between mb-2">
                            <label className="form-label font-medium">
                              {toothNumber}. fog – állapot
                            </label>
                            {/* D/F gombok amikor a fog jelen van */}
                            {!isViewOnly && (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleToothStatusSelect(toothNumber, 'D')}
                                  className={`px-2 py-1 text-xs rounded border ${
                                    status === 'D'
                                      ? 'bg-red-100 border-red-400 text-red-700 font-semibold'
                                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                                  }`}
                                  title="Szuvas (D)"
                                >
                                  D
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToothStatusSelect(toothNumber, 'F')}
                                  className={`px-2 py-1 text-xs rounded border ${
                                    status === 'F'
                                      ? 'bg-blue-100 border-blue-400 text-blue-700 font-semibold'
                                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                                  }`}
                                  title="Tömött (F)"
                                >
                                  F
                                </button>
                              </div>
                            )}
                          </div>
                          <textarea
                            value={description}
                            onChange={(e) => handleToothStatusDetailsChange(toothNumber, e.target.value)}
                            rows={2}
                            className="form-input"
                            placeholder="Pl. korona, hídtag, gyökércsapos felépítmény, egyéb részletek"
                            readOnly={isViewOnly}
                          />
                    </div>
                      );
                    })}
                </div>
                ) : null;
              })()}
            </div>

            {/* Fogpótlások – felső és alsó állcsont külön */}
            <div className="border-t pt-4 mt-4">
              <h5 className="text-md font-semibold text-gray-900 mb-3">Fogpótlások</h5>
              {/* Felső állcsont */}
              <div className="mb-6">
                <div className="flex items-center mb-2">
                  <input
                    {...register('felsoFogpotlasVan')}
                    type="checkbox"
                    className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                    disabled={isViewOnly}
                  />
                  <label className="ml-2 text-sm text-gray-700">Felső állcsont: van-e fogpótlása?</label>
                </div>
                {felsoFogpotlasVan && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-6 mt-2">
                    <div>
                      <label className="form-label">Mikor készült?</label>
                      <input
                        {...register('felsoFogpotlasMikor')}
                        className="form-input"
                        placeholder="pl. 2023 tavasz / 2023-05-10"
                        readOnly={isViewOnly}
                      />
                    </div>
                    <div>
                      <label className="form-label">Ki készítette / hol készült?</label>
                      <input
                        {...register('felsoFogpotlasKeszito')}
                        className="form-input"
                        placeholder="pl. Klinika / magánrendelő, orvos/technikus neve"
                        readOnly={isViewOnly}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="form-label">Meglévő fogpótlás típusa</label>
                      <select {...register('felsoFogpotlasTipus')} className="form-input" disabled={isViewOnly}>
                        <option value="">Válasszon...</option>
                        {kezelesiTervOptions.filter(option => option !== 'sebészi sablon készítése').map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center md:col-span-2">
                      <input
                        {...register('felsoFogpotlasElegedett')}
                        type="checkbox"
                        className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                        disabled={isViewOnly}
                      />
                      <label className="ml-2 text-sm text-gray-700">Elégedett-e velük?</label>
                    </div>
                    {!felsoFogpotlasElegedett && (
                      <div className="md:col-span-2">
                        <label className="form-label">Ha nem, mi velük a baj?</label>
                        <textarea
                          {...register('felsoFogpotlasProblema')}
                          rows={2}
                          className="form-input"
                          placeholder="Rövid leírás a problémákról"
                          readOnly={isViewOnly}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Alsó állcsont */}
              <div>
                <div className="flex items-center mb-2">
                  <input
                    {...register('alsoFogpotlasVan')}
                    type="checkbox"
                    className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                    disabled={isViewOnly}
                  />
                  <label className="ml-2 text-sm text-gray-700">Alsó állcsont: van-e fogpótlása?</label>
                </div>
                {alsoFogpotlasVan && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-6 mt-2">
                    <div>
                      <label className="form-label">Mikor készült?</label>
                      <input
                        {...register('alsoFogpotlasMikor')}
                        className="form-input"
                        placeholder="pl. 2022 ősz / 2022-11-20"
                        readOnly={isViewOnly}
                      />
                    </div>
                    <div>
                      <label className="form-label">Ki készítette / hol készült?</label>
                      <input
                        {...register('alsoFogpotlasKeszito')}
                        className="form-input"
                        placeholder="pl. Klinika / magánrendelő, orvos/technikus neve"
                        readOnly={isViewOnly}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="form-label">Meglévő fogpótlás típusa</label>
                      <select {...register('alsoFogpotlasTipus')} className="form-input" disabled={isViewOnly}>
                        <option value="">Válasszon...</option>
                        {kezelesiTervOptions.filter(option => option !== 'sebészi sablon készítése').map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center md:col-span-2">
                      <input
                        {...register('alsoFogpotlasElegedett')}
                        type="checkbox"
                        className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                        disabled={isViewOnly}
                      />
                      <label className="ml-2 text-sm text-gray-700">Elégedett-e velük?</label>
                    </div>
                    {!alsoFogpotlasElegedett && (
                      <div className="md:col-span-2">
                        <label className="form-label">Ha nem, mi velük a baj?</label>
                        <textarea
                          {...register('alsoFogpotlasProblema')}
                          rows={2}
                          className="form-input"
                          placeholder="Rövid leírás a problémákról"
                          readOnly={isViewOnly}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Maxilladefektus */}
            <div>
              <div className="flex items-center mb-2">
                <input
                  {...register('maxilladefektusVan')}
                  type="checkbox"
                  className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                  disabled={isViewOnly}
                />
                <label className="ml-2 text-sm text-gray-700">Maxilladefektus van</label>
              </div>
              {watch('maxilladefektusVan') && (
                <div className="space-y-4 ml-6 mt-2">
                  <div>
                    <label className="form-label">Brown-féle klasszifikáció – függőleges komponens</label>
                    <select {...register('brownFuggolegesOsztaly')} className="form-input" disabled={isViewOnly}>
                      <option value="">Válasszon...</option>
                      <option value="1">1. osztály – maxillectomia oroantralis sipoly nélkül</option>
                      <option value="2">2. osztály – alacsony maxillectomia (orbita fenék/tartalom nélkül)</option>
                      <option value="3">3. osztály – magas maxillectomia (orbita tartalom érintett)</option>
                      <option value="4">4. osztály – radikális maxillectomia (orbitexenterációval)</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Brown – vízszintes/palatinalis komponens</label>
                    <select {...register('brownVizszintesKomponens')} className="form-input" disabled={isViewOnly}>
                      <option value="">Válasszon...</option>
                      <option value="a">a – egyoldali alveolaris maxillectomia</option>
                      <option value="b">b – kétoldali alveolaris maxillectomia</option>
                      <option value="c">c – teljes alveolaris maxilla resectio</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Mandibuladefektus */}
            <div>
              <div className="flex items-center mb-2">
                <input
                  {...register('mandibuladefektusVan')}
                  type="checkbox"
                  className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                  disabled={isViewOnly}
                />
                <label className="ml-2 text-sm text-gray-700">Mandibuladefektus van</label>
              </div>
              {watch('mandibuladefektusVan') && (
                <div className="ml-6 mt-2">
                  <label className="form-label">Kovács–Dobák osztályozás</label>
                  <select {...register('kovacsDobakOsztaly')} className="form-input" disabled={isViewOnly}>
                    <option value="">Válasszon...</option>
                    <option value="1">1. osztály – két nagyobb mandibula-maradvány, 2+ értékes foggal</option>
                    <option value="2">2. osztály – egy mandibula-maradvány</option>
                    <option value="3">3. osztály – két, minimális nagyságú mandibula-maradvány</option>
                    <option value="4">4. osztály – kétoldali egység alloplasztikával/osteosynthesissel helyreállítva</option>
                    <option value="5">5. osztály – egy/két kisméretű maradvány, szájfenék nem mozgatható → fogpótlás nem készíthető</option>
                  </select>
                </div>
              )}
            </div>

            {/* Funkciók */}
            <div className="flex items-center">
              <input
                {...register('nyelvmozgásokAkadályozottak')}
                type="checkbox"
                className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                disabled={isViewOnly}
              />
              <label className="ml-2 text-sm text-gray-700">Nyelvmozgások akadályozottak</label>
            </div>
            <div className="flex items-center">
              <input
                {...register('gombocosBeszed')}
                type="checkbox"
                className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                disabled={isViewOnly}
              />
              <label className="ml-2 text-sm text-gray-700">Gombócos beszéd</label>
            </div>
            <div>
              <label className="form-label">Nyálmirigy állapot</label>
              <select {...register('nyalmirigyAllapot')} className="form-input" disabled={isViewOnly}>
                <option value="">Válasszon...</option>
                <option value="hiposzaliváció">Hiposzaliváció</option>
                <option value="hiperszaliváció">Hiperszaliváció</option>
                <option value="Nem számol be eltérésről">Nem számol be eltérésről</option>
              </select>
            </div>
            <div>
              <label className="form-label">Fábián–Fejérdy osztály (felső állcsont)</label>
              <select {...register('fabianFejerdyProtetikaiOsztalyFelso')} className="form-input" disabled={isViewOnly}>
                <option value="">Válasszon...</option>
                {fabianFejerdyProtetikaiOsztalyOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Fábián–Fejérdy osztály (alsó állcsont)</label>
              <select {...register('fabianFejerdyProtetikaiOsztalyAlso')} className="form-input" disabled={isViewOnly}>
                <option value="">Válasszon...</option>
                {fabianFejerdyProtetikaiOsztalyOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            {/* Felvétel dátuma már nem itt, hanem alapadatokban */}
          </div>
        </div>
        )}

        {/* MEGLÉVŐ IMPLANTÁTUMOK */}
        <div className="card">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <AlertTriangle className="w-5 h-5 mr-2 text-medical-primary" />
            Meglévő implantátumok, ha vannak
          </h4>
          
          {/* Zsigmondy-kereszt */}
          <div className="mb-6">
            <div className="bg-gray-50 p-4 rounded-lg">
              {/* Felső sor - 1. kvadráns (bal felső) és 2. kvadráns (jobb felső) */}
              <div className="flex justify-between mb-2">
                <div className="flex gap-1">
                  {[18, 17, 16, 15, 14, 13, 12, 11].map(tooth => {
                    const toothStr = tooth.toString();
                    const toothValue = fogak[toothStr];
                    const toothState = getToothState(toothValue);
                    const hasPresentTooth = toothState === 'present'; // Csak ha jelen van, ne lehessen implantátum
                    return (
                      <ToothCheckbox
                        key={tooth}
                        toothNumber={toothStr}
                        value={toothStr in implantatumok ? { description: implantatumok[toothStr] } : undefined}
                        onChange={() => handleToothToggle(toothStr)}
                        disabled={isViewOnly || hasPresentTooth}
                      />
                    );
                  })}
                </div>
                <div className="flex gap-1">
                  {[21, 22, 23, 24, 25, 26, 27, 28].map(tooth => {
                    const toothStr = tooth.toString();
                    const toothValue = fogak[toothStr];
                    const toothState = getToothState(toothValue);
                    const hasPresentTooth = toothState === 'present'; // Csak ha jelen van, ne lehessen implantátum
                    return (
                      <ToothCheckbox
                        key={tooth}
                        toothNumber={toothStr}
                        value={toothStr in implantatumok ? { description: implantatumok[toothStr] } : undefined}
                        onChange={() => handleToothToggle(toothStr)}
                        disabled={isViewOnly || hasPresentTooth}
                      />
                    );
                  })}
                </div>
              </div>
              
              {/* Alsó sor - 4. kvadráns (bal alsó) és 3. kvadráns (jobb alsó) */}
              <div className="flex justify-between">
                <div className="flex gap-1">
                  {[48, 47, 46, 45, 44, 43, 42, 41].map(tooth => {
                    const toothStr = tooth.toString();
                    const toothValue = fogak[toothStr];
                    const toothState = getToothState(toothValue);
                    const hasPresentTooth = toothState === 'present'; // Csak ha jelen van, ne lehessen implantátum
                    return (
                      <ToothCheckbox
                        key={tooth}
                        toothNumber={toothStr}
                        value={toothStr in implantatumok ? { description: implantatumok[toothStr] } : undefined}
                        onChange={() => handleToothToggle(toothStr)}
                        disabled={isViewOnly || hasPresentTooth}
                      />
                    );
                  })}
                </div>
                <div className="flex gap-1">
                  {[31, 32, 33, 34, 35, 36, 37, 38].map(tooth => {
                    const toothStr = tooth.toString();
                    const toothValue = fogak[toothStr];
                    const toothState = getToothState(toothValue);
                    const hasPresentTooth = toothState === 'present'; // Csak ha jelen van, ne lehessen implantátum
                    return (
                      <ToothCheckbox
                        key={tooth}
                        toothNumber={toothStr}
                        value={toothStr in implantatumok ? { description: implantatumok[toothStr] } : undefined}
                        onChange={() => handleToothToggle(toothStr)}
                        disabled={isViewOnly || hasPresentTooth}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Implantátum részletek */}
          {Object.keys(implantatumok).length > 0 && (
            <div className="space-y-4 mb-4">
              <h5 className="font-medium text-gray-700 mb-3">Implantátum részletek</h5>
              {Object.keys(implantatumok).sort().map(toothNumber => (
                <div key={toothNumber} className="border border-gray-200 rounded-md p-4">
                  <label className="form-label font-medium">
                    {toothNumber}. fog - Implantátum típusa, gyári száma, stb.
                  </label>
                  <textarea
                    value={implantatumok[toothNumber] || ''}
                    onChange={(e) => handleImplantatumDetailsChange(toothNumber, e.target.value)}
                    rows={2}
                    className="form-input"
                    placeholder="Pl. Straumann BLT 4.1x10mm, Gyári szám: 028.015, Dátum: 2023.05.15"
                    readOnly={isViewOnly}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Nem ismert pozíciókban implantátum */}
          <div className="border-t pt-4 mt-4">
            <div className="flex items-center mb-3">
              <input
                {...register('nemIsmertPoziciokbanImplantatum')}
                type="checkbox"
                className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                disabled={isViewOnly}
              />
              <label className="ml-2 text-sm font-medium text-gray-700">
                Nem ismert pozíciókban
              </label>
            </div>
            
            {nemIsmertPoziciokbanImplantatum && (
              <div className="ml-6">
                <label className="form-label">Részletek (típus, mennyiség, stb.)</label>
                <textarea
                  {...register('nemIsmertPoziciokbanImplantatumRészletek')}
                  rows={3}
                  className="form-input"
                  placeholder="Pl. Straumann implantátumok, pontos pozíció nem ismert, mennyiség: 3 db"
                  readOnly={isViewOnly}
                />
              </div>
            )}
          </div>
        </div>

        {/* KEZELÉSI TERV */}
        {userRole !== 'sebészorvos' && (
        <div className="card">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <FileText className="w-5 h-5 mr-2 text-medical-primary" />
            KEZELÉSI TERV
          </h4>
          <div className="space-y-6">
            {/* Felső állcsont */}
            <div className="border-t pt-4">
              <div className="flex justify-between items-center mb-3">
                <h5 className="text-md font-semibold text-gray-900">Felső állcsont</h5>
                {!isViewOnly && (
                  <button
                    type="button"
                    onClick={addKezelesiTervFelso}
                    className="btn-secondary flex items-center gap-2 text-sm py-1 px-3"
                  >
                    <Plus className="w-4 h-4" />
                    Új tervezet hozzáadása
                  </button>
                )}
              </div>
              <div className="space-y-4">
                {kezelesiTervFelso.length === 0 ? (
                  <p className="text-sm text-gray-500 italic">Még nincs tervezet hozzáadva</p>
                ) : (
                  kezelesiTervFelso.map((terv, index) => (
                    <div key={index} className="border border-gray-200 rounded-md p-4 bg-gray-50">
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-sm font-medium text-gray-700">Tervezet #{index + 1}</span>
                        {!isViewOnly && (
                          <button
                            type="button"
                            onClick={() => removeKezelesiTervFelso(index)}
                            className="text-red-600 hover:text-red-800"
                            title="Törlés"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <div className="space-y-3">
                        <div>
                          <label className="form-label">Tervezett fogpótlás típusa</label>
                          <select
                            value={terv.tipus || ''}
                            onChange={(e) => updateKezelesiTervFelso(index, 'tipus', e.target.value)}
                            className="form-input"
                            disabled={isViewOnly}
                          >
                            <option value="">Válasszon...</option>
                            {kezelesiTervOptions.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="form-label">Tervezett átadás dátuma</label>
                            <DatePicker
                              selected={terv.tervezettAtadasDatuma ? new Date(terv.tervezettAtadasDatuma) : null}
                              onChange={(date: Date | null) => {
                                const formatted = date ? formatDateForInput(date.toISOString().split('T')[0]) : '';
                                updateKezelesiTervFelso(index, 'tervezettAtadasDatuma', formatted || null);
                              }}
                              placeholder="Válasszon dátumot"
                              disabled={isViewOnly}
                            />
                          </div>
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                              checked={terv.elkeszult || false}
                              onChange={(e) => updateKezelesiTervFelso(index, 'elkeszult', e.target.checked)}
                              className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                              disabled={isViewOnly}
                            />
                            <label className="ml-2 text-sm text-gray-700">Elkészült a fogpótlás</label>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            
            {/* Alsó állcsont */}
            <div className="border-t pt-4">
              <div className="flex justify-between items-center mb-3">
                <h5 className="text-md font-semibold text-gray-900">Alsó állcsont</h5>
                {!isViewOnly && (
                  <button
                    type="button"
                    onClick={addKezelesiTervAlso}
                    className="btn-secondary flex items-center gap-2 text-sm py-1 px-3"
                  >
                    <Plus className="w-4 h-4" />
                    Új tervezet hozzáadása
                  </button>
                )}
              </div>
              <div className="space-y-4">
                {kezelesiTervAlso.length === 0 ? (
                  <p className="text-sm text-gray-500 italic">Még nincs tervezet hozzáadva</p>
                ) : (
                  kezelesiTervAlso.map((terv, index) => (
                    <div key={index} className="border border-gray-200 rounded-md p-4 bg-gray-50">
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-sm font-medium text-gray-700">Tervezet #{index + 1}</span>
                        {!isViewOnly && (
                          <button
                            type="button"
                            onClick={() => removeKezelesiTervAlso(index)}
                            className="text-red-600 hover:text-red-800"
                            title="Törlés"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <div className="space-y-3">
                        <div>
                          <label className="form-label">Tervezett fogpótlás típusa</label>
                          <select
                            value={terv.tipus || ''}
                            onChange={(e) => updateKezelesiTervAlso(index, 'tipus', e.target.value)}
                            className="form-input"
                            disabled={isViewOnly}
                          >
                            <option value="">Válasszon...</option>
                            {kezelesiTervOptions.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="form-label">Tervezett átadás dátuma</label>
                            <DatePicker
                              selected={terv.tervezettAtadasDatuma ? new Date(terv.tervezettAtadasDatuma) : null}
                              onChange={(date: Date | null) => {
                                const formatted = date ? formatDateForInput(date.toISOString().split('T')[0]) : '';
                                updateKezelesiTervAlso(index, 'tervezettAtadasDatuma', formatted || null);
                              }}
                              placeholder="Válasszon dátumot"
                              disabled={isViewOnly}
                            />
                          </div>
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                              checked={terv.elkeszult || false}
                              onChange={(e) => updateKezelesiTervAlso(index, 'elkeszult', e.target.checked)}
                              className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                              disabled={isViewOnly}
                            />
                            <label className="ml-2 text-sm text-gray-700">Elkészült a fogpótlás</label>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            
            {/* Arcot érintő rehabilitáció */}
            <div className="border-t pt-4">
              <div className="flex justify-between items-center mb-3">
                <h5 className="text-md font-semibold text-gray-900">Arcot érintő rehabilitáció</h5>
                {!isViewOnly && (
                  <button
                    type="button"
                    onClick={addKezelesiTervArcotErinto}
                    className="btn-secondary flex items-center gap-2 text-sm py-1 px-3"
                  >
                    <Plus className="w-4 h-4" />
                    Új tervezet hozzáadása
                  </button>
                )}
              </div>
              <div className="space-y-4">
                {kezelesiTervArcotErinto.length === 0 ? (
                  <p className="text-sm text-gray-500 italic">Még nincs tervezet hozzáadva</p>
                ) : (
                  kezelesiTervArcotErinto.map((terv, index) => (
                    <div key={index} className="border border-gray-200 rounded-md p-4 bg-gray-50">
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-sm font-medium text-gray-700">Tervezet #{index + 1}</span>
                        {!isViewOnly && (
                          <button
                            type="button"
                            onClick={() => removeKezelesiTervArcotErinto(index)}
                            className="text-red-600 hover:text-red-800"
                            title="Törlés"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <div className="space-y-3">
                        <div>
                          <label className="form-label">Típus</label>
                          <select
                            value={terv.tipus || ''}
                            onChange={(e) => updateKezelesiTervArcotErinto(index, 'tipus', e.target.value)}
                            className="form-input"
                            disabled={isViewOnly}
                          >
                            <option value="">Válasszon...</option>
                            {kezelesiTervArcotErintoTipusOptions.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="form-label">Elhorgonyzás eszköze</label>
                          <select
                            value={terv.elhorgonyzasEszkoze || ''}
                            onChange={(e) => updateKezelesiTervArcotErinto(index, 'elhorgonyzasEszkoze', e.target.value || null)}
                            className="form-input"
                            disabled={isViewOnly}
                          >
                            <option value="">Válasszon...</option>
                            {kezelesiTervArcotErintoElhorgonyzasOptions.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="form-label">Tervezett átadás dátuma</label>
                            <DatePicker
                              selected={terv.tervezettAtadasDatuma ? new Date(terv.tervezettAtadasDatuma) : null}
                              onChange={(date: Date | null) => {
                                const formatted = date ? formatDateForInput(date.toISOString().split('T')[0]) : '';
                                updateKezelesiTervArcotErinto(index, 'tervezettAtadasDatuma', formatted || null);
                              }}
                              placeholder="Válasszon dátumot"
                              disabled={isViewOnly}
                            />
                          </div>
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                              checked={terv.elkeszult || false}
                              onChange={(e) => updateKezelesiTervArcotErinto(index, 'elkeszult', e.target.checked)}
                              className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                              disabled={isViewOnly}
                            />
                            <label className="ml-2 text-sm text-gray-700">Elkészült</label>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Appointment Booking Section */}
        {/* For surgeons, always allow editing appointments even if form is view-only */}
        <AppointmentBookingSection 
          patientId={patientId} 
          isViewOnly={userRole === 'sebészorvos' ? false : isViewOnly} 
        />

        {/* Form Actions */}
        <div className="pt-6 border-t space-y-4">
          {!isViewOnly && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-md">
              <div className="flex items-start">
                <AlertTriangle className="w-5 h-5 text-yellow-600 mr-3 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-semibold text-yellow-800 mb-1">
                    ⚠️ FONTOS: Ne felejtse el menteni!
                  </h4>
                  <p className="text-sm text-yellow-700">
                    Az adatok csak akkor kerülnek az adatbázisba, ha az <strong>"{patient ? 'Beteg frissítése' : 'Beteg mentése'}"</strong> gombbal menti el az űrlapot. 
                    A piszkozat csak ideiglenes tárolás, és nem menti az adatokat véglegesen.
                  </p>
                </div>
              </div>
            </div>
          )}
          <div className="flex justify-end space-x-4">
            <button
              type="button"
              onClick={handleCancel}
              className="btn-secondary"
              data-patient-form-cancel
            >
              {isViewOnly ? 'Bezárás' : 'Mégse'}
            </button>
            {!isViewOnly && (
              <button
                type="submit"
                className="btn-primary"
              >
                {patient ? 'Beteg frissítése' : 'Beteg mentése'}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
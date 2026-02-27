'use client';

import { useState, useEffect, useRef, useCallback, useMemo, ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Patient, patientSchema, nyakiBlokkdisszekcioOptions, fabianFejerdyProtetikaiOsztalyOptions, kezelesiTervOptions, kezelesiTervArcotErintoTipusOptions, kezelesiTervArcotErintoElhorgonyzasOptions } from '@/lib/types';
import { normalizeToTreatmentTypeCode } from '@/lib/treatment-type-normalize';
import { formatDateForInput } from '@/lib/dateUtils';
import { getEarliestReadyDate, formatEarliestReadyDisplay } from '@/lib/kezelesi-terv-estimate';
import { X, Calendar, User, Phone, Mail, MapPin, FileText, AlertTriangle, Plus, Trash2, Download, Send, History } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { AppointmentBookingSection } from './AppointmentBookingSection';
import { ConditionalAppointmentBooking } from './ConditionalAppointmentBooking';
import { ContextBanner } from './ContextBanner';
import { getCurrentUser } from '@/lib/auth';
import { DatePicker } from './DatePicker';
import { savePatient, ApiError, TimeoutError } from '@/lib/storage';
import { logEvent } from '@/lib/event-logger';
import { getMissingRequiredFields, REQUIRED_FIELDS } from '@/lib/clinical-rules';
import { ClinicalChecklist } from './ClinicalChecklist';

// Sentry import (conditional, only if enabled)
let Sentry: typeof import('@sentry/nextjs') | null = null;
if (typeof window !== 'undefined' && process.env.ENABLE_SENTRY === 'true') {
  try {
    Sentry = require('@sentry/nextjs');
  } catch {
    // Sentry not available, ignore
  }
}
import { BNOAutocomplete } from './BNOAutocomplete';
import { PatientDocuments } from './PatientDocuments';
import { useToast } from '@/contexts/ToastContext';
import { EQUITY_REQUEST_CONFIG } from '@/lib/equity-request-config';
import { PatientFormSectionNavigation, Section } from './mobile/PatientFormSectionNavigation';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { PatientStageSection } from './PatientStageSection';
import { OHIP14Section } from './OHIP14Section';
import { ToothTreatmentProvider, ToothTreatmentInline } from './ToothTreatmentPanel';
import { OPInlinePreview } from './OPInlinePreview';


// Fog állapot típus
type ToothStatus = { status?: 'D' | 'F' | 'M'; description?: string } | string;

// Helper függvény: string-et objektummá konvertál (visszafelé kompatibilitás)
function normalizeToothData(value: ToothStatus | undefined): { status?: 'D' | 'F' | 'M'; description?: string } | null {
  if (!value) return null;
  if (typeof value === 'string') {
    // Üres string esetén null-t adunk vissza
    if (value.trim() === '') return null;
    return { description: value };
  }
  // Ha objektum, akkor ellenőrizzük
  if (typeof value === 'object' && value !== null) {
    const hasStatus = value.status !== undefined && value.status !== null;
    const hasDescription = value.description !== undefined; // Van description kulcs (akár üres is)
    const hasNonEmptyDescription = value.description && value.description.trim() !== '';
    
    // Ha van status (D, F, vagy M), akkor érvényes objektum, még akkor is, ha nincs description
    if (hasStatus) {
      return value;
    }
    
    // Ha van description kulcs (akár üres is), akkor érvényes objektum
    // Ez az implantátumok esetében fontos: { description: '' } azt jelenti, hogy be van jelölve
    if (hasDescription) {
      return value;
    }
    
    // Üres objektum ({}) - ez érvényes állapot a fog státuszban (jelen van, de még nincs kiválasztva D/F)
    // Csak akkor null, ha valóban nincs semmi
    // Az üres objektumot visszaadjuk, mert ez azt jelenti, hogy a fog "present" állapotban van
    if (Object.keys(value).length === 0) {
      return value; // Üres objektum = jelen van, de még nincs kiválasztva D/F
    }
    
    // Ha az objektum nem üres, de nincs benne semmi hasznos, akkor null
    return null;
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

// Stabil stringify - sorted keys, konzisztens típuskezelés, undefined -> null normalizálás
function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) return "null";
  const t = typeof obj;
  if (t !== "object") return JSON.stringify(obj);

  if (Array.isArray(obj)) {
    return `[${obj.map(stableStringify).join(",")}]`;
  }

  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = (obj as any)[k];
    // undefined -> null normalizálás change detection-hez
    parts.push(`${JSON.stringify(k)}:${stableStringify(v === undefined ? null : v)}`);
  }
  return `{${parts.join(",")}}`;
}

// Normalizálási segédfüggvények az összehasonlításhoz
function normalizeDate(date: string | null | undefined): string | null {
  if (!date) return null;
  try {
    return formatDateForInput(date);
  } catch {
    return null;
  }
}

function normalizeArray<T>(arr: T[] | null | undefined): string {
  if (!arr || !Array.isArray(arr)) return JSON.stringify([]);
  // Rendezzük a tömböt, ha objektumokat tartalmaz, hogy konzisztens legyen
  const sorted = arr.map(item => {
    if (typeof item === 'object' && item !== null) {
      const normalized = Object.keys(item).sort().reduce((acc, key) => {
        const value = (item as any)[key];
        // Normalize date fields in objects (like tervezettAtadasDatuma in kezelesiTerv arrays)
        if (key === 'tervezettAtadasDatuma' || key.includes('datum') || key.includes('Datum')) {
          acc[key] = normalizeDate(value);
        } else {
          acc[key] = value;
        }
        return acc;
      }, {} as any);
      return normalized;
    }
    return item;
  });
  return JSON.stringify(sorted);
}

function normalizeObject(obj: Record<string, any> | null | undefined): string {
  if (!obj || typeof obj !== 'object') return JSON.stringify({});
  // Rendezzük a kulcsokat, hogy konzisztens legyen
  const sorted = Object.keys(obj).sort().reduce((acc, key) => {
    acc[key] = obj[key];
    return acc;
  }, {} as Record<string, any>);
  return JSON.stringify(sorted);
}

function normalizeValue(value: any): any {
  // Handle null/undefined/empty string comparison
  if (value === null || value === undefined || value === '') return null;
  return value;
}

// ToothCheckbox komponens - háromállapotú
interface ToothCheckboxProps {
  toothNumber: string;
  value: ToothStatus | undefined;
  onChange: () => void;
  disabled?: boolean;
  idPrefix?: string; // Egyedi ID prefix az elkerülésére, hogy ugyanaz az ID legyen több helyen
}

function ToothCheckbox({ toothNumber, value, onChange, disabled, idPrefix = 'tooth' }: ToothCheckboxProps) {
  const state = getToothState(value);
  const isPresent = state === 'present';
  const isMissing = state === 'missing';
  const isChecked = state !== 'empty';
  
  // Ellenőrizzük a szabadszavas leírást az ikon meghatározáshoz
  const normalized = normalizeToothData(value);
  const description = normalized?.description || '';
  const descriptionLower = description.toLowerCase();
  const hasKerdeses = descriptionLower.includes('kérdéses');
  const hasRemenytelen = descriptionLower.includes('reménytelen');

  // Meghatározzuk a megjelenítendő ikont és színt
  let iconElement = null;
  let borderColor = '';
  let bgColor = '';
  
  if (isMissing) {
    // Hiányzik → szürke X
    borderColor = 'border-gray-400';
    bgColor = 'bg-gray-200';
    iconElement = (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 4L12 12M12 4L4 12" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  } else if (isPresent) {
    if (hasRemenytelen) {
      // Reménytelen → piros felkiáltójel
      borderColor = 'border-red-500';
      bgColor = 'bg-red-50';
      iconElement = (
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 2V9M8 11V13" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="8" cy="14" r="1" fill="#dc2626"/>
        </svg>
      );
    } else if (hasKerdeses) {
      // Kérdéses → sárga kérdőjel
      borderColor = 'border-yellow-500';
      bgColor = 'bg-yellow-50';
      iconElement = (
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6 6C6 4.5 7 3.5 8 3.5C9 3.5 10 4.5 10 6C10 7 9 8 8 8.5V10" stroke="#eab308" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          <circle cx="8" cy="13" r="1" fill="#eab308"/>
        </svg>
      );
    } else {
      // Normál → zöld pipa
      borderColor = 'border-medical-primary';
      bgColor = 'bg-green-50';
      iconElement = (
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 8L6 11L13 4" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </svg>
      );
    }
  } else {
    // Üres
    borderColor = 'border-gray-300';
    bgColor = '';
  }

  const checkboxId = `${idPrefix}-${toothNumber}`;
  
  return (
    <div className="flex flex-col items-center gap-1">
      <label 
        htmlFor={checkboxId}
        className="text-xs sm:text-xs text-gray-600 font-medium cursor-pointer"
      >
        {toothNumber}
      </label>
      <div className="relative">
        <label
          htmlFor={checkboxId}
          className={`w-8 h-8 sm:w-7 sm:h-7 rounded border-2 flex items-center justify-center focus-within:ring-2 focus-within:ring-medical-primary focus-within:ring-offset-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${borderColor} ${bgColor}`}
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={isChecked}
            onChange={(e) => {
              e.stopPropagation();
              if (!disabled) {
                onChange();
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
            disabled={disabled}
            className="sr-only"
          />
          {iconElement}
        </label>
      </div>
    </div>
  );
}

interface PatientFormProps {
  patient?: Patient | null;
  onSave: (patient: Patient, options?: { source: 'auto' | 'manual' }) => void;
  onCancel: () => void;
  isViewOnly?: boolean;
  showOnlySections?: string[]; // Array of section IDs to show: 'alapadatok', 'szemelyes', 'beutalo', 'kezeloorvos', 'anamnezis', 'betegvizsgalat', 'adminisztracio', 'idopont'
}

export function PatientForm({ patient, onSave, onCancel, isViewOnly = false, showOnlySections }: PatientFormProps) {
  const router = useRouter();
  const { confirm: confirmDialog, showToast } = useToast();
  
  // Helper function to check if a section should be shown
  const shouldShowSection = (sectionId: string): boolean => {
    if (!showOnlySections || showOnlySections.length === 0) {
      return true; // If no filter, show all sections
    }
    return showOnlySections.includes(sectionId);
  };
  
  const [userRole, setUserRole] = useState<string>('');
  const [kezeloorvosOptions, setKezeloorvosOptions] = useState<Array<{ name: string; intezmeny: string | null }>>([]);
  const [doctorOptions, setDoctorOptions] = useState<Array<{ name: string; intezmeny: string | null }>>([]);
  const [institutionOptions, setInstitutionOptions] = useState<string[]>([]);
  const isNewPatient = !patient && !isViewOnly;
  const [currentPatient, setCurrentPatient] = useState<Patient | null | undefined>(patient);
  const patientId = currentPatient?.id || null;
  
  // Conflict handling state
  const [conflictError, setConflictError] = useState<ApiError | null>(null); // Manual save 409 → modal
  const [showConflictModal, setShowConflictModal] = useState(false);

  // Ref for immediate access to current patient (for hasUnsavedChanges)
  const currentPatientRef = useRef<Patient | null | undefined>(patient);
  
  // Previous patient ID ref for change detection
  const previousPatientIdRef = useRef<string | null>(patient?.id || null);
  
  // Saving source state (for UX: auto-save indicator vs manual save button disabled)
  const [savingSource, setSavingSource] = useState<'auto' | 'manual' | null>(null);
  
  // Wrapper function to update both state and ref
  const updateCurrentPatient = useCallback((newPatient: Patient | null | undefined) => {
    currentPatientRef.current = newPatient;
    setCurrentPatient(newPatient);
  }, []);
  const [labQuoteRequests, setLabQuoteRequests] = useState<Array<{ id: string; szoveg: string; datuma: string }>>([]);
  const [newQuoteSzoveg, setNewQuoteSzoveg] = useState<string>('');
  const [newQuoteDatuma, setNewQuoteDatuma] = useState<Date | null>(null);
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null);

  // State for "vanBeutalo" toggle (default true if bármely beutaló-adat van, or always true for new patients if surgeon role)
  // Note: userRole might not be loaded yet, so we'll update it in useEffect
  // Note: kezelesreErkezesIndoka is independent, not part of beutaló
  const initialVanBeutalo = !!(patient?.beutaloOrvos || patient?.beutaloIntezmeny);
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
          // Store users with their institutions
          const usersWithInstitutions = data.users.map((user: { displayName: string; intezmeny: string | null }) => ({
            name: user.displayName,
            intezmeny: user.intezmeny
          }));
          setKezeloorvosOptions(usersWithInstitutions);
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

  // Load institution options from API
  useEffect(() => {
    const loadInstitutionOptions = async () => {
      try {
        const response = await fetch('/api/institutions');
        if (response.ok) {
          const data = await response.json();
          setInstitutionOptions(data.institutions || []);
        } else {
          console.error('Failed to load institution options');
          // Fallback to empty array if API fails
          setInstitutionOptions([]);
        }
      } catch (error) {
        console.error('Error loading institution options:', error);
        // Fallback to empty array if API fails
        setInstitutionOptions([]);
      }
    };
    loadInstitutionOptions();
  }, []);

  // Load active (open) episode for context banner + appointment booking
  useEffect(() => {
    if (!patientId) {
      setActiveEpisodeId(null);
      return;
    }
    const loadEpisodes = async () => {
      try {
        const res = await fetch(`/api/patients/${patientId}/episodes`, { credentials: 'include' });
        if (!res.ok) {
          setActiveEpisodeId(null);
          return;
        }
        const data = await res.json();
        const episodes = data.episodes ?? [];
        const openEpisode = episodes.find((e: { status?: string }) => e.status === 'open');
        setActiveEpisodeId(openEpisode?.id ?? null);
      } catch {
        setActiveEpisodeId(null);
      }
    };
    loadEpisodes();
  }, [patientId]);

  // Load doctor options from API (for beutaló orvos autocomplete)
  useEffect(() => {
    const loadDoctorOptions = async () => {
      try {
        const response = await fetch('/api/users/doctors');
        if (response.ok) {
          const data = await response.json();
          setDoctorOptions(data.doctors || []);
        } else {
          console.error('Failed to load doctor options');
          // Fallback to empty array if API fails
          setDoctorOptions([]);
        }
      } catch (error) {
        console.error('Error loading doctor options:', error);
        // Fallback to empty array if API fails
        setDoctorOptions([]);
      }
    };
    loadDoctorOptions();
  }, []);

  // Load lab quote requests
  useEffect(() => {
    const loadLabQuoteRequests = async () => {
      if (!patientId) {
        setLabQuoteRequests([]);
        return;
      }
      try {
        const response = await fetch(`/api/patients/${patientId}/lab-quote-requests`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          setLabQuoteRequests(data.quoteRequests || []);
        } else {
          console.error('Failed to load lab quote requests');
          setLabQuoteRequests([]);
        }
      } catch (error) {
        console.error('Error loading lab quote requests:', error);
        setLabQuoteRequests([]);
      }
    };
    loadLabQuoteRequests();
  }, [patientId]);


  const {
    register,
    handleSubmit,
    formState: { errors, isDirty, dirtyFields },
    setValue,
    setError,
    watch,
    reset,
    getValues,
    trigger,
    control,
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

  // Update currentPatient when patient prop changes (but not from auto-save)
  // Reset form to mark as not dirty after initial load for existing patients
  // Also reset when patient data changes (e.g., after save or refresh)
  // BUT: Don't reset if the change came from auto-save to prevent flickering
  useEffect(() => {
    
    if (!patient || isViewOnly) {
      if (!patient && !isViewOnly) {
        // Reset to default values for new patient
        reset({
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
        }, { keepDirty: false, keepDefaultValues: false });
      }
      updateCurrentPatient(patient || null);
      return;
    }

    // Ha az id változott, biztosan külső betöltés
    if (previousPatientIdRef.current !== patient.id) {
      previousPatientIdRef.current = patient.id || null;
      // Note: If backend doesn't return kezelesreErkezesIndoka, preserve it from currentPatientRef
      const patientWithPreservedKezelesreErkezesIndoka = {
        ...patient,
        kezelesreErkezesIndoka: patient.kezelesreErkezesIndoka ?? currentPatientRef.current?.kezelesreErkezesIndoka ?? null,
      };
      updateCurrentPatient(patientWithPreservedKezelesreErkezesIndoka);
      // Reset form with current values to clear dirty state
      reset({
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
      }, { keepDirty: false, keepDefaultValues: false });
      return;
    }

    // Ha az id megegyezik, de savingSource aktív (auto-save vagy manual save), ne fusson reset
    // (A performSave már frissítette a state-et)
    if (savingSource && previousPatientIdRef.current === patient.id) {
      // Csak frissítsük a currentPatient-et, ha szükséges
      const patientWithPreservedKezelesreErkezesIndoka = {
        ...patient,
        kezelesreErkezesIndoka: patient.kezelesreErkezesIndoka ?? currentPatientRef.current?.kezelesreErkezesIndoka ?? null,
      };
      updateCurrentPatient(patientWithPreservedKezelesreErkezesIndoka);
      return;
    }

    // Egyébként ne fusson reset (valószínűleg első betöltés vagy külső változás)
    // Csak frissítsük a currentPatient-et
    // Note: If backend doesn't return kezelesreErkezesIndoka, preserve it from currentPatientRef
    const patientWithPreservedKezelesreErkezesIndoka = {
      ...patient,
      kezelesreErkezesIndoka: patient.kezelesreErkezesIndoka ?? currentPatientRef.current?.kezelesreErkezesIndoka ?? null,
    };
    updateCurrentPatient(patientWithPreservedKezelesreErkezesIndoka);
  }, [patient?.id, patient?.updatedAt, isViewOnly, reset, savingSource]);

  // Set kezeleoorvos value when options are loaded and patient has a value
  useEffect(() => {
    if (patient?.kezeleoorvos && kezeloorvosOptions.length > 0) {
      // Check if the patient's kezeleoorvos value exists in the options
      const optionExists = kezeloorvosOptions.some(option => option.name === patient.kezeleoorvos);
      if (optionExists) {
        setValue('kezeleoorvos', patient.kezeleoorvos);
      }
    }
  }, [kezeloorvosOptions, patient?.kezeleoorvos, setValue]);

  const radioterapia = watch('radioterapia');
  const chemoterapia = watch('chemoterapia');
  const kezeleoorvos = watch('kezeleoorvos');
  const beutaloOrvos = watch('beutaloOrvos');
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

  // Update implantatumok and fogak when patient data changes (but not from auto-save)
  // Only update if it's an external change (different patient ID or significant time difference)
  useEffect(() => {
    if (!patient) {
      setImplantatumok({});
      setFogak({});
      return;
    }

    // Ha az id változott, biztosan külső betöltés
    if (previousPatientIdRef.current !== patient.id) {
      if (patient.meglevoImplantatumok) {
        setImplantatumok(patient.meglevoImplantatumok);
      } else {
        setImplantatumok({});
      }
      if (patient.meglevoFogak) {
        setFogak(patient.meglevoFogak as Record<string, ToothStatus>);
      } else {
        setFogak({});
      }
      return;
    }

    // Ha savingSource aktív (auto-save vagy manual save), ne frissítsük
    // (A performSave már frissítette a state-et)
    if (savingSource && previousPatientIdRef.current === patient.id) {
      return;
    }

    // Első betöltés esetén frissítsük
    if (!previousPatientIdRef.current && patient.id) {
      if (patient.meglevoImplantatumok) {
        setImplantatumok(patient.meglevoImplantatumok);
      } else {
        setImplantatumok({});
      }
      if (patient.meglevoFogak) {
        setFogak(patient.meglevoFogak as Record<string, ToothStatus>);
      } else {
        setFogak({});
      }
    }
  }, [patient?.id, patient?.updatedAt, patient?.meglevoImplantatumok, patient?.meglevoFogak, savingSource]);
  const kezelesiTervFelso = watch('kezelesiTervFelso') || [];
  const kezelesiTervAlso = watch('kezelesiTervAlso') || [];
  const kezelesiTervArcotErinto = watch('kezelesiTervArcotErinto') || [];

  // Kezeléstípusok a dropdownhoz (treatment_types)
  const [treatmentTypes, setTreatmentTypes] = useState<Array<{ id: string; code: string; labelHu: string }>>([]);
  useEffect(() => {
    fetch('/api/treatment-types', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : Promise.resolve({ treatmentTypes: [] }))
      .then((data) => setTreatmentTypes(data.treatmentTypes ?? []))
      .catch(() => setTreatmentTypes([]));
  }, []);

  // Watch all form values - useWatch for memoized snapshot
  const formValues = useWatch({ control });

  // Best practice: request sequencing + source-aware abort
  const saveSequenceRef = useRef(0);
  const lastSavedHashRef = useRef<string | null>(null);
  const autoSaveAbortRef = useRef<AbortController | null>(null);
  const manualSaveAbortRef = useRef<AbortController | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Telemetria / Debug jelzők
  const lastSaveSourceRef = useRef<'auto' | 'manual' | null>(null);
  const lastSaveAttemptAtRef = useRef<number | null>(null);
  const lastSaveErrorRef = useRef<Error | null>(null);
  
  // State for conflict banner visibility (auto-save 409)
  const [showConflictBanner, setShowConflictBanner] = useState(false);

  // State refs - hogy a performSave ne függjön closure-öktől
  const fogakRef = useRef(fogak);
  const implantatumokRef = useRef(implantatumok);
  const vanBeutaloRef = useRef(vanBeutalo);
  const currentPatientIdRef = useRef(currentPatient?.id);

  // Sync refs with state
  useEffect(() => {
    fogakRef.current = fogak;
    implantatumokRef.current = implantatumok;
    vanBeutaloRef.current = vanBeutalo;
    currentPatientIdRef.current = currentPatient?.id;
  }, [fogak, implantatumok, vanBeutalo, currentPatient?.id]);

  // Reset hash és sequence új beteg betöltésekor
  useEffect(() => {
    lastSavedHashRef.current = null;
    saveSequenceRef.current = 0;
    lastSaveSourceRef.current = null;
    lastSaveErrorRef.current = null;
    setShowConflictBanner(false);
    setShowConflictModal(false);
    setConflictError(null);
  }, [patient?.id]);

  // Watch individual fields to ensure we catch all changes
  const nevValue = watch('nev');
  const tajValue = watch('taj');
  const telefonszamValue = watch('telefonszam');
  const emailValue = watch('email');
  const szuletesiDatumValue = watch('szuletesiDatum');
  const nemValue = watch('nem');
  const cimValue = watch('cim');
  const varosValue = watch('varos');
  const iranyitoszamValue = watch('iranyitoszam');
  const beutaloOrvosValue = watch('beutaloOrvos');
  const beutaloIntezmenyValue = watch('beutaloIntezmeny');
  const beutaloIndokolasValue = watch('beutaloIndokolas');
  const mutetIdejeValue = watch('mutetIdeje');
  const szovettaniDiagnozisValue = watch('szovettaniDiagnozis');
  const nyakiBlokkdisszekcioValue = watch('nyakiBlokkdisszekcio');
  const kezeleoorvosValue = watch('kezeleoorvos');
  const kezeleoorvosIntezeteValue = watch('kezeleoorvosIntezete');
  const felvetelDatumaValue = watch('felvetelDatuma');
  const kezelesreErkezesIndokaValue = watch('kezelesreErkezesIndoka');




  // Automatikus intézet beállítás a kezelőorvos alapján
  useEffect(() => {
    if (kezeleoorvos && !isViewOnly && kezeloorvosOptions.length > 0) {
      // Keresés a kezelőorvos listában
      const selectedDoctor = kezeloorvosOptions.find(
        (doc) => doc.name === kezeleoorvos
      );
      
      if (selectedDoctor && selectedDoctor.intezmeny) {
        // Automatikusan beállítjuk az intézetet a kiválasztott orvos alapján
        setValue('kezeleoorvosIntezete', selectedDoctor.intezmeny);
      } else if (!selectedDoctor || !selectedDoctor.intezmeny) {
        // Ha az orvosnak nincs intézménye, töröljük az intézet mezőt
        setValue('kezeleoorvosIntezete', '');
      }
    }
  }, [kezeleoorvos, kezeloorvosOptions, setValue, isViewOnly]);

  // Automatikus intézet beállítás a beutaló orvos alapján
  useEffect(() => {
    const currentBeutaloIntezmeny = watch('beutaloIntezmeny');
    if (beutaloOrvos && !isViewOnly && vanBeutalo && beutaloOrvos.trim() !== '' && doctorOptions.length > 0) {
      // Először próbáljuk megkeresni a lokális listában
      const foundDoctor = doctorOptions.find(
        (doc) => doc.name.toLowerCase() === beutaloOrvos.trim().toLowerCase()
      );
      
      if (foundDoctor && foundDoctor.intezmeny) {
        // Ha megtaláltuk a lokális listában és van intézménye
        if (!currentBeutaloIntezmeny || currentBeutaloIntezmeny !== foundDoctor.intezmeny) {
          setValue('beutaloIntezmeny', foundDoctor.intezmeny);
        }
      } else {
        // Ha nem találjuk meg lokálisan, lekérjük az API-ból
        const fetchInstitution = async () => {
          try {
            const response = await fetch(`/api/users/by-name?name=${encodeURIComponent(beutaloOrvos.trim())}`);
            if (response.ok) {
              const data = await response.json();
              if (data.intezmeny && (!currentBeutaloIntezmeny || currentBeutaloIntezmeny !== data.intezmeny)) {
                setValue('beutaloIntezmeny', data.intezmeny);
              }
            }
          } catch (error) {
            console.error('Error fetching institution for beutaló orvos:', error);
          }
        };
        
        // Debounce: csak akkor kérjük le, ha a felhasználó nem ír éppen
        const timeoutId = setTimeout(fetchInstitution, 500);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [beutaloOrvos, vanBeutalo, doctorOptions, setValue, isViewOnly, watch]);

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

  // KEZELÉSI TERV listák kezelése (treatmentTypeCode = treatment_types.code)
  const defaultTreatmentCode = treatmentTypes[0]?.code ?? 'zarolemez';
  const addKezelesiTervFelso = () => {
    if (isViewOnly) return;
    const current = kezelesiTervFelso || [];
    setValue('kezelesiTervFelso', [
      ...current,
      { treatmentTypeCode: defaultTreatmentCode, tervezettAtadasDatuma: null, elkeszult: false }
    ]);
  };

  const removeKezelesiTervFelso = (index: number) => {
    if (isViewOnly) return;
    const current = kezelesiTervFelso || [];
    setValue('kezelesiTervFelso', current.filter((_, i) => i !== index));
  };

  const updateKezelesiTervFelso = (index: number, field: 'treatmentTypeCode' | 'tervezettAtadasDatuma' | 'elkeszult', value: any) => {
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
      { treatmentTypeCode: defaultTreatmentCode, tervezettAtadasDatuma: null, elkeszult: false }
    ]);
  };

  const removeKezelesiTervAlso = (index: number) => {
    if (isViewOnly) return;
    const current = kezelesiTervAlso || [];
    setValue('kezelesiTervAlso', current.filter((_, i) => i !== index));
  };

  const updateKezelesiTervAlso = (index: number, field: 'treatmentTypeCode' | 'tervezettAtadasDatuma' | 'elkeszult', value: any) => {
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
    setImplantatumok(prev => {
      // Ha üres a leírás, töröljük a kulcsot
      if (!details || details.trim() === '') {
        const newState = { ...prev };
        delete newState[toothNumber];
        return newState;
      }
      return { ...prev, [toothNumber]: details };
    });
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

  // Manual submit - használja a RHF data paramétert
  const onSubmit = async (data: Patient) => {
    // Check for validation errors before submitting
    const hasErrors = errors && Object.keys(errors).length > 0;
    if (hasErrors) {
      // Scroll to first invalid field
      scrollToFirstInvalid();
      showToast('Kérjük, javítsa ki a hibákat az űrlapban', 'error');
      return;
    }

    try {
      await performSave('manual', data);
    } catch (error) {
      // Error already handled in performSave
    }
  };

  // Save patient silently (without alert) - used for document upload
  const savePatientSilently = useCallback(async (): Promise<string | null> => {
    // Get current form values
    const formData = getValues();
    
    // Normalize fogak data
    const normalizedFogak: Record<string, { status?: 'D' | 'F' | 'M'; description?: string }> = {};
    Object.entries(fogak).forEach(([toothNumber, value]) => {
      const normalizedValue = normalizeToothData(value);
      if (normalizedValue) {
        normalizedFogak[toothNumber] = normalizedValue;
      }
    });
    
    // Prepare patient data
    // If vanBeutalo is false, clear beutaló fields
    const patientData: Patient = {
      ...formData,
      id: currentPatient?.id,
      meglevoImplantatumok: implantatumok,
      meglevoFogak: normalizedFogak,
      // Clear beutaló fields if vanBeutalo is false
      beutaloOrvos: vanBeutalo ? formData.beutaloOrvos : null,
      beutaloIntezmeny: vanBeutalo ? formData.beutaloIntezmeny : null,
      beutaloIndokolas: vanBeutalo ? formData.beutaloIndokolas : null,
    };
    
    // Validate using schema
    const validatedPatient = patientSchema.parse(patientData);
    
    // Save patient directly via API (bypassing onSave callback to avoid alert)
    const savedPatient = await savePatient(validatedPatient);
    
    // Update local state (both state and ref)
    updateCurrentPatient(savedPatient);
    
    // Update vanBeutalo state based on saved patient data
    const savedVanBeutalo = !!(savedPatient.beutaloOrvos || savedPatient.beutaloIntezmeny || savedPatient.kezelesreErkezesIndoka);
    setVanBeutalo(savedVanBeutalo);
    
    // Update implantatumok and fogak state with saved values
    if (savedPatient.meglevoImplantatumok) {
      setImplantatumok(savedPatient.meglevoImplantatumok);
    }
    if (savedPatient.meglevoFogak) {
      setFogak(savedPatient.meglevoFogak as Record<string, ToothStatus>);
    }
    
    // Reset form dirty state
    reset(savedPatient ? {
      ...savedPatient,
      szuletesiDatum: formatDateForInput(savedPatient.szuletesiDatum),
      mutetIdeje: formatDateForInput(savedPatient.mutetIdeje),
      felvetelDatuma: formatDateForInput(savedPatient.felvetelDatuma),
      kezelesiTervFelso: savedPatient.kezelesiTervFelso?.map(item => ({
        ...item,
        tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma)
      })) || [],
      kezelesiTervAlso: savedPatient.kezelesiTervAlso?.map(item => ({
        ...item,
        tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma)
      })) || [],
      kezelesiTervArcotErinto: savedPatient.kezelesiTervArcotErinto?.map(item => ({
        ...item,
        tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma)
      })) || [],
    } : undefined, { keepDirty: false, keepDefaultValues: false });
    
    // Don't call onSave callback to avoid triggering alert
    // The patient is saved, but we don't want to show the "Beteg mentve" popup
    
    return savedPatient.id || null;
  }, [getValues, fogak, implantatumok, currentPatient, reset, setImplantatumok, setFogak, onSave, vanBeutalo, setVanBeutalo]);

  // Save patient for booking - used when booking appointment before saving form
  const savePatientForBooking = useCallback(async (): Promise<Patient> => {
    // Get current form values
    const formData = getValues();
    
    // Normalize fogak data
    const normalizedFogak: Record<string, { status?: 'D' | 'F' | 'M'; description?: string }> = {};
    Object.entries(fogak).forEach(([toothNumber, value]) => {
      const normalizedValue = normalizeToothData(value);
      if (normalizedValue) {
        normalizedFogak[toothNumber] = normalizedValue;
      }
    });
    
    // Prepare patient data
    // If vanBeutalo is false, clear beutaló fields
    const patientData: Patient = {
      ...formData,
      id: currentPatient?.id,
      meglevoImplantatumok: implantatumok,
      meglevoFogak: normalizedFogak,
      // Clear beutaló fields if vanBeutalo is false
      beutaloOrvos: vanBeutalo ? formData.beutaloOrvos : null,
      beutaloIntezmeny: vanBeutalo ? formData.beutaloIntezmeny : null,
      beutaloIndokolas: vanBeutalo ? formData.beutaloIndokolas : null,
    };
    
    // Validate using schema
    const validatedPatient = patientSchema.parse(patientData);
    
    // Save patient
    const savedPatient = await savePatient(validatedPatient);
    
    // Update local state (both state and ref)
    updateCurrentPatient(savedPatient);
    
    // Update vanBeutalo state based on saved patient data
    const savedVanBeutalo = !!(savedPatient.beutaloOrvos || savedPatient.beutaloIntezmeny || savedPatient.kezelesreErkezesIndoka);
    setVanBeutalo(savedVanBeutalo);
    
    // Update implantatumok and fogak state with saved values
    if (savedPatient.meglevoImplantatumok) {
      setImplantatumok(savedPatient.meglevoImplantatumok);
    }
    if (savedPatient.meglevoFogak) {
      setFogak(savedPatient.meglevoFogak as Record<string, ToothStatus>);
    }
    
    // Reset form dirty state - this will mark the form as not dirty
    reset(savedPatient ? {
      ...savedPatient,
      szuletesiDatum: formatDateForInput(savedPatient.szuletesiDatum),
      mutetIdeje: formatDateForInput(savedPatient.mutetIdeje),
      felvetelDatuma: formatDateForInput(savedPatient.felvetelDatuma),
      kezelesiTervFelso: savedPatient.kezelesiTervFelso?.map(item => ({
        ...item,
        tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma)
      })) || [],
      kezelesiTervAlso: savedPatient.kezelesiTervAlso?.map(item => ({
        ...item,
        tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma)
      })) || [],
      kezelesiTervArcotErinto: savedPatient.kezelesiTervArcotErinto?.map(item => ({
        ...item,
        tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma)
      })) || [],
    } : undefined, { keepDirty: false, keepDefaultValues: false });
    
    return savedPatient;
  }, [getValues, fogak, implantatumok, currentPatient, reset, setImplantatumok, setFogak, vanBeutalo, setVanBeutalo]);

  // Helper function to compare field values with normalization
  const compareFieldValues = useCallback((field: keyof Patient, currentValue: any, originalValue: any): boolean => {
    // Normalize dates for comparison - do this BEFORE normalizeValue
    const dateFields: (keyof Patient)[] = ['szuletesiDatum', 'mutetIdeje', 'felvetelDatuma', 'balesetIdopont'];
    if (dateFields.includes(field)) {
      const currentDate = normalizeDate(currentValue);
      const originalDate = normalizeDate(originalValue);
      return currentDate !== originalDate;
    }

    // For arrays (like kezelesiTervFelso, kezelesiTervAlso, kezelesiTervArcotErinto), normalize dates inside
    const arrayFields: (keyof Patient)[] = ['kezelesiTervFelso', 'kezelesiTervAlso', 'kezelesiTervArcotErinto'];
    if (arrayFields.includes(field)) {
      const currentNormalizedStr = normalizeArray(currentValue);
      const originalNormalizedStr = normalizeArray(originalValue);
      return currentNormalizedStr !== originalNormalizedStr;
    }

    const currentNormalized = normalizeValue(currentValue);
    const originalNormalized = normalizeValue(originalValue);

    // For other arrays, use normalized comparison
    if (Array.isArray(currentNormalized) || Array.isArray(originalNormalized)) {
      const currentNormalizedStr = normalizeArray(currentNormalized);
      const originalNormalizedStr = normalizeArray(originalNormalized);
      return currentNormalizedStr !== originalNormalizedStr;
    }

    // For objects, use normalized comparison
    if (typeof currentNormalized === 'object' && typeof originalNormalized === 'object' && currentNormalized !== null && originalNormalized !== null) {
      const currentNormalizedStr = normalizeObject(currentNormalized);
      const originalNormalizedStr = normalizeObject(originalNormalized);
      return currentNormalizedStr !== originalNormalizedStr;
    }

    // For strings, trim and compare
    if (typeof currentNormalized === 'string' && typeof originalNormalized === 'string') {
      return currentNormalized.trim() !== originalNormalized.trim();
    }

    // For booleans and other primitives, direct comparison
    return currentNormalized !== originalNormalized;
  }, []);

  // Get list of unsaved changes with field names
  const getUnsavedChangesList = useCallback((): string[] => {
    if (isViewOnly) return [];
    
    // Use currentPatientRef for immediate access (updated synchronously after save)
    // Fall back to currentPatient state or patient prop
    const referencePatient = currentPatientRef.current || currentPatient || patient;
    const changes: string[] = [];
    
    // Field name mapping (camelCase to Hungarian display name)
    const fieldNames: Record<string, string> = {
      nev: 'Név',
      taj: 'TAJ szám',
      telefonszam: 'Telefonszám',
      szuletesiDatum: 'Születési dátum',
      nem: 'Nem',
      email: 'Email',
      cim: 'Cím',
      varos: 'Város',
      iranyitoszam: 'Irányítószám',
      beutaloOrvos: 'Beutaló orvos',
      beutaloIntezmeny: 'Beutaló intézmény',
      beutaloIndokolas: 'Beutaló indokolás',
      mutetIdeje: 'Műtét ideje',
      szovettaniDiagnozis: 'Szövettani diagnózis',
      nyakiBlokkdisszekcio: 'Nyaki blokkdisszekció',
      alkoholfogyasztas: 'Alkoholfogyasztás',
      dohanyzasSzam: 'Dohányzás',
      kezelesreErkezesIndoka: 'Kezelésre érkezés indoka',
      maxilladefektusVan: 'Maxilladefektus',
      brownFuggolegesOsztaly: 'Brown függőleges osztály',
      brownVizszintesKomponens: 'Brown vízszintes komponens',
      mandibuladefektusVan: 'Mandibuladefektus',
      kovacsDobakOsztaly: 'Kovács-Dobák osztály',
      nyelvmozgásokAkadályozottak: 'Nyelvmozgások akadályozottak',
      gombocosBeszed: 'Gombócos beszéd',
      nyalmirigyAllapot: 'Nyálmirigy állapot',
      radioterapia: 'Radioterápia',
      radioterapiaDozis: 'Radioterápia dózis',
      radioterapiaDatumIntervallum: 'Radioterápia dátumintervallum',
      chemoterapia: 'Kemoterápia',
      chemoterapiaLeiras: 'Kemoterápia leírás',
      kezeleoorvos: 'Kezelőorvos',
      kezeleoorvosIntezete: 'Kezelőorvos intézete',
      felvetelDatuma: 'Felvétel dátuma',
      felsoFogpotlasVan: 'Felső fogpótlás van',
      alsoFogpotlasVan: 'Alsó fogpótlás van',
      meglevoImplantatumok: 'Meglévő implantátumok',
      meglevoFogak: 'Meglévő fogak',
      vanBeutalo: 'Van beutaló',
    };
    
    if (!isNewPatient && referencePatient) {
      // Check vanBeutalo state
      // Note: kezelesreErkezesIndoka is independent, not part of beutaló
      const savedVanBeutalo = !!(referencePatient.beutaloOrvos || referencePatient.beutaloIntezmeny);
      if (vanBeutalo !== savedVanBeutalo) {
        changes.push(fieldNames.vanBeutalo || 'Van beutaló');
      }
      
      // Check implantatumok and fogak
      const originalImplantatumok = referencePatient.meglevoImplantatumok || {};
      const originalFogak = referencePatient.meglevoFogak || {};
      const implantatumokChanged = normalizeObject(implantatumok) !== normalizeObject(originalImplantatumok);
      const fogakChanged = normalizeObject(fogak) !== normalizeObject(originalFogak);
      
      if (implantatumokChanged) {
        changes.push(fieldNames.meglevoImplantatumok || 'Meglévő implantátumok');
      }
      if (fogakChanged) {
        changes.push(fieldNames.meglevoFogak || 'Meglévő fogak');
      }
      
      // Check form fields
      const keyFields: (keyof Patient)[] = [
        'nev', 'taj', 'telefonszam', 'email', 'szuletesiDatum', 'nem',
        'cim', 'varos', 'iranyitoszam',
        'beutaloOrvos', 'beutaloIntezmeny', 'beutaloIndokolas', 'mutetIdeje',
        'szovettaniDiagnozis', 'nyakiBlokkdisszekcio',
        'radioterapia', 'radioterapiaDozis', 'radioterapiaDatumIntervallum',
        'chemoterapia', 'chemoterapiaLeiras',
        'alkoholfogyasztas', 'dohanyzasSzam', 'kezelesreErkezesIndoka',
        'maxilladefektusVan', 'brownFuggolegesOsztaly', 'brownVizszintesKomponens',
        'mandibuladefektusVan', 'kovacsDobakOsztaly',
        'nyelvmozgásokAkadályozottak', 'gombocosBeszed', 'nyalmirigyAllapot',
        'tnmStaging',
        'felsoFogpotlasVan', 'felsoFogpotlasMikor', 'felsoFogpotlasKeszito',
        'felsoFogpotlasElegedett', 'felsoFogpotlasProblema', 'felsoFogpotlasTipus',
        'alsoFogpotlasVan', 'alsoFogpotlasMikor', 'alsoFogpotlasKeszito',
        'alsoFogpotlasElegedett', 'alsoFogpotlasProblema', 'alsoFogpotlasTipus',
        'fabianFejerdyProtetikaiOsztalyFelso', 'fabianFejerdyProtetikaiOsztalyAlso',
        'fabianFejerdyProtetikaiOsztaly',
        'kezeleoorvos', 'kezeleoorvosIntezete', 'felvetelDatuma',
        'nemIsmertPoziciokbanImplantatum', 'nemIsmertPoziciokbanImplantatumRészletek',
        'kezelesiTervFelso', 'kezelesiTervAlso', 'kezelesiTervArcotErinto',
        'balesetIdopont', 'balesetEtiologiaja', 'balesetEgyeb',
        'primerMutetLeirasa', 'bno', 'diagnozis',
        'veleszuletettRendellenessegek', 'veleszuletettMutetekLeirasa'
      ];
      
      keyFields.forEach(field => {
        const currentValue = formValues[field];
        const originalValue = referencePatient[field];
        if (compareFieldValues(field, currentValue, originalValue)) {
          const fieldName = fieldNames[field] || field;
          changes.push(fieldName);
        }
      });
    } else if (isNewPatient && currentPatient?.id) {
      // For new patients that have been saved, check changes since last save
      const keyFields: (keyof Patient)[] = [
        'nev', 'taj', 'telefonszam', 'email', 'szuletesiDatum', 'nem',
        'cim', 'varos', 'iranyitoszam',
        'beutaloOrvos', 'beutaloIntezmeny', 'beutaloIndokolas', 'mutetIdeje',
        'szovettaniDiagnozis', 'nyakiBlokkdisszekcio',
        'radioterapia', 'radioterapiaDozis', 'radioterapiaDatumIntervallum',
        'chemoterapia', 'chemoterapiaLeiras',
        'alkoholfogyasztas', 'dohanyzasSzam', 'kezelesreErkezesIndoka',
        'maxilladefektusVan', 'brownFuggolegesOsztaly', 'brownVizszintesKomponens',
        'mandibuladefektusVan', 'kovacsDobakOsztaly',
        'nyelvmozgásokAkadályozottak', 'gombocosBeszed', 'nyalmirigyAllapot',
        'tnmStaging',
        'felsoFogpotlasVan', 'felsoFogpotlasMikor', 'felsoFogpotlasKeszito',
        'felsoFogpotlasElegedett', 'felsoFogpotlasProblema', 'felsoFogpotlasTipus',
        'alsoFogpotlasVan', 'alsoFogpotlasMikor', 'alsoFogpotlasKeszito',
        'alsoFogpotlasElegedett', 'alsoFogpotlasProblema', 'alsoFogpotlasTipus',
        'fabianFejerdyProtetikaiOsztalyFelso', 'fabianFejerdyProtetikaiOsztalyAlso',
        'fabianFejerdyProtetikaiOsztaly',
        'kezeleoorvos', 'kezeleoorvosIntezete', 'felvetelDatuma',
        'nemIsmertPoziciokbanImplantatum', 'nemIsmertPoziciokbanImplantatumRészletek',
        'kezelesiTervFelso', 'kezelesiTervAlso', 'kezelesiTervArcotErinto',
        'balesetIdopont', 'balesetEtiologiaja', 'balesetEgyeb',
        'primerMutetLeirasa', 'bno', 'diagnozis',
        'veleszuletettRendellenessegek', 'veleszuletettMutetekLeirasa'
      ];
      
      // Note: kezelesreErkezesIndoka is independent, not part of beutaló
      const savedVanBeutalo = !!(currentPatient.beutaloOrvos || currentPatient.beutaloIntezmeny);
      if (vanBeutalo !== savedVanBeutalo) {
        changes.push(fieldNames.vanBeutalo || 'Van beutaló');
      }
      
      const implantatumokChanged = normalizeObject(implantatumok) !== normalizeObject(currentPatient.meglevoImplantatumok || {});
      const fogakChanged = normalizeObject(fogak) !== normalizeObject(currentPatient.meglevoFogak || {});
      
      if (implantatumokChanged) {
        changes.push(fieldNames.meglevoImplantatumok || 'Meglévő implantátumok');
      }
      if (fogakChanged) {
        changes.push(fieldNames.meglevoFogak || 'Meglévő fogak');
      }
      
      keyFields.forEach(field => {
        const currentValue = formValues[field];
        const originalValue = currentPatient[field];
        if (compareFieldValues(field, currentValue, originalValue)) {
          const fieldName = fieldNames[field] || field;
          changes.push(fieldName);
        }
      });
    }
    
    return changes;
  }, [isViewOnly, patient, currentPatient, implantatumok, fogak, isNewPatient, formValues, compareFieldValues, vanBeutalo]);

  // Check if form has unsaved changes
  const hasUnsavedChanges = useCallback(() => {
    if (isViewOnly) return false;
    
    // Use currentPatientRef for immediate access (updated synchronously after save)
    // Fall back to currentPatient state or patient prop
    const referencePatient = currentPatientRef.current || currentPatient || patient;
    
    // For existing patients: compare current values with original patient data
    if (!isNewPatient && referencePatient) {
      // Check if implantatumok or fogak have changed (using normalized comparison)
      const originalImplantatumok = referencePatient.meglevoImplantatumok || {};
      const originalFogak = referencePatient.meglevoFogak || {};
      
      const implantatumokChanged = normalizeObject(implantatumok) !== normalizeObject(originalImplantatumok);
      const fogakChanged = normalizeObject(fogak) !== normalizeObject(originalFogak);
      
      // If implantatumok or fogak changed, there are unsaved changes
      if (implantatumokChanged || fogakChanged) {
        return true;
      }
      
      // Check if vanBeutalo state matches saved patient data
      // Note: kezelesreErkezesIndoka is independent, not part of beutaló
      const savedVanBeutalo = !!(referencePatient.beutaloOrvos || referencePatient.beutaloIntezmeny);
      if (vanBeutalo !== savedVanBeutalo) {
        return true;
      }
      
      // For form fields, check if there's actual difference (don't rely only on isDirty)
      // Compare all fields with the saved patient data
      // Complete list of all Patient schema fields that should be checked
      const keyFields: (keyof Patient)[] = [
        // Alapadatok
        'nev', 'taj', 'telefonszam', 'email', 'szuletesiDatum', 'nem',
        'cim', 'varos', 'iranyitoszam',
        // Beutaló
        'beutaloOrvos', 'beutaloIntezmeny', 'beutaloIndokolas', 'mutetIdeje',
        'szovettaniDiagnozis', 'nyakiBlokkdisszekcio',
        // Adjuváns terápiák
        'radioterapia', 'radioterapiaDozis', 'radioterapiaDatumIntervallum',
        'chemoterapia', 'chemoterapiaLeiras',
        // Anamnézis és betegvizsgálat
        'alkoholfogyasztas', 'dohanyzasSzam', 'kezelesreErkezesIndoka',
        'maxilladefektusVan', 'brownFuggolegesOsztaly', 'brownVizszintesKomponens',
        'mandibuladefektusVan', 'kovacsDobakOsztaly',
        'nyelvmozgásokAkadályozottak', 'gombocosBeszed', 'nyalmirigyAllapot',
        'tnmStaging',
        // Protézis - felső
        'felsoFogpotlasVan', 'felsoFogpotlasMikor', 'felsoFogpotlasKeszito',
        'felsoFogpotlasElegedett', 'felsoFogpotlasProblema', 'felsoFogpotlasTipus',
        // Protézis - alsó
        'alsoFogpotlasVan', 'alsoFogpotlasMikor', 'alsoFogpotlasKeszito',
        'alsoFogpotlasElegedett', 'alsoFogpotlasProblema', 'alsoFogpotlasTipus',
        // Fogazati státusz
        'fabianFejerdyProtetikaiOsztalyFelso', 'fabianFejerdyProtetikaiOsztalyAlso',
        'fabianFejerdyProtetikaiOsztaly',
        'kezeleoorvos', 'kezeleoorvosIntezete', 'felvetelDatuma',
        'nemIsmertPoziciokbanImplantatum', 'nemIsmertPoziciokbanImplantatumRészletek',
        // Kezelési terv
        'kezelesiTervFelso', 'kezelesiTervAlso', 'kezelesiTervArcotErinto',
        // Trauma
        'balesetIdopont', 'balesetEtiologiaja', 'balesetEgyeb',
        // Onkológia
        'primerMutetLeirasa', 'bno', 'diagnozis',
        // Veleszületett rendellenesség
        'veleszuletettRendellenessegek', 'veleszuletettMutetekLeirasa'
      ];
        
      // Special handling for kezelesreErkezesIndoka: if referencePatient doesn't have it,
      // use form value as reference (because if form has it, it's saved)
      const referenceKezelesreErkezesIndoka = referencePatient.kezelesreErkezesIndoka ?? formValues.kezelesreErkezesIndoka ?? null;
        
      // Check if any key field actually changed
      const hasActualChange = keyFields.some(field => {
        const currentValue = formValues[field];
        // For kezelesreErkezesIndoka, use the special reference value
        const originalValue = field === 'kezelesreErkezesIndoka' 
          ? referenceKezelesreErkezesIndoka 
          : referencePatient[field];
        const result = compareFieldValues(field, currentValue, originalValue);
        return result;
      });
        
      return hasActualChange;
    }
      
    // For new patients: check if there's any meaningful data entered that hasn't been saved yet
    if (isNewPatient) {
      // If patient was already saved (has ID), check if there are changes since last save
      if (currentPatient?.id) {
        // Compare with saved patient - same logic as existing patients
        const keyFields: (keyof Patient)[] = [
          // Alapadatok
          'nev', 'taj', 'telefonszam', 'email', 'szuletesiDatum', 'nem',
          'cim', 'varos', 'iranyitoszam',
          // Beutaló
          'beutaloOrvos', 'beutaloIntezmeny', 'beutaloIndokolas', 'mutetIdeje',
          'szovettaniDiagnozis', 'nyakiBlokkdisszekcio',
          // Adjuváns terápiák
          'radioterapia', 'radioterapiaDozis', 'radioterapiaDatumIntervallum',
          'chemoterapia', 'chemoterapiaLeiras',
          // Anamnézis és betegvizsgálat
          'alkoholfogyasztas', 'dohanyzasSzam', 'kezelesreErkezesIndoka',
          'maxilladefektusVan', 'brownFuggolegesOsztaly', 'brownVizszintesKomponens',
          'mandibuladefektusVan', 'kovacsDobakOsztaly',
          'nyelvmozgásokAkadályozottak', 'gombocosBeszed', 'nyalmirigyAllapot',
          'tnmStaging',
          // Protézis - felső
          'felsoFogpotlasVan', 'felsoFogpotlasMikor', 'felsoFogpotlasKeszito',
          'felsoFogpotlasElegedett', 'felsoFogpotlasProblema', 'felsoFogpotlasTipus',
          // Protézis - alsó
          'alsoFogpotlasVan', 'alsoFogpotlasMikor', 'alsoFogpotlasKeszito',
          'alsoFogpotlasElegedett', 'alsoFogpotlasProblema', 'alsoFogpotlasTipus',
          // Fogazati státusz
          'fabianFejerdyProtetikaiOsztalyFelso', 'fabianFejerdyProtetikaiOsztalyAlso',
          'fabianFejerdyProtetikaiOsztaly',
          'kezeleoorvos', 'kezeleoorvosIntezete', 'felvetelDatuma',
          'nemIsmertPoziciokbanImplantatum', 'nemIsmertPoziciokbanImplantatumRészletek',
          // Kezelési terv
          'kezelesiTervFelso', 'kezelesiTervAlso', 'kezelesiTervArcotErinto',
          // Trauma
          'balesetIdopont', 'balesetEtiologiaja', 'balesetEgyeb',
          // Onkológia
          'primerMutetLeirasa', 'bno', 'diagnozis',
          // Veleszületett rendellenesség
          'veleszuletettRendellenessegek', 'veleszuletettMutetekLeirasa'
        ];
        
        const hasActualChange = keyFields.some(field => {
          const currentValue = formValues[field];
          const originalValue = currentPatient[field];
          return compareFieldValues(field, currentValue, originalValue);
        });
        
        const implantatumokChanged = normalizeObject(implantatumok) !== normalizeObject(currentPatient.meglevoImplantatumok || {});
        const fogakChanged = normalizeObject(fogak) !== normalizeObject(currentPatient.meglevoFogak || {});
        
        // Check if vanBeutalo state matches saved patient data
        // Note: kezelesreErkezesIndoka is independent, not part of beutaló
        const savedVanBeutalo = !!(currentPatient.beutaloOrvos || currentPatient.beutaloIntezmeny);
        const vanBeutaloChanged = vanBeutalo !== savedVanBeutalo;
        
        return hasActualChange || implantatumokChanged || fogakChanged || vanBeutaloChanged;
      }
      
      // If patient hasn't been saved yet, check if there's any data
      const importantFields: (keyof Patient)[] = [
        'nev', 'taj', 'telefonszam', 'email', 'szuletesiDatum', 'nem',
        'beutaloOrvos', 'beutaloIntezmeny', 'beutaloIndokolas',
        'kezeleoorvos', 'kezelesreErkezesIndoka'
      ];
      
      const hasImportantData = importantFields.some(field => {
        const value = formValues[field];
        if (value === null || value === undefined || value === '') return false;
        if (typeof value === 'string' && value.trim() === '') return false;
        return true;
      });
      
      const hasImplantatumokOrFogak = Object.keys(implantatumok).length > 0 || Object.keys(fogak).length > 0;
      
      return hasImportantData || hasImplantatumokOrFogak;
    }
    
    return false;
  }, [isViewOnly, patient, currentPatient, implantatumok, fogak, isNewPatient, formValues, compareFieldValues, vanBeutalo]);

  // Handle form cancellation - check for unsaved changes
  const handleCancel = async () => {
    if (isViewOnly) {
      onCancel();
      return;
    }
    
    // Check if there are unsaved changes
    if (hasUnsavedChanges()) {
      const changes = getUnsavedChangesList();
      let message = 'Van nem mentett változás az űrlapban. Biztosan bezárja az űrlapot? A változások elvesznek.';
      
      if (changes.length > 0) {
        const changesList = changes.slice(0, 10).join(', '); // Limit to 10 items
        const moreText = changes.length > 10 ? ` és még ${changes.length - 10} további` : '';
        message = `Van nem mentett változás az űrlapban:\n\n${changesList}${moreText}\n\nBiztosan bezárja az űrlapot? A változások elvesznek.`;
      }
      
      const shouldCancel = await confirmDialog(
        message,
        {
          title: 'Nem mentett változások',
          confirmText: 'Igen, bezárom',
          cancelText: 'Mégse',
          type: 'warning'
        }
      );
      
      if (!shouldCancel) {
        return; // User chose not to cancel
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

  // Stabil payload builder - memoizált, hogy ne épüljön újra feleslegesen
  const buildSavePayload = useCallback((
    formData: Patient,
    fogakData: Record<string, ToothStatus>,
    implantData: Record<string, string>,
    vanBeutaloVal: boolean,
    patientId?: string | null
  ): Patient => {
    const normalizedFogak: Record<string, { status?: "D" | "F" | "M"; description?: string }> = {};
    for (const [toothNumber, value] of Object.entries(fogakData)) {
      const normalized = normalizeToothData(value);
      if (normalized) normalizedFogak[toothNumber] = normalized;
    }

    return {
      ...formData,
      id: patientId ?? undefined,
      meglevoImplantatumok: implantData,
      meglevoFogak: normalizedFogak,
      beutaloOrvos: vanBeutaloVal ? formData.beutaloOrvos : null,
      beutaloIntezmeny: vanBeutaloVal ? formData.beutaloIntezmeny : null,
      beutaloIndokolas: vanBeutaloVal ? formData.beutaloIndokolas : null,

      radioterapia: formData.radioterapia ?? false,
      chemoterapia: formData.chemoterapia ?? false,
      felsoFogpotlasVan: formData.felsoFogpotlasVan ?? false,
      felsoFogpotlasElegedett: formData.felsoFogpotlasElegedett ?? true,
      alsoFogpotlasVan: formData.alsoFogpotlasVan ?? false,
      alsoFogpotlasElegedett: formData.alsoFogpotlasElegedett ?? true,
      nemIsmertPoziciokbanImplantatum: formData.nemIsmertPoziciokbanImplantatum ?? false,
      maxilladefektusVan: formData.maxilladefektusVan ?? false,
      kezelesiTervFelso: formData.kezelesiTervFelso || [],
      kezelesiTervAlso: formData.kezelesiTervAlso || [],
      kezelesiTervArcotErinto: formData.kezelesiTervArcotErinto || [],
    };
  }, []);

  // Robusztus hiba típus detektálás - ApiError alapú (regex fallback eltávolítva)
  const isRetryableError = useCallback((err: any): boolean => {
    if (!err) return false;

    // AbortError: user abort, ne retry
    if (err.name === "AbortError") return false;

    // TimeoutError: retry
    if (err instanceof TimeoutError || err.name === "TimeoutError") return true;

    // Network: fetch often throws TypeError
    if (err instanceof TypeError) return true;

    // Strukturált API hiba - ApiError instance vagy name check
    if (err instanceof ApiError || err.name === "ApiError") {
      const status = (err as ApiError).status;
      // 409 (konfliktus): no retry
      if (status === 409) return false;
      // 429 (rate limit) vagy 5xx (server error): retry
      return status === 429 || status >= 500;
    }

    // Ha ApiError, de nincs status mező (nem várható, de safety check)
    if (err.name === "ApiError" && typeof (err as any).status === "number") {
      const status = (err as any).status;
      if (status === 409) return false;
      return status === 429 || status >= 500;
    }

    // Egyéb esetek: no retry (biztonságos default)
    return false;
  }, []);

  // Unified save function - best practice implementáció
  const performSave = useCallback(async (
    source: "auto" | "manual",
    formData: Patient,
    retryCount = 0
  ): Promise<Patient | null> => {
    // Source-aware abort: Manual abortálhatja az auto-save-t
    if (source === "manual" && autoSaveAbortRef.current) {
      autoSaveAbortRef.current.abort();
      autoSaveAbortRef.current = null;
    }

    const abortRef = source === "auto" ? autoSaveAbortRef : manualSaveAbortRef;

    // Cancel previous same-source request
    if (abortRef.current) abortRef.current.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    const seq = ++saveSequenceRef.current;

    // Event logging: attempt
    const startTime = Date.now();
    const eventType = source === 'auto' ? 'autosave_attempt' : 'manualsave_attempt';
    logEvent(eventType, {
      source,
      patientId: currentPatientIdRef.current || undefined,
    });

    try {
      setSavingSource(source);
      lastSaveAttemptAtRef.current = startTime;
      lastSaveErrorRef.current = null;

      const payload = buildSavePayload(
        formData,
        fogakRef.current,
        implantatumokRef.current,
        vanBeutaloRef.current,
        currentPatientIdRef.current
      );

      const parsed = patientSchema.safeParse(payload);
      if (!parsed.success) {
        await trigger();
        if (source === "auto") return null;
        const msg = parsed.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("; ");
        throw new Error(`Validációs hibák: ${msg}`);
      }

      const validatedPayload = parsed.data;

      // Change detection csak auto-save-nél
      if (source === "auto") {
        const hash = stableStringify(validatedPayload);
        if (lastSavedHashRef.current === hash) return null;
      }

      // Ensure updatedAt is included for conflict detection (use currentPatient's updatedAt)
      const payloadWithUpdatedAt = {
        ...validatedPayload,
        updatedAt: currentPatientRef.current?.updatedAt || validatedPayload.updatedAt,
      };

      const saved = await savePatient(payloadWithUpdatedAt, { 
        signal: controller.signal,
        source 
      });

      // Sequencing: csak a legutolsó válasz érvényes
      if (seq !== saveSequenceRef.current) {
        console.log(`Save (${source}): outdated response, ignoring`);
        return null;
      }

      // Update state
      updateCurrentPatient(saved);
      setVanBeutalo(!!(saved.beutaloOrvos || saved.beutaloIntezmeny));
      if (saved.meglevoImplantatumok) setImplantatumok(saved.meglevoImplantatumok);
      if (saved.meglevoFogak) setFogak(saved.meglevoFogak as Record<string, ToothStatus>);

      // Update hash
      lastSavedHashRef.current = stableStringify(validatedPayload);
      lastSaveSourceRef.current = source;

      // Event logging: success
      const durationMs = Date.now() - startTime;
      const successEventType = source === 'auto' ? 'autosave_success' : 'manualsave_success';
      logEvent(successEventType, {
        source,
        durationMs,
        patientId: currentPatientIdRef.current || undefined,
      });

      // Tiszta callback API
      onSave(saved, { source });

      // Manual save: reset form
      if (source === "manual") {
        const resetData = {
          ...saved,
          szuletesiDatum: formatDateForInput(saved.szuletesiDatum),
          mutetIdeje: formatDateForInput(saved.mutetIdeje),
          felvetelDatuma: formatDateForInput(saved.felvetelDatuma),
          kezelesiTervFelso: saved.kezelesiTervFelso?.map(item => ({
            ...item,
            tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma)
          })) || [],
          kezelesiTervAlso: saved.kezelesiTervAlso?.map(item => ({
            ...item,
            tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma)
          })) || [],
          kezelesiTervArcotErinto: saved.kezelesiTervArcotErinto?.map(item => ({
            ...item,
            tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma)
          })) || [],
        };
        reset(resetData, { keepDirty: false, keepDefaultValues: false });
      }

      return saved;
    } catch (err: any) {
      if (err?.name === "AbortError" || controller.signal.aborted) return null;

      // 409 Conflict (STALE_WRITE) külön kezelése
      if (err instanceof ApiError && err.status === 409 && err.code === 'STALE_WRITE') {
        // Event logging: fail (409 conflict)
        const durationMs = Date.now() - startTime;
        const failEventType = source === 'auto' ? 'autosave_fail' : 'manualsave_fail';
        logEvent(failEventType, {
          source,
          durationMs,
          status: err.status,
          errorName: err.name,
          code: err.code,
          patientId: currentPatientIdRef.current || undefined,
        }, err.correlationId);

        if (source === "auto") {
          // Auto-save: ne retry, csak log és return null
          console.warn(`Auto-save conflict detected (409 STALE_WRITE):`, {
            correlationId: err.correlationId,
            details: err.details,
          });
          lastSaveErrorRef.current = err;
          setShowConflictBanner(true);
          return null;
        } else {
          // Manual save: modal megjelenítése (toast helyett)
          setConflictError(err);
          setShowConflictModal(true);
          throw err; // Ne dobjuk tovább, a modal kezeli
        }
      }

      if (retryCount < 2 && isRetryableError(err)) {
        const delay = 1000 * (retryCount + 1);
        console.warn(`Save (${source}) failed, retrying (${retryCount + 1}/2) after ${delay}ms...`, err);
        await new Promise(r => setTimeout(r, delay));

        if (source === "auto") {
          // Auto retry: friss form állapot
          return performSave("auto", getValues(), retryCount + 1);
        }
        // Manual retry: eredeti data
        return performSave("manual", formData, retryCount + 1);
      }

      // Event logging: fail (other errors)
      const durationMs = Date.now() - startTime;
      const failEventType = source === 'auto' ? 'autosave_fail' : 'manualsave_fail';
      const errorMetadata: {
        source: 'auto' | 'manual';
        durationMs: number;
        status?: number;
        errorName?: string;
        code?: string;
        patientId?: string;
      } = {
        source,
        durationMs,
        patientId: currentPatientIdRef.current || undefined,
      };

      if (err instanceof ApiError) {
        errorMetadata.status = err.status;
        errorMetadata.errorName = err.name;
        errorMetadata.code = err.code;
        logEvent(failEventType, errorMetadata, err.correlationId);
      } else if (err instanceof TimeoutError) {
        errorMetadata.errorName = 'TimeoutError';
        logEvent(failEventType, errorMetadata);
      } else {
        errorMetadata.errorName = err?.name || 'UnknownError';
        logEvent(failEventType, errorMetadata);
      }

      // Sentry: Capture unexpected errors (not ApiError 4xx, those are filtered in beforeSend)
      if (Sentry && !(err instanceof ApiError && err.status >= 400 && err.status < 500)) {
        // Only capture 5xx errors, TimeoutError, or unexpected exceptions
        if (err instanceof TimeoutError || err instanceof ApiError || !(err instanceof Error)) {
          if (err instanceof ApiError && err.correlationId) {
            Sentry.setTag('correlation_id', err.correlationId);
          }
          Sentry.captureException(err);
        }
      }

      // Error handling
      if (source === "manual") {
        showToast(`Hiba a mentés során: ${err?.message || "Ismeretlen hiba"}`, "error");
        throw err;
      }

      // Auto-save: return null, ne dobjunk
      console.error("Auto-save failed:", err);
      lastSaveErrorRef.current = err;
      return null;
    } finally {
      setSavingSource(null);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [
    buildSavePayload,
    getValues,
    onSave,
    reset,
    setFogak,
    setImplantatumok,
    setVanBeutalo,
    showToast,
    trigger,
    updateCurrentPatient,
    isRetryableError,
  ]);

  // Auto-save effect - useWatch + dirtyFields alapú (teljesítmény-optimalizált)
  // Nested dirtyFields → top-level kulcsok biztos kivonata
  const dirtyTopKeys = useMemo(() => {
    if (!isDirty) return [];
    // RHF dirtyFields lehet nested; top-level kulcs akkor érdekes, ha truthy (true/obj/array)
    return Object.keys(dirtyFields).filter(
      (k) => !!(dirtyFields as any)[k]
    );
  }, [isDirty, dirtyFields]);

  const dirtyHash = useMemo(() => {
    if (!isDirty) return null;
    const snap: any = {};
    for (const k of dirtyTopKeys) snap[k] = (formValues as any)[k];
    return stableStringify(snap);
  }, [isDirty, dirtyTopKeys, formValues]);

  useEffect(() => {
    if (isViewOnly) return;
    if (!isDirty) return;
    if (!dirtyHash) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(() => {
      performSave("auto", getValues()).catch(() => {
        // Errors handled in performSave
      });
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [
    dirtyHash,
    fogak,
    implantatumok,
    vanBeutalo,
    isViewOnly,
    isDirty,
    performSave,
    getValues,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoSaveAbortRef.current) {
        autoSaveAbortRef.current.abort();
      }
      if (manualSaveAbortRef.current) {
        manualSaveAbortRef.current.abort();
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Watch kezelésre érkezés indoka for conditional logic
  const selectedIndok = watch('kezelesreErkezesIndoka');

  // Section navigation
  const breakpoint = useBreakpoint();
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  
  // Define sections
  const allSections: Section[] = [
    { id: 'alapadatok', label: 'Alapadatok', icon: <User className="w-4 h-4" /> },
    { id: 'szemelyes', label: 'Személyes adatok', icon: <MapPin className="w-4 h-4" /> },
    { id: 'beutalo', label: 'Beutaló', icon: <FileText className="w-4 h-4" /> },
    { id: 'stadium', label: 'Stádium', icon: <Calendar className="w-4 h-4" /> },
    { id: 'anamnezis', label: 'Anamnézis', icon: <Calendar className="w-4 h-4" /> },
    { id: 'betegvizsgalat', label: 'Betegvizsgálat', icon: <Calendar className="w-4 h-4" /> },
    { id: 'ohip14', label: 'OHIP-14', icon: <FileText className="w-4 h-4" /> },
    { id: 'adminisztracio', label: 'Adminisztráció', icon: <FileText className="w-4 h-4" /> },
    { id: 'idopont', label: 'Időpont', icon: <Calendar className="w-4 h-4" /> },
  ];

  // Filter sections based on showOnlySections
  const visibleSections = showOnlySections && showOnlySections.length > 0
    ? allSections.filter(s => showOnlySections.includes(s.id))
    : allSections;

  // Get active section index
  const activeIndex = visibleSections.findIndex(s => s.id === activeSectionId);

  // Track active section based on scroll position
  useEffect(() => {
    const handleScroll = () => {
      const sections = visibleSections.map(s => ({
        id: s.id,
        element: document.getElementById(`section-${s.id}`),
      })).filter(s => s.element);

      if (sections.length === 0) return;

      const scrollPosition = window.scrollY + (breakpoint === 'mobile' ? 100 : 150);
      
      for (let i = sections.length - 1; i >= 0; i--) {
        const section = sections[i];
        if (section.element && section.element.offsetTop <= scrollPosition) {
          setActiveSectionId(section.id);
          break;
        }
      }
    };

    // Set initial active section
    if (visibleSections.length > 0 && !activeSectionId) {
      setActiveSectionId(visibleSections[0].id);
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial check

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [visibleSections, activeSectionId, breakpoint]);

  // Map fields to sections
  const fieldToSectionMap: Record<string, string> = {
    // alapadatok
    nev: 'alapadatok',
    taj: 'alapadatok',
    telefonszam: 'alapadatok',
    // szemelyes
    szuletesiDatum: 'szemelyes',
    nem: 'szemelyes',
    email: 'szemelyes',
    cim: 'szemelyes',
    varos: 'szemelyes',
    iranyitoszam: 'szemelyes',
    // beutalo
    beutaloOrvos: 'beutalo',
    beutaloIntezmeny: 'beutalo',
    beutaloIndokolas: 'beutalo',
    mutetIdeje: 'beutalo',
    szovettaniDiagnozis: 'beutalo',
    nyakiBlokkdisszekcio: 'beutalo',
    // kezeloorvos
    kezeleoorvos: 'kezeloorvos',
    // anamnezis
    alkoholfogyasztas: 'anamnezis',
    dohanyzasSzam: 'anamnezis',
    kezelesreErkezesIndoka: 'anamnezis',
    maxilladefektusVan: 'anamnezis',
    brownFuggolegesOsztaly: 'anamnezis',
    brownVizszintesKomponens: 'anamnezis',
    mandibuladefektusVan: 'anamnezis',
    kovacsDobakOsztaly: 'anamnezis',
    nyelvmozgásokAkadályozottak: 'anamnezis',
    gombocosBeszed: 'anamnezis',
    nyalmirigyAllapot: 'anamnezis',
    tnmStaging: 'anamnezis',
    // betegvizsgalat - fogazati státusz mezők (sok, de a legfontosabbak)
    // Note: betegvizsgalat section has many fields, we'll count all errors that don't belong to other sections
  };

  // Calculate section errors (using existing errors from useForm)
  const sectionErrors: Record<string, number> = useMemo(() => {
    const sectionErrorCounts: Record<string, number> = {};
    visibleSections.forEach(section => {
      sectionErrorCounts[section.id] = 0;
    });

    // Count errors by section
    if (errors) {
      Object.keys(errors).forEach(fieldName => {
        const sectionId = fieldToSectionMap[fieldName] || 'betegvizsgalat'; // Default to betegvizsgalat if not mapped
        if (visibleSections.some(s => s.id === sectionId)) {
          sectionErrorCounts[sectionId] = (sectionErrorCounts[sectionId] || 0) + 1;
        }
      });
    }

    return sectionErrorCounts;
  }, [visibleSections, errors, fieldToSectionMap]);

  // Scroll to first invalid field
  const scrollToFirstInvalid = useCallback(() => {
    if (!errors || Object.keys(errors).length === 0) return;

    // Find first error field
    const firstErrorField = Object.keys(errors)[0];
    const sectionId = fieldToSectionMap[firstErrorField] || 'betegvizsgalat';
    
    // First scroll to section
    const sectionElement = document.getElementById(`section-${sectionId}`);
    if (sectionElement) {
      const headerOffset = breakpoint === 'mobile' ? 100 : 150;
      const elementPosition = sectionElement.getBoundingClientRect().top;
      const offsetPosition = elementPosition + (window.scrollY || window.pageYOffset) - headerOffset;
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth',
      });
    }

    // Then scroll to field
    setTimeout(() => {
      const fieldElement = document.querySelector(`[name="${firstErrorField}"]`);
      if (fieldElement) {
        fieldElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Focus the field
        (fieldElement as HTMLElement).focus();
      }
    }, 300);
  }, [errors, fieldToSectionMap, breakpoint]);

  return (
    <div className="p-3 sm:p-6 relative pb-20 sm:pb-24">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <h3 className="text-2xl font-bold text-gray-900">
            {isViewOnly ? 'Beteg megtekintése' : patient ? 'Beteg szerkesztése' : 'Új beteg'}
          </h3>
          {patient?.id && (
            <button
              onClick={() => router.push(`/patients/${patient.id}/history`)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-purple-600 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition-colors"
              title="Változások megtekintése"
            >
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">Életút</span>
            </button>
          )}
        </div>
        <button
          onClick={handleCancel}
          className="text-gray-400 hover:text-gray-600"
          data-patient-form-cancel
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Section Navigation */}
      {visibleSections.length > 1 && (
        <PatientFormSectionNavigation
          sections={visibleSections}
          activeSectionId={activeSectionId}
          onSectionChange={setActiveSectionId}
          sectionErrors={sectionErrors}
        />
      )}

      {/* Auto-save conflict banner */}
      {showConflictBanner && 
       lastSaveErrorRef.current instanceof ApiError && 
       lastSaveErrorRef.current.status === 409 && 
       lastSaveErrorRef.current.code === 'STALE_WRITE' && (
        <div className="mb-4 bg-amber-50 border-l-4 border-amber-400 p-4 rounded-md">
          <div className="flex items-start justify-between">
            <div className="flex items-start">
              <AlertTriangle className="w-5 h-5 text-amber-600 mr-3 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-amber-800 mb-1">
                  Konfliktus észlelve
                </h4>
                <p className="text-sm text-amber-700 mb-3">
                  Másik felhasználó módosította a beteg adatait közben. Kérjük, frissítse az adatokat a legfrissebb verzió betöltéséhez.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    if (!patientId) return;
                    try {
                      const response = await fetch(`/api/patients/${patientId}`, {
                        credentials: 'include',
                      });
                      if (response.ok) {
                        const data = await response.json();
                        updateCurrentPatient(data.patient);
                        reset(data.patient);
                        lastSaveErrorRef.current = null;
                        setShowConflictBanner(false);
                        showToast('Adatok frissítve', 'success');
                      }
                    } catch (error) {
                      console.error('Error refreshing patient:', error);
                      showToast('Hiba az adatok frissítésekor', 'error');
                    }
                  }}
                  className="text-sm bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-md transition-colors"
                >
                  Adatok frissítése
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                lastSaveErrorRef.current = null;
                setShowConflictBanner(false);
              }}
              className="text-amber-600 hover:text-amber-800 ml-4"
              aria-label="Banner bezárása"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Missing Required Fields Banner */}
      {(() => {
        const missingFields = getMissingRequiredFields(currentPatient);
        if (missingFields.length === 0) return null;

        const errorFields = missingFields.filter(f => f.severity === 'error');
        const warningFields = missingFields.filter(f => f.severity === 'warning');

        return (
          <div className={`mb-4 border-l-4 p-4 rounded-md ${
            errorFields.length > 0
              ? 'bg-red-50 border-red-400'
              : 'bg-amber-50 border-amber-400'
          }`}>
            <div className="flex items-start">
              <AlertTriangle className={`w-5 h-5 mr-3 mt-0.5 flex-shrink-0 ${
                errorFields.length > 0 ? 'text-red-600' : 'text-amber-600'
              }`} />
              <div className="flex-1">
                <h4 className={`text-sm font-semibold mb-2 ${
                  errorFields.length > 0 ? 'text-red-800' : 'text-amber-800'
                }`}>
                  Hiányzó kötelező adatok ({missingFields.length})
                </h4>
                <div className="space-y-1">
                  {missingFields.map((field) => (
                    <div
                      key={field.key}
                      className="text-sm"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          // Scroll to field (simple anchor-based approach)
                          const fieldElement = document.querySelector(`[name="${field.key}"]`);
                          if (fieldElement) {
                            fieldElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            // Focus the field
                            (fieldElement as HTMLElement).focus();
                          }
                        }}
                        className={`hover:underline ${
                          field.severity === 'error' ? 'text-red-700' : 'text-amber-700'
                        }`}
                      >
                        • {field.label}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Clinical Checklist */}
      {patientId && (
        <ClinicalChecklist patient={currentPatient} patientId={patientId} />
      )}

      <form id="patient-form" onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* ALAPADATOK */}
        {shouldShowSection('alapadatok') && (
        <div id="section-alapadatok" className="card scroll-mt-20 sm:scroll-mt-24">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <User className="w-5 h-5 mr-2 text-medical-primary" />
            ALAPADATOK
            {sectionErrors['alapadatok'] > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
                {sectionErrors['alapadatok']}
              </span>
            )}
          </h4>
          <div className="space-y-4">
            <div>
              <label className={`form-label ${REQUIRED_FIELDS.some(f => f.key === 'nev') ? 'form-label-required' : ''}`}>
                NÉV
              </label>
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
              <label className={`form-label ${REQUIRED_FIELDS.some(f => f.key === 'taj') ? 'form-label-required' : ''}`}>
                TAJ
              </label>
              <input
                {...register('taj')}
                onChange={handleTAJChange}
                className={`form-input ${errors.taj ? 'border-red-500' : ''}`}
                placeholder="000-000-000"
                readOnly={isViewOnly}
              />
              {errors.taj ? (
                <p className="text-red-500 text-sm mt-1">{errors.taj.message}</p>
              ) : (
                <p className="text-gray-500 text-xs mt-1">Formátum: XXX-XXX-XXX (9 számjegy)</p>
              )}
            </div>
            <div>
              <label className="form-label">
                TELEFONSZÁM
              </label>
              <input
                {...register('telefonszam')}
                onChange={handlePhoneChange}
                className={`form-input ${errors.telefonszam ? 'border-red-500' : ''}`}
                placeholder="+36..."
                readOnly={isViewOnly}
              />
              {errors.telefonszam ? (
                <p className="text-red-500 text-sm mt-1">{errors.telefonszam.message}</p>
              ) : (
                <p className="text-gray-500 text-xs mt-1">Formátum: +36XXXXXXXXX (pl. +36123456789)</p>
              )}
            </div>
            <div>
              <label className={`form-label ${REQUIRED_FIELDS.some(f => f.key === 'email') ? 'form-label-required' : ''}`}>
                EMAIL
              </label>
              <input
                {...register('email')}
                type="email"
                className={`form-input ${errors.email ? 'border-red-500' : ''}`}
                placeholder="nev@example.com"
                readOnly={isViewOnly}
              />
              {errors.email ? (
                <p className="text-red-500 text-sm mt-1">{errors.email.message}</p>
              ) : (
                <p className="text-gray-500 text-xs mt-1">Formátum: nev@example.com</p>
              )}
            </div>
          </div>
        </div>
        )}

        {/* SZEMÉLYES ADATOK */}
        {shouldShowSection('szemelyes') && (
        <div id="section-szemelyes" className="card scroll-mt-20 sm:scroll-mt-24">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <MapPin className="w-5 h-5 mr-2 text-medical-primary" />
            SZEMÉLYES ADATOK
            {sectionErrors['szemelyes'] > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
                {sectionErrors['szemelyes']}
              </span>
            )}
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
              <label className="form-label">Halál dátuma</label>
              <DatePicker
                selected={watch('halalDatum') ? new Date(watch('halalDatum') || '') : null}
                onChange={(date: Date | null) => {
                  const formatted = date ? formatDateForInput(date.toISOString().split('T')[0]) : '';
                  setValue('halalDatum', formatted, { shouldValidate: true });
                }}
                placeholder="Válasszon dátumot"
                disabled={isViewOnly}
                maxDate={new Date()}
              />
              {errors.halalDatum && (
                <p className="text-red-500 text-sm mt-1">{errors.halalDatum.message}</p>
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
        )}

        {/* BEUTALÓ */}
        {shouldShowSection('beutalo') && (
        <div id="section-beutalo" className="card scroll-mt-20 sm:scroll-mt-24">
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
                  list="beutalo-orvos-options"
                  className="form-input"
                  placeholder="Beutaló orvos neve"
                  readOnly={isViewOnly}
                  disabled={!vanBeutalo}
                />
                <datalist id="beutalo-orvos-options">
                  {doctorOptions.map((doctor) => (
                    <option key={doctor.name} value={doctor.name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="form-label">Beutaló intézmény</label>
                <input
                  {...register('beutaloIntezmeny')}
                  list="beutalo-intezmeny-options"
                  className="form-input"
                  placeholder="Válasszon vagy írjon be új intézményt..."
                  readOnly={isViewOnly}
                  disabled={!vanBeutalo}
                />
                <datalist id="beutalo-intezmeny-options">
                  {institutionOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </div>
              <div className="md:col-span-2">
                <label className="form-label">Indokolás</label>
                <textarea
                  {...register('beutaloIndokolas')}
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
        )}

        {/* STÁDIUM */}
        {shouldShowSection('stadium') && patientId && (
        <div id="section-stadium" className="card scroll-mt-20 sm:scroll-mt-24">
          <PatientStageSection patientId={patientId} patientName={currentPatient?.nev || null} />
        </div>
        )}

        {/* ANAMNÉZIS */}
        {shouldShowSection('anamnezis') && (
        <div id="section-anamnezis" className="card scroll-mt-20 sm:scroll-mt-24">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Calendar className="w-5 h-5 mr-2 text-medical-primary" />
            ANAMNÉZIS
            {sectionErrors['anamnezis'] > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
                {sectionErrors['anamnezis']}
              </span>
            )}
          </h4>
          <div className="space-y-4">
            <div>
              <label className={`form-label ${REQUIRED_FIELDS.some(f => f.key === 'kezelesreErkezesIndoka') ? 'form-label-required' : ''}`}>
                Kezelésre érkezés indoka
              </label>
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
            {/* BNO mező - mindenkitől kérjük */}
            <div>
              <label className="form-label">BNO</label>
              <BNOAutocomplete
                value={watch('bno') || ''}
                onChange={(kod, nev) => {
                  setValue('bno', kod, { shouldDirty: true, shouldValidate: true });
                  setValue('diagnozis', nev, { shouldDirty: true, shouldValidate: true });
                }}
                placeholder="Kezdjen el gépelni a BNO kód vagy név alapján..."
                readOnly={isViewOnly}
                disabled={isViewOnly}
              />
            </div>
            {/* Diagnózis mező - mindenkitől kérjük */}
            <div>
              <label className={`form-label ${REQUIRED_FIELDS.some(f => f.key === 'diagnozis') ? 'form-label-required' : ''}`}>
                Diagnózis
              </label>
              <input
                {...register('diagnozis')}
                className="form-input"
                placeholder="Diagnózis"
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
        {shouldShowSection('betegvizsgalat') && (
        <div id="section-betegvizsgalat" className="card scroll-mt-20 sm:scroll-mt-24">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Calendar className="w-5 h-5 mr-2 text-medical-primary" />
            BETEGVIZSGÁLAT
            {sectionErrors['betegvizsgalat'] > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs font-semibold text-white bg-red-500 rounded-full">
                {sectionErrors['betegvizsgalat']}
              </span>
            )}
          </h4>
          <div className="space-y-4">
            {/* OP inline preview above dental status */}
            {patientId && (
              <OPInlinePreview patientId={patientId} patientName={currentPatient?.nev || undefined} />
            )}

            {/* Fogazati státusz */}
            <div className="border-t pt-4 mt-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <h5 className="text-base sm:text-md font-semibold text-gray-900">Felvételi státusz</h5>
                  {REQUIRED_FIELDS.some(f => f.key === 'meglevoFogak') && (
                    <span className="text-medical-error text-sm">*</span>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
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
                    className="px-4 py-2 sm:px-3 sm:py-1.5 text-sm sm:text-xs rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] sm:min-h-0"
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
                    className="px-4 py-2 sm:px-3 sm:py-1.5 text-sm sm:text-xs rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] sm:min-h-0"
                    title="Alsó állcsont összes fogát hiányzónak jelöli / visszaállítja"
                  >
                    Alsó teljes fogatlanság
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-3">Kattintás: jelen van → hiányzik → alaphelyzet. Jelen lévő fogaknál D (szuvas) vagy F (tömött) kiválasztható.</p>
              <div className="bg-gray-50 p-3 sm:p-4 rounded-lg overflow-x-auto">
                {/* Felső sor */}
                <div className="flex justify-between mb-2 min-w-[600px] sm:min-w-0">
                  <div className="flex gap-1 sm:gap-1">
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
                  <div className="flex gap-1 sm:gap-1">
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
                <div className="flex justify-between min-w-[600px] sm:min-w-0">
                  <div className="flex gap-1 sm:gap-1">
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
                  <div className="flex gap-1 sm:gap-1">
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
                  <div className="mt-4 p-3 sm:p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <h6 className="font-semibold text-gray-900 mb-2 text-sm sm:text-base">DMF-T index</h6>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 text-sm">
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
                  return state === 'present';
                });
                
                if (presentTeeth.length === 0) return null;

                const content = (
                <div className="space-y-3 sm:space-y-4 mt-4">
                    <h6 className="font-medium text-gray-700 text-sm sm:text-base">Fogak állapota</h6>
                    {presentTeeth.sort().map(toothNumber => {
                      const value = fogak[toothNumber];
                      const normalized = normalizeToothData(value);
                      const description = normalized?.description || '';
                      const status = normalized?.status;
                      
                      return (
                    <div key={toothNumber} className="border border-gray-200 rounded-md p-3 sm:p-4">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                            <label className="form-label font-medium text-sm sm:text-base">
                              {toothNumber}. fog – állapot
                            </label>
                            {!isViewOnly && (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleToothStatusSelect(toothNumber, 'D')}
                                  className={`px-3 py-2 sm:px-2 sm:py-1 text-sm sm:text-xs rounded border min-h-[44px] sm:min-h-0 ${
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
                                  className={`px-3 py-2 sm:px-2 sm:py-1 text-sm sm:text-xs rounded border min-h-[44px] sm:min-h-0 ${
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
                            className="form-input text-base sm:text-sm"
                            placeholder="Pl. korona, hídtag, gyökércsapos felépítmény, egyéb részletek"
                            readOnly={isViewOnly}
                          />
                          {/* Per-tooth treatment needs */}
                          <ToothTreatmentInline toothNumber={toothNumber} isViewOnly={isViewOnly} />
                    </div>
                      );
                    })}
                </div>
                );

                return patientId ? (
                  <ToothTreatmentProvider patientId={patientId}>
                    {content}
                  </ToothTreatmentProvider>
                ) : content;
              })()}

              {/* Export PDF button */}
              {patientId && (Object.keys(fogak).length > 0 || patient?.felsoFogpotlasVan || patient?.alsoFogpotlasVan || (patient?.meglevoImplantatumok && Object.keys(patient.meglevoImplantatumok).length > 0)) && (
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const response = await fetch(`/api/patients/${patientId}/dental-status-export`);
                        if (!response.ok) {
                          const errorData = await response.json().catch(() => ({}));
                          throw new Error(errorData.error || 'PDF generálás sikertelen');
                        }
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `fogazati-status-${patientId}.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        window.URL.revokeObjectURL(url);
                        showToast('PDF sikeresen letöltve', 'success');
                      } catch (error) {
                        console.error('Hiba a PDF exportálásakor:', error);
                        const errorMessage = error instanceof Error ? error.message : 'Hiba történt a PDF exportálásakor';
                        alert(errorMessage);
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-medical-primary text-white rounded-lg hover:bg-medical-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!patientId}
                  >
                    <Download className="w-4 h-4" />
                    <span>Fog. st. exportálása</span>
                  </button>
                </div>
              )}
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
        {shouldShowSection('betegvizsgalat') && (
        <div className="card">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <AlertTriangle className="w-5 h-5 mr-2 text-medical-primary" />
            Meglévő implantátumok, ha vannak
          </h4>
          
          {/* Zsigmondy-kereszt */}
          <div className="mb-6">
            <div className="bg-gray-50 p-3 sm:p-4 rounded-lg overflow-x-auto">
              {/* Felső sor - 1. kvadráns (bal felső) és 2. kvadráns (jobb felső) */}
              <div className="flex justify-between mb-2 min-w-[600px] sm:min-w-0">
                <div className="flex gap-1 sm:gap-1">
                  {[18, 17, 16, 15, 14, 13, 12, 11].map(tooth => {
                    const toothStr = tooth.toString();
                    const implantValue = toothStr in implantatumok
                      ? { description: implantatumok[toothStr] || '' } 
                      : undefined;
                    return (
                      <ToothCheckbox
                        key={tooth}
                        toothNumber={toothStr}
                        value={implantValue}
                        onChange={() => handleToothToggle(toothStr)}
                        disabled={isViewOnly}
                        idPrefix="implant"
                      />
                    );
                  })}
                </div>
                <div className="flex gap-1 sm:gap-1">
                  {[21, 22, 23, 24, 25, 26, 27, 28].map(tooth => {
                    const toothStr = tooth.toString();
                    const implantValue = toothStr in implantatumok
                      ? { description: implantatumok[toothStr] || '' } 
                      : undefined;
                    return (
                      <ToothCheckbox
                        key={tooth}
                        toothNumber={toothStr}
                        value={implantValue}
                        onChange={() => handleToothToggle(toothStr)}
                        disabled={isViewOnly}
                        idPrefix="implant"
                      />
                    );
                  })}
                </div>
              </div>
              
              {/* Alsó sor - 4. kvadráns (bal alsó) és 3. kvadráns (jobb alsó) */}
              <div className="flex justify-between min-w-[600px] sm:min-w-0">
                <div className="flex gap-1 sm:gap-1">
                  {[48, 47, 46, 45, 44, 43, 42, 41].map(tooth => {
                    const toothStr = tooth.toString();
                    const implantValue = toothStr in implantatumok
                      ? { description: implantatumok[toothStr] || '' } 
                      : undefined;
                    return (
                      <ToothCheckbox
                        key={tooth}
                        toothNumber={toothStr}
                        value={implantValue}
                        onChange={() => handleToothToggle(toothStr)}
                        disabled={isViewOnly}
                        idPrefix="implant"
                      />
                    );
                  })}
                </div>
                <div className="flex gap-1 sm:gap-1">
                  {[31, 32, 33, 34, 35, 36, 37, 38].map(tooth => {
                    const toothStr = tooth.toString();
                    const implantValue = toothStr in implantatumok
                      ? { description: implantatumok[toothStr] || '' } 
                      : undefined;
                    return (
                      <ToothCheckbox
                        key={tooth}
                        toothNumber={toothStr}
                        value={implantValue}
                        onChange={() => handleToothToggle(toothStr)}
                        disabled={isViewOnly}
                        idPrefix="implant"
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Implantátum részletek */}
          {Object.keys(implantatumok).length > 0 && (
            <div className="space-y-3 sm:space-y-4 mb-4">
              <h5 className="font-medium text-gray-700 mb-3 text-sm sm:text-base">Implantátum részletek</h5>
              {Object.keys(implantatumok)
                .sort()
                .map(toothNumber => (
                <div key={toothNumber} className="border border-gray-200 rounded-md p-3 sm:p-4">
                  <label className="form-label font-medium text-sm sm:text-base">
                    {toothNumber}. fog - Implantátum típusa, gyári száma, stb.
                  </label>
                  <textarea
                    value={implantatumok[toothNumber] || ''}
                    onChange={(e) => handleImplantatumDetailsChange(toothNumber, e.target.value)}
                    rows={2}
                    className="form-input text-base sm:text-sm"
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
        )}

        {/* OHIP-14 Kérdőív */}
        {shouldShowSection('ohip14') && patientId && (
        <div id="section-ohip14" className="card scroll-mt-20 sm:scroll-mt-24">
          <OHIP14Section patientId={patientId} isViewOnly={isViewOnly} />
        </div>
        )}

        {/* Documents Section */}
        {shouldShowSection('adminisztracio') && (
        <div id="section-adminisztracio" className="scroll-mt-20 sm:scroll-mt-24">
          <PatientDocuments
            patientId={patientId}
            isViewOnly={isViewOnly}
            canUpload={userRole === 'admin' || userRole === 'editor' || userRole === 'fogpótlástanász' || userRole === 'sebészorvos'}
            canDelete={userRole === 'admin'}
            onSavePatientBeforeUpload={!isViewOnly ? savePatientSilently : undefined}
            isPatientDirty={!isViewOnly && hasUnsavedChanges()}
          />
        </div>
        )}

        {/* Méltányossági kérelemhez szükséges adatok */}
        {shouldShowSection('adminisztracio') && patientId && (
          <div className="card">
            <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <FileText className="w-5 h-5 mr-2 text-medical-primary" />
              Méltányossági kérelemhez szükséges adatok
            </h4>
            <div className="space-y-4">
              {/* Kórtörténeti összefoglaló */}
              <div>
                <label className="form-label">
                  Kórtörténeti összefoglaló (3 hónapnál nem régebbi)
                </label>
                <textarea
                  {...register('kortortenetiOsszefoglalo')}
                  className="form-input min-h-[100px]"
                  placeholder="Kórtörténeti összefoglaló..."
                  readOnly={isViewOnly}
                  rows={4}
                />
                {errors.kortortenetiOsszefoglalo && (
                  <p className="text-red-500 text-sm mt-1">{errors.kortortenetiOsszefoglalo.message}</p>
                )}
              </div>

              {/* Szakorvosi vélemény */}
              <div>
                <label className="form-label">
                  Szakorvosi vélemény az eszközrendelés szükségességéről (orvosszakmai indok)
                </label>
                <textarea
                  {...register('szakorvosiVelemény')}
                  className="form-input min-h-[100px]"
                  placeholder="Szakorvosi vélemény..."
                  readOnly={isViewOnly}
                  rows={4}
                />
                {errors.szakorvosiVelemény && (
                  <p className="text-red-500 text-sm mt-1">{errors.szakorvosiVelemény.message}</p>
                )}
              </div>

              {/* Nyilatkozat */}
              <div>
                <label className="form-label">Nyilatkozat a kezelési tervben rögzített, tervezett ellátás vállalásáról</label>
                <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
                  <p className="text-gray-700">
                    {EQUITY_REQUEST_CONFIG.megbizottNeve} megbízásából alulírott, a kezelési tervben foglaltak elvégzését vállalom.
                  </p>
                </div>
              </div>

              {/* PDF generáló gomb */}
              {!isViewOnly && (
                <div className="pt-4">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!patientId) {
                        showToast('Először mentse el a beteg adatait!', 'error');
                        return;
                      }
                      
                      try {
                        showToast('PDF generálása folyamatban...', 'info');
                        const response = await fetch(`/api/patients/${patientId}/generate-equity-request-pdf`, {
                          method: 'GET',
                          credentials: 'include',
                        });

                        if (!response.ok) {
                          const errorData = await response.json();
                          throw new Error(errorData.error || 'PDF generálási hiba');
                        }

                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `Meltanyossagi_kerelm_${currentPatient?.nev || 'Beteg'}_${Date.now()}.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                        showToast('PDF sikeresen generálva és letöltve', 'success');
                      } catch (error) {
                        console.error('PDF generálási hiba:', error);
                        showToast(
                          error instanceof Error ? error.message : 'Hiba történt a PDF generálása során',
                          'error'
                        );
                      }
                    }}
                    className="btn-primary flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Méltányossági kérelem PDF generálása
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Árajánlatkérő laborba */}
        {shouldShowSection('adminisztracio') && patientId && (
          <div className="card">
            <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <FileText className="w-5 h-5 mr-2 text-medical-primary" />
              Árajánlatkérő laborba
            </h4>
            <div className="space-y-4">
              {/* Árajánlatkérők listája */}
              {labQuoteRequests.length > 0 && (
                <div className="space-y-2">
                  <label className="form-label">Mentett árajánlatkérők</label>
                  {labQuoteRequests.map((quote) => (
                    <div key={quote.id} className="bg-gray-50 p-3 rounded-md border border-gray-200 flex items-center justify-between">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">
                          {new Date(quote.datuma).toLocaleDateString('hu-HU')}
                        </div>
                        <div className="text-xs text-gray-600 mt-1 line-clamp-2">
                          {quote.szoveg.substring(0, 100)}{quote.szoveg.length > 100 ? '...' : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const response = await fetch(`/api/patients/${patientId}/generate-lab-quote-request-pdf?quoteId=${quote.id}`, {
                                method: 'GET',
                                credentials: 'include',
                              });

                              if (!response.ok) {
                                const errorData = await response.json();
                                throw new Error(errorData.error || 'PDF generálási hiba');
                              }

                              const blob = await response.blob();
                              const url = window.URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `Arajanlatkero_${currentPatient?.nev || 'Beteg'}_${Date.now()}.pdf`;
                              document.body.appendChild(a);
                              a.click();
                              window.URL.revokeObjectURL(url);
                              document.body.removeChild(a);
                              showToast('PDF sikeresen generálva és letöltve', 'success');
                            } catch (error) {
                              console.error('PDF generálási hiba:', error);
                              showToast(
                                error instanceof Error ? error.message : 'Hiba történt a PDF generálása során',
                                'error'
                              );
                            }
                          }}
                          className="btn-secondary text-xs px-3 py-1 flex items-center gap-1"
                          title="PDF generálása"
                        >
                          <Download className="w-3 h-3" />
                          PDF
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const confirmed = await confirmDialog(
                              'Biztosan elküldi az árajánlatkérőt emailben a laboratóriumnak?',
                              {
                                title: 'Email küldése',
                                confirmText: 'Igen, elküldöm',
                                cancelText: 'Mégse',
                                type: 'info'
                              }
                            );
                            if (!confirmed) return;

                            try {
                              showToast('Email küldése folyamatban...', 'info');
                              const response = await fetch(`/api/patients/${patientId}/lab-quote-requests/${quote.id}/send-email`, {
                                method: 'POST',
                                credentials: 'include',
                              });

                              if (!response.ok) {
                                const errorData = await response.json();
                                throw new Error(errorData.error || 'Email küldési hiba');
                              }

                              showToast('Email sikeresen elküldve a laboratóriumnak', 'success');
                            } catch (error) {
                              console.error('Email küldési hiba:', error);
                              showToast(
                                error instanceof Error ? error.message : 'Hiba történt az email küldése során',
                                'error'
                              );
                            }
                          }}
                          className="btn-secondary text-xs px-3 py-1 flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white"
                          title="Email küldése a laboratóriumnak"
                        >
                          <Send className="w-3 h-3" />
                          Email
                        </button>
                        {!isViewOnly && (userRole === 'admin' || userRole === 'editor') && (
                          <button
                            type="button"
                            onClick={async () => {
                              const confirmed = await confirmDialog(
                                'Biztosan törölni szeretné ezt az árajánlatkérőt?',
                                {
                                  title: 'Árajánlatkérő törlése',
                                  confirmText: 'Igen, törlöm',
                                  cancelText: 'Mégse',
                                  type: 'warning'
                                }
                              );
                              if (!confirmed) return;

                              try {
                                const response = await fetch(`/api/patients/${patientId}/lab-quote-requests/${quote.id}`, {
                                  method: 'DELETE',
                                  credentials: 'include',
                                });

                                if (!response.ok) {
                                  const errorData = await response.json();
                                  throw new Error(errorData.error || 'Törlési hiba');
                                }

                                // Újratöltjük a listát
                                const reloadResponse = await fetch(`/api/patients/${patientId}/lab-quote-requests`, {
                                  credentials: 'include',
                                });
                                if (reloadResponse.ok) {
                                  const data = await reloadResponse.json();
                                  setLabQuoteRequests(data.quoteRequests || []);
                                }
                                showToast('Árajánlatkérő sikeresen törölve', 'success');
                              } catch (error) {
                                console.error('Törlési hiba:', error);
                                showToast(
                                  error instanceof Error ? error.message : 'Hiba történt a törlés során',
                                  'error'
                                );
                              }
                            }}
                            className="btn-secondary text-xs px-3 py-1 text-red-600 hover:text-red-700"
                            title="Törlés"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Új árajánlatkérő létrehozása */}
              {!isViewOnly && (
                <div className={`${labQuoteRequests.length > 0 ? 'border-t pt-4' : ''}`}>
                  <h5 className="text-md font-semibold text-gray-900 mb-3">Új árajánlatkérő</h5>
                  <div className="space-y-4">
                    <div>
                      <label className="form-label">
                        Árajánlatkérő szöveg
                      </label>
                      <textarea
                        value={newQuoteSzoveg}
                        onChange={(e) => setNewQuoteSzoveg(e.target.value)}
                        className="form-input min-h-[150px]"
                        placeholder="Írja be az árajánlatkérő szövegét..."
                        rows={6}
                      />
                    </div>

                    <div>
                      <label className="form-label">
                        Árajánlatkérő dátuma (egy héttel az ajánlatkérés után)
                      </label>
                      <DatePicker
                        selected={newQuoteDatuma}
                        onChange={(date: Date | null) => {
                          setNewQuoteDatuma(date);
                        }}
                        placeholder="Válasszon dátumot"
                        minDate={new Date()}
                      />
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!newQuoteSzoveg.trim()) {
                            showToast('Az árajánlatkérő szöveg kötelező', 'error');
                            return;
                          }

                          if (!newQuoteDatuma) {
                            showToast('Az árajánlatkérő dátuma kötelező', 'error');
                            return;
                          }

                          try {
                            const datuma = formatDateForInput(newQuoteDatuma.toISOString().split('T')[0]);
                            const response = await fetch(`/api/patients/${patientId}/lab-quote-requests`, {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                              },
                              credentials: 'include',
                              body: JSON.stringify({
                                szoveg: newQuoteSzoveg.trim(),
                                datuma,
                              }),
                            });

                            if (!response.ok) {
                              const errorData = await response.json();
                              throw new Error(errorData.error || 'Létrehozási hiba');
                            }

                            // Újratöltjük a listát
                            const reloadResponse = await fetch(`/api/patients/${patientId}/lab-quote-requests`, {
                              credentials: 'include',
                            });
                            if (reloadResponse.ok) {
                              const data = await reloadResponse.json();
                              setLabQuoteRequests(data.quoteRequests || []);
                            }

                            // Form ürítése
                            setNewQuoteSzoveg('');
                            setNewQuoteDatuma(null);

                            showToast('Árajánlatkérő sikeresen létrehozva', 'success');
                          } catch (error) {
                            console.error('Létrehozási hiba:', error);
                            showToast(
                              error instanceof Error ? error.message : 'Hiba történt a létrehozás során',
                              'error'
                            );
                          }
                        }}
                        className="btn-primary flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Árajánlatkérő mentése
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Appointment Booking Section */}
        {/* For surgeons, always allow editing appointments even if form is view-only */}
        {shouldShowSection('idopont') && (
        <div id="section-idopont" className="scroll-mt-20 sm:scroll-mt-24">
          {activeEpisodeId && (userRole === 'admin' || userRole === 'sebészorvos' || userRole === 'fogpótlástanász') && (
            <div className="mb-4">
              <ContextBanner
                variant="info"
                title="Aktív kezelés"
                message="Aktív kezelés esetén a munkalistát használd."
                primaryLink={{ label: 'Megnyitás', href: '/?tab=worklist' }}
                dismissKey="wip-worklist-banner-dismissed"
              />
            </div>
          )}
          <AppointmentBookingSection 
            patientId={patientId} 
            episodeId={activeEpisodeId}
            pool={activeEpisodeId ? 'work' : undefined}
            isViewOnly={userRole === 'sebészorvos' ? false : isViewOnly}
            onSavePatientBeforeBooking={!isViewOnly ? savePatientForBooking : undefined}
            isPatientDirty={!isViewOnly && hasUnsavedChanges()}
            isNewPatient={isNewPatient}
            onPatientSaved={(savedPatient) => {
              updateCurrentPatient(savedPatient);
              // Also notify parent component
              onSave(savedPatient);
            }}
          />

          {/* Conditional Appointment Booking Section - Only for admins */}
          {userRole === 'admin' && patientId && (
            <ConditionalAppointmentBooking 
              patientId={patientId}
              patientEmail={currentPatient?.email || null}
            />
          )}
        </div>
        )}

        {/* Form Actions - Warning message only, buttons are in floating bar */}
        {!isViewOnly && (
          <div className="pt-6 border-t border-gray-200">
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-md">
              <div className="flex items-start">
                <AlertTriangle className="w-5 h-5 text-yellow-600 mr-3 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-semibold text-yellow-800 mb-1">
                    ⚠️ FONTOS: Ne felejtse el menteni!
                  </h4>
                  <p className="text-sm text-yellow-700">
                    Az adatok csak akkor kerülnek az adatbázisba, ha az <strong>"{patient ? 'Beteg frissítése' : 'Beteg mentése'}"</strong> gombbal menti el az űrlapot. 
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* View-only mode close button */}
        {isViewOnly && (
          <div className="pt-6 border-t border-gray-200">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleCancel}
                className="btn-secondary"
                data-patient-form-cancel
              >
                Bezárás
              </button>
            </div>
          </div>
        )}
      </form>

      {/* Manual save conflict modal */}
      {showConflictModal && conflictError && (() => {
        const details = conflictError.details && typeof conflictError.details === 'object' && 'serverUpdatedAt' in conflictError.details
          ? conflictError.details as { serverUpdatedAt?: string; clientUpdatedAt?: string }
          : null;
        
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="p-6">
                <div className="flex items-start mb-4">
                  <AlertTriangle className="w-6 h-6 text-amber-600 mr-3 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      Konfliktus észlelve
                    </h3>
                    <p className="text-sm text-gray-700 mb-4">
                      Másik felhasználó módosította a beteg adatait közben. Mit szeretne tenni?
                    </p>
                    
                    {/* Details section (collapsible) */}
                    {details && (
                      <details className="mb-4 text-xs text-gray-600">
                        <summary className="cursor-pointer hover:text-gray-800 mb-2">
                          Részletek
                        </summary>
                        <div className="pl-4 space-y-1">
                          {conflictError.correlationId && (
                            <div>
                              <strong>Correlation ID:</strong> {String(conflictError.correlationId)}
                            </div>
                          )}
                          {details.serverUpdatedAt && (
                            <div>
                              <strong>Szerver frissítve:</strong>{' '}
                              {new Date(details.serverUpdatedAt).toLocaleString('hu-HU')}
                            </div>
                          )}
                          {details.clientUpdatedAt && (
                            <div>
                              <strong>Kliens verzió:</strong>{' '}
                              {new Date(details.clientUpdatedAt).toLocaleString('hu-HU')}
                            </div>
                          )}
                        </div>
                      </details>
                    )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowConflictModal(false);
                    setConflictError(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label="Modal bezárása"
                >
                  <X className="w-5 h-5" />
                </button>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    if (!patientId) return;
                    try {
                      const response = await fetch(`/api/patients/${patientId}`, {
                        credentials: 'include',
                      });
                      if (response.ok) {
                        const data = await response.json();
                        updateCurrentPatient(data.patient);
                        reset(data.patient);
                        setShowConflictModal(false);
                        setConflictError(null);
                        showToast('Adatok frissítve', 'success');
                      } else {
                        showToast('Hiba az adatok frissítésekor', 'error');
                      }
                    } catch (error) {
                      console.error('Error refreshing patient:', error);
                      showToast('Hiba az adatok frissítésekor', 'error');
                    }
                  }}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition-colors text-sm font-medium"
                >
                  Frissítés
                </button>
                
                {/* Felülírás csak admin/editor számára */}
                {(userRole === 'admin' || userRole === 'editor') && (
                  <button
                    type="button"
                    onClick={async () => {
                      const confirmed = await confirmDialog(
                        'Biztosan felülírja a másik felhasználó módosításait? Ez a művelet nem vonható vissza.',
                        { title: 'Felülírás megerősítése', type: 'warning' }
                      );
                      if (!confirmed) return;

                      if (!patientId) return;
                      try {
                        // Felülírás: először frissítjük az adatokat (hogy megkapjuk a legfrissebb updatedAt-t),
                        // majd mentjük a jelenlegi form állapotot (ami felülírja)
                        const refreshResponse = await fetch(`/api/patients/${patientId}`, {
                          credentials: 'include',
                        });
                        if (!refreshResponse.ok) {
                          showToast('Hiba az adatok frissítésekor', 'error');
                          return;
                        }
                        const refreshData = await refreshResponse.json();
                        
                        // Most mentjük a jelenlegi form állapotot (felülírás)
                        const currentFormData = getValues();
                        const payload = buildSavePayload(
                          currentFormData,
                          fogakRef.current,
                          implantatumokRef.current,
                          vanBeutaloRef.current,
                          patientId
                        );
                        
                        // Felülírás: a legfrissebb updatedAt-tel küldjük (de a backend még mindig konfliktust dob)
                        // Ezért explicit felülírás flag kellene, de MVP-ben: if-match nélkül (backward compat)
                        // Jelenleg a backend engedi if-match nélkül, de ez nem teljesen "felülírás"
                        // TODO: Később explicit felülírás API endpoint vagy flag
                        const saved = await savePatient(payload, { source: 'manual' });
                        updateCurrentPatient(saved);
                        setShowConflictModal(false);
                        setConflictError(null);
                        showToast('Adatok felülírva', 'success');
                      } catch (error) {
                        console.error('Error overwriting patient:', error);
                        showToast('Hiba a felülírás során', 'error');
                      }
                    }}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md transition-colors text-sm font-medium"
                  >
                    Felülírás
                  </button>
                )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Sticky Submit Bar */}
      {!isViewOnly && (
        <div className="mobile-cta-bar absolute bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 px-3 sm:px-6 md:px-8">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row justify-between gap-2 sm:gap-3 py-3 sm:py-4">
            {/* Left: Next section button (mobile only if not last section) */}
            {breakpoint === 'mobile' && (() => {
              const currentActiveIndex = visibleSections.findIndex(s => s.id === activeSectionId);
              return currentActiveIndex >= 0 && currentActiveIndex < visibleSections.length - 1;
            })() && (
              <button
                type="button"
                onClick={() => {
                  const currentActiveIndex = visibleSections.findIndex(s => s.id === activeSectionId);
                  const nextSection = visibleSections[currentActiveIndex + 1];
                  if (nextSection) {
                    setActiveSectionId(nextSection.id);
                    setTimeout(() => {
                      const element = document.getElementById(`section-${nextSection.id}`);
                      if (element) {
                        const headerOffset = 100;
                        const elementPosition = element.getBoundingClientRect().top;
                        const offsetPosition = elementPosition + (window.scrollY || window.pageYOffset) - headerOffset;
                        window.scrollTo({
                          top: offsetPosition,
                          behavior: 'smooth',
                        });
                      }
                    }, 100);
                  }
                }}
                className="btn-secondary text-xs sm:text-sm px-3 sm:px-5 py-2 sm:py-2.5 mobile-touch-target w-full sm:w-auto order-2 sm:order-1"
              >
                Következő szekció →
              </button>
            )}
            
            {/* Right: Cancel and Save buttons */}
            <div className="flex gap-2 sm:gap-3 w-full sm:w-auto order-1 sm:order-2 ml-auto">
              <button
                type="button"
                onClick={handleCancel}
                className="btn-secondary text-xs sm:text-sm px-3 sm:px-5 py-2 sm:py-2.5 mobile-touch-target flex-1 sm:flex-none"
                data-patient-form-cancel
              >
                Mégse
              </button>
              <button
                type="submit"
                form="patient-form"
                className="btn-primary text-xs sm:text-sm px-3 sm:px-5 py-2 sm:py-2.5 mobile-touch-target flex-1 sm:flex-none"
              >
                {patient ? 'Beteg frissítése' : 'Beteg mentése'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
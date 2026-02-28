'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Patient, patientSchema } from '@/lib/types';
import { formatDateForInput } from '@/lib/dateUtils';
import { X, Calendar, User, MapPin, FileText, AlertTriangle, History } from 'lucide-react';
import {
  AlapadatokSection,
  SzemelyesAdatokSection,
  BeutaloSection,
  AnamnezisSection,
  BetegvizsgalatSection,
  ImplantatumokSection,
  MeltanyossagiSection,
  ArajanlatkeroSection,
  ConflictModal,
  StickySubmitBar,
  getToothState,
} from './patient-form';
import { useRouter } from 'next/navigation';
import { AppointmentBookingSection } from './AppointmentBookingSection';
import { ConditionalAppointmentBooking } from './ConditionalAppointmentBooking';
import { ContextBanner } from './ContextBanner';
import { getCurrentUser } from '@/lib/auth';
import { savePatient, ApiError } from '@/lib/storage';
import { getMissingRequiredFields, REQUIRED_FIELDS } from '@/lib/clinical-rules';
import { ClinicalChecklist } from './ClinicalChecklist';
import { usePatientAutoSave, normalizeToothData, buildSavePayload, type ToothStatus } from '@/hooks/usePatientAutoSave';
import { usePatientConflictResolution } from '@/hooks/usePatientConflictResolution';
import { PatientDocuments } from './PatientDocuments';
import { useToast } from '@/contexts/ToastContext';
import { PatientFormSectionNavigation, Section } from './mobile/PatientFormSectionNavigation';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { PatientStageSection } from './PatientStageSection';
import { OHIP14Section } from './OHIP14Section';


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
  
  // Ref for immediate access to current patient (for hasUnsavedChanges)
  const currentPatientRef = useRef<Patient | null | undefined>(patient);
  
  // Previous patient ID ref for change detection
  const previousPatientIdRef = useRef<string | null>(patient?.id || null);
  
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

  // ----- Conflict resolution hook -----
  const conflict = usePatientConflictResolution({
    patientId,
    updateCurrentPatient,
    reset,
    showToast,
  });

  // ----- Auto-save hook -----
  const {
    savingSource,
    performSave,
    fogakRef,
    implantatumokRef,
    vanBeutaloRef,
  } = usePatientAutoSave({
    patientId: patient?.id,
    currentPatientRef,
    isViewOnly,
    getValues,
    reset,
    trigger,
    formValues,
    isDirty,
    dirtyFields,
    fogak,
    implantatumok,
    vanBeutalo,
    setFogak,
    setImplantatumok,
    setVanBeutalo,
    updateCurrentPatient,
    onSave,
    showToast,
    lastSaveErrorRef: conflict.lastSaveErrorRef,
    onAutoSaveConflict: conflict.handleAutoSaveConflict,
    onManualSaveConflict: conflict.handleManualSaveConflict,
  });

  // Sync patient prop -> form + currentPatient (skip during auto-save)
  useEffect(() => {
    if (!patient || isViewOnly) {
      if (!patient && !isViewOnly) {
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

    if (previousPatientIdRef.current !== patient.id) {
      previousPatientIdRef.current = patient.id || null;
      const patientWithPreservedKezelesreErkezesIndoka = {
        ...patient,
        kezelesreErkezesIndoka: patient.kezelesreErkezesIndoka ?? currentPatientRef.current?.kezelesreErkezesIndoka ?? null,
      };
      updateCurrentPatient(patientWithPreservedKezelesreErkezesIndoka);
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

    if (savingSource && previousPatientIdRef.current === patient.id) {
      const patientWithPreservedKezelesreErkezesIndoka = {
        ...patient,
        kezelesreErkezesIndoka: patient.kezelesreErkezesIndoka ?? currentPatientRef.current?.kezelesreErkezesIndoka ?? null,
      };
      updateCurrentPatient(patientWithPreservedKezelesreErkezesIndoka);
      return;
    }

    const patientWithPreservedKezelesreErkezesIndoka = {
      ...patient,
      kezelesreErkezesIndoka: patient.kezelesreErkezesIndoka ?? currentPatientRef.current?.kezelesreErkezesIndoka ?? null,
    };
    updateCurrentPatient(patientWithPreservedKezelesreErkezesIndoka);
  }, [patient?.id, patient?.updatedAt, isViewOnly, reset, savingSource]);

  // Sync implantatumok/fogak from patient prop (skip during auto-save)
  useEffect(() => {
    if (!patient) {
      setImplantatumok({});
      setFogak({});
      return;
    }

    if (previousPatientIdRef.current !== patient.id) {
      setImplantatumok(patient.meglevoImplantatumok || {});
      setFogak((patient.meglevoFogak || {}) as Record<string, ToothStatus>);
      return;
    }

    if (savingSource && previousPatientIdRef.current === patient.id) {
      return;
    }

    if (!previousPatientIdRef.current && patient.id) {
      setImplantatumok(patient.meglevoImplantatumok || {});
      setFogak((patient.meglevoFogak || {}) as Record<string, ToothStatus>);
    }
  }, [patient?.id, patient?.updatedAt, patient?.meglevoImplantatumok, patient?.meglevoFogak, savingSource]);

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
      {conflict.showConflictBanner && 
       conflict.lastSaveErrorRef.current instanceof ApiError && 
       conflict.lastSaveErrorRef.current.status === 409 && 
       conflict.lastSaveErrorRef.current.code === 'STALE_WRITE' && (
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
                  onClick={() => conflict.refreshPatient()}
                  className="text-sm bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-md transition-colors"
                >
                  Adatok frissítése
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => conflict.dismissBanner()}
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
          <AlapadatokSection
            register={register}
            errors={errors}
            isViewOnly={isViewOnly}
            handleTAJChange={handleTAJChange}
            handlePhoneChange={handlePhoneChange}
            sectionErrors={sectionErrors}
          />
        )}

        {/* SZEMÉLYES ADATOK */}
        {shouldShowSection('szemelyes') && (
          <SzemelyesAdatokSection
            register={register}
            watch={watch}
            setValue={setValue}
            errors={errors}
            isViewOnly={isViewOnly}
            sectionErrors={sectionErrors}
          />
        )}

        {/* BEUTALÓ */}
        {shouldShowSection('beutalo') && (
          <BeutaloSection
            register={register}
            isViewOnly={isViewOnly}
            vanBeutalo={vanBeutalo}
            onVanBeutaloChange={() => setVanBeutalo((prev) => !prev)}
            doctorOptions={doctorOptions}
            institutionOptions={institutionOptions}
          />
        )}

        {/* STÁDIUM */}
        {shouldShowSection('stadium') && patientId && (
        <div id="section-stadium" className="card scroll-mt-20 sm:scroll-mt-24">
          <PatientStageSection patientId={patientId} patientName={currentPatient?.nev || null} />
        </div>
        )}

        {/* ANAMNÉZIS */}
        {shouldShowSection('anamnezis') && (
          <AnamnezisSection
            register={register}
            watch={watch}
            setValue={setValue}
            errors={errors}
            isViewOnly={isViewOnly}
            selectedIndok={selectedIndok}
            radioterapia={radioterapia}
            chemoterapia={chemoterapia}
            sectionErrors={sectionErrors}
          />
        )}

        {/* BETEGVIZSGÁLAT */}
        {shouldShowSection('betegvizsgalat') && (
          <BetegvizsgalatSection
            register={register}
            watch={watch}
            setValue={setValue}
            errors={errors}
            isViewOnly={isViewOnly}
            fogak={fogak}
            setFogak={setFogak}
            handleToothStatusToggle={handleToothStatusToggle}
            handleToothStatusSelect={handleToothStatusSelect}
            handleToothStatusDetailsChange={handleToothStatusDetailsChange}
            felsoFogpotlasVan={felsoFogpotlasVan}
            felsoFogpotlasElegedett={felsoFogpotlasElegedett}
            alsoFogpotlasVan={alsoFogpotlasVan}
            alsoFogpotlasElegedett={alsoFogpotlasElegedett}
            patientId={patientId}
            currentPatientName={currentPatient?.nev}
            patient={patient}
            showToast={showToast}
            sectionErrors={sectionErrors}
          />
        )}

        {/* MEGLÉVŐ IMPLANTÁTUMOK */}
        {shouldShowSection('betegvizsgalat') && (
          <ImplantatumokSection
            register={register}
            isViewOnly={isViewOnly}
            implantatumok={implantatumok}
            handleToothToggle={handleToothToggle}
            handleImplantatumDetailsChange={handleImplantatumDetailsChange}
            nemIsmertPoziciokbanImplantatum={nemIsmertPoziciokbanImplantatum}
          />
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
          <MeltanyossagiSection
            register={register}
            errors={errors}
            isViewOnly={isViewOnly}
            patientId={patientId}
            currentPatientName={currentPatient?.nev}
            showToast={showToast}
          />
        )}

        {/* Árajánlatkérő laborba */}
        {shouldShowSection('adminisztracio') && patientId && (
          <ArajanlatkeroSection
            isViewOnly={isViewOnly}
            patientId={patientId}
            userRole={userRole}
            labQuoteRequests={labQuoteRequests}
            setLabQuoteRequests={setLabQuoteRequests}
            newQuoteSzoveg={newQuoteSzoveg}
            setNewQuoteSzoveg={setNewQuoteSzoveg}
            newQuoteDatuma={newQuoteDatuma}
            setNewQuoteDatuma={setNewQuoteDatuma}
            currentPatientName={currentPatient?.nev}
            confirmDialog={confirmDialog}
            showToast={showToast}
          />
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
      <ConflictModal
        showConflictModal={conflict.showConflictModal}
        conflictError={conflict.conflictError}
        onDismiss={() => conflict.dismissModal()}
        onRefresh={() => conflict.refreshPatient()}
        onOverwrite={(userRole === 'admin' || userRole === 'editor') ? async () => {
          const confirmed = await confirmDialog(
            'Biztosan felülírja a másik felhasználó módosításait? Ez a művelet nem vonható vissza.',
            { title: 'Felülírás megerősítése', type: 'warning' }
          );
          if (!confirmed) return;

          if (!patientId) return;
          try {
            const refreshResponse = await fetch(`/api/patients/${patientId}`, {
              credentials: 'include',
            });
            if (!refreshResponse.ok) {
              showToast('Hiba az adatok frissítésekor', 'error');
              return;
            }
            await refreshResponse.json();
            
            const currentFormData = getValues();
            const payload = buildSavePayload(
              currentFormData,
              fogakRef.current,
              implantatumokRef.current,
              vanBeutaloRef.current,
              patientId
            );
            
            const saved = await savePatient(payload, { source: 'manual' });
            updateCurrentPatient(saved);
            conflict.dismissModal();
            showToast('Adatok felülírva', 'success');
          } catch (error) {
            console.error('Error overwriting patient:', error);
            showToast('Hiba a felülírás során', 'error');
          }
        } : null}
        userRole={userRole}
      />

      {/* Sticky Submit Bar */}
      {!isViewOnly && (
        <StickySubmitBar
          patient={patient}
          breakpoint={breakpoint}
          visibleSections={visibleSections}
          activeSectionId={activeSectionId}
          setActiveSectionId={setActiveSectionId}
          handleCancel={handleCancel}
        />
      )}
    </div>
  );
}
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ApiError } from '@/lib/storage';
import { Patient } from '@/lib/types';

interface UsePatientConflictResolutionOptions {
  patientId: string | null;
  updateCurrentPatient: (patient: Patient | null | undefined) => void;
  reset: (values?: any, options?: any) => void;
  showToast: (message: string, type: 'success' | 'error') => void;
  /**
   * A react-hook-form-on KÍVÜLI állapotok átvezetése a frissen letöltött betegből
   * (fogtérkép, implantátumok). KÖTELEZŐ megadni, ha a form ilyet kezel: a `reset()`
   * csak az RHF-mezőket írja, így nélküle az „Adatok frissítése" érvényes tokent adna
   * ELAVULT fogtérképpel — és a következő mentés pont azt a felülírást végezné el,
   * ami ellen a konfliktus-jelzés szól. (2026-08-15)
   */
  applyRefreshedPatient?: (patient: Patient) => void;
}

export interface UsePatientConflictResolutionReturn {
  conflictError: ApiError | null;
  showConflictModal: boolean;
  showConflictBanner: boolean;
  lastSaveErrorRef: React.MutableRefObject<Error | null>;

  handleAutoSaveConflict: (error: ApiError) => void;
  handleManualSaveConflict: (error: ApiError) => void;

  dismissBanner: () => void;
  dismissModal: () => void;
  refreshPatient: () => Promise<void>;
  resetConflictState: () => void;
}

export function usePatientConflictResolution(
  options: UsePatientConflictResolutionOptions
): UsePatientConflictResolutionReturn {
  const { patientId, updateCurrentPatient, reset, showToast, applyRefreshedPatient } = options;

  const [conflictError, setConflictError] = useState<ApiError | null>(null);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [showConflictBanner, setShowConflictBanner] = useState(false);
  const lastSaveErrorRef = useRef<Error | null>(null);

  useEffect(() => {
    setShowConflictBanner(false);
    setShowConflictModal(false);
    setConflictError(null);
  }, [patientId]);

  const handleAutoSaveConflict = useCallback((error: ApiError) => {
    console.warn('Auto-save conflict detected (409 STALE_WRITE):', {
      correlationId: error.correlationId,
      details: error.details,
    });
    lastSaveErrorRef.current = error;
    setShowConflictBanner(true);
  }, []);

  const handleManualSaveConflict = useCallback((error: ApiError) => {
    setConflictError(error);
    setShowConflictModal(true);
  }, []);

  const dismissBanner = useCallback(() => {
    lastSaveErrorRef.current = null;
    setShowConflictBanner(false);
  }, []);

  const dismissModal = useCallback(() => {
    setShowConflictModal(false);
    setConflictError(null);
  }, []);

  const refreshPatient = useCallback(async () => {
    if (!patientId) return;
    try {
      const response = await fetch(`/api/patients/${patientId}`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        updateCurrentPatient(data.patient);
        reset(data.patient);
        // A reset() csak az RHF-mezőket írja — a fogtérkép és az implantátumok
        // külön state-ben élnek, azokat is át kell venni, különben friss tokennel,
        // régi fogtérképpel folytatódna a szerkesztés.
        applyRefreshedPatient?.(data.patient);
        lastSaveErrorRef.current = null;
        setShowConflictBanner(false);
        setShowConflictModal(false);
        setConflictError(null);
        // Kimondjuk, hogy ez felülírja a helyi állapotot: a fogazati státusz és az
        // implantátumok is a szerver verziójára állnak, tehát a még nem mentett
        // odontogram-jelölések elvesznek. Korábban ez „Adatok frissítve" volt, és a
        // veszteség némán történt.
        showToast('Adatok frissítve a szerverről — a nem mentett odontogram-módosítások elvesztek', 'success');
      } else {
        showToast('Hiba az adatok frissítésekor', 'error');
      }
    } catch (error) {
      console.error('Error refreshing patient:', error);
      showToast('Hiba az adatok frissítésekor', 'error');
    }
  }, [patientId, updateCurrentPatient, reset, showToast, applyRefreshedPatient]);

  const resetConflictState = useCallback(() => {
    lastSaveErrorRef.current = null;
    setShowConflictBanner(false);
    setShowConflictModal(false);
    setConflictError(null);
  }, []);

  return {
    conflictError,
    showConflictModal,
    showConflictBanner,
    lastSaveErrorRef,
    handleAutoSaveConflict,
    handleManualSaveConflict,
    dismissBanner,
    dismissModal,
    refreshPatient,
    resetConflictState,
  };
}

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ApiError } from '@/lib/storage';
import { Patient } from '@/lib/types';

interface UsePatientConflictResolutionOptions {
  patientId: string | null;
  updateCurrentPatient: (patient: Patient | null | undefined) => void;
  reset: (values?: any, options?: any) => void;
  showToast: (message: string, type: 'success' | 'error') => void;
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
  const { patientId, updateCurrentPatient, reset, showToast } = options;

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
        lastSaveErrorRef.current = null;
        setShowConflictBanner(false);
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
  }, [patientId, updateCurrentPatient, reset, showToast]);

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

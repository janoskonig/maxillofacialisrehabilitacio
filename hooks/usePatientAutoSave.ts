'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { ZodType, ZodTypeDef } from 'zod';
import { Patient, patientSchema } from '@/lib/types';
import { savePatient, ApiError, TimeoutError } from '@/lib/storage';
import { logEvent } from '@/lib/event-logger';
import { formatDateForInput } from '@/lib/dateUtils';

function ensureArray<T = Record<string, unknown>>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  if (typeof val === 'string') {
    try { const parsed = JSON.parse(val); if (Array.isArray(parsed)) return parsed as T[]; } catch {}
  }
  return [];
}

let Sentry: typeof import('@sentry/nextjs') | null = null;
if (typeof window !== 'undefined' && process.env.ENABLE_SENTRY === 'true') {
  try {
    Sentry = require('@sentry/nextjs');
  } catch {
    // Sentry not available
  }
}

// ---------------------------------------------------------------------------
// Shared types & pure utilities (exported for PatientForm and other consumers)
// ---------------------------------------------------------------------------

/** Odontogram alapállapot — egy fog egy alapállapota (a `caries` ettől függetlenül rátehető). */
export type ToothBase =
  | 'sound'
  | 'missing'
  | 'filled'
  | 'crown'
  | 'root_canal'
  | 'inlay'
  | 'implant'
  | 'bridge_abutment'
  | 'bridge_pontic'
  | 'root_remnant'
  | 'impacted'
  | 'necrotic';

export type ToothConditionObject = {
  /** Régi modell — visszafelé kompatibilitásra megtartva (D=szuvas, F=tömött, M=hiányzó). */
  status?: 'D' | 'F' | 'M';
  description?: string;
  /** Új odontogram modell. */
  base?: ToothBase;
  caries?: boolean;
  periapical?: boolean;
  /** Mozgathatóság fokozata: 0–3. */
  mobility?: number;
};

export type ToothStatus = ToothConditionObject | string;

export function normalizeToothData(
  value: ToothStatus | undefined
): ToothConditionObject | null {
  if (!value) return null;
  if (typeof value === 'string') {
    if (value.trim() === '') return null;
    return { description: value };
  }
  if (typeof value === 'object' && value !== null) {
    const meaningful =
      value.status != null ||
      value.description !== undefined ||
      value.base != null ||
      value.caries === true ||
      value.periapical === true ||
      (value.mobility != null && value.mobility > 0);

    if (meaningful) return value;
    if (Object.keys(value).length === 0) return value;
    return null;
  }
  return value;
}

export function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) return 'null';
  const t = typeof obj;
  if (t !== 'object') return JSON.stringify(obj);

  if (Array.isArray(obj)) {
    return `[${obj.map(stableStringify).join(',')}]`;
  }

  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = (obj as any)[k];
    parts.push(`${JSON.stringify(k)}:${stableStringify(v === undefined ? null : v)}`);
  }
  return `{${parts.join(',')}}`;
}

export function buildSavePayload(
  formData: Patient,
  fogakData: Record<string, ToothStatus>,
  implantData: Record<string, string>,
  vanBeutaloVal: boolean,
  patientId?: string | null
): Patient {
  const normalizedFogak: Record<string, ToothConditionObject> = {};
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
    felsoFogpotlasVan: formData.felsoFogpotlasVan ?? null, // tri-state: őrizzük a „nincs adat" állapotot
    felsoFogpotlasElegedett: formData.felsoFogpotlasElegedett ?? null, // tri-state
    alsoFogpotlasVan: formData.alsoFogpotlasVan ?? null, // tri-state: őrizzük a „nincs adat" állapotot
    alsoFogpotlasElegedett: formData.alsoFogpotlasElegedett ?? null, // tri-state
    nemIsmertPoziciokbanImplantatum: formData.nemIsmertPoziciokbanImplantatum ?? false,
    maxilladefektusVan: formData.maxilladefektusVan ?? null, // tri-state
    kezelesiTervFelso: formData.kezelesiTervFelso || [],
    kezelesiTervAlso: formData.kezelesiTervAlso || [],
    kezelesiTervArcotErinto: formData.kezelesiTervArcotErinto || [],
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isRetryableError(err: any): boolean {
  if (!err) return false;
  if (err.name === 'AbortError') return false;
  if (err instanceof TimeoutError || err.name === 'TimeoutError') return true;
  if (err instanceof TypeError) return true;

  if (err instanceof ApiError || err.name === 'ApiError') {
    const status = (err as ApiError).status;
    if (status === 409 || status === 429) return false;
    return status >= 500;
  }

  if (err.name === 'ApiError' && typeof (err as any).status === 'number') {
    const status = (err as any).status;
    if (status === 409 || status === 429) return false;
    return status >= 500;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Hook interface
// ---------------------------------------------------------------------------

export interface UsePatientAutoSaveOptions {
  patientId: string | null | undefined;
  currentPatientRef: React.MutableRefObject<Patient | null | undefined>;
  isViewOnly: boolean;

  getValues: () => Patient;
  reset: (values?: any, options?: any) => void;
  trigger: () => Promise<boolean>;
  formValues: Record<string, any>;
  isDirty: boolean;
  dirtyFields: Record<string, any>;

  fogak: Record<string, ToothStatus>;
  implantatumok: Record<string, string>;
  vanBeutalo: boolean;

  setFogak: React.Dispatch<React.SetStateAction<Record<string, ToothStatus>>>;
  setImplantatumok: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setVanBeutalo: React.Dispatch<React.SetStateAction<boolean>>;
  updateCurrentPatient: (patient: Patient | null | undefined) => void;

  onSave: (patient: Patient, options?: { source: 'auto' | 'manual' }) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;

  lastSaveErrorRef: React.MutableRefObject<Error | null>;
  onAutoSaveConflict: (error: ApiError) => void;
  onManualSaveConflict: (error: ApiError) => void;

  /** Alapértelmezés: patientSchema. Gyors felvételnél: patientQuickIntakeSchema. */
  saveValidator?: ZodType<Patient, ZodTypeDef, unknown>;
}

export interface UsePatientAutoSaveReturn {
  savingSource: 'auto' | 'manual' | null;
  performSave: (
    source: 'auto' | 'manual',
    formData: Patient,
    retryCount?: number
  ) => Promise<Patient | null>;
  fogakRef: React.MutableRefObject<Record<string, ToothStatus>>;
  implantatumokRef: React.MutableRefObject<Record<string, string>>;
  vanBeutaloRef: React.MutableRefObject<boolean>;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function usePatientAutoSave(
  options: UsePatientAutoSaveOptions
): UsePatientAutoSaveReturn {
  const {
    patientId,
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
    lastSaveErrorRef,
    onAutoSaveConflict,
    onManualSaveConflict,
    saveValidator = patientSchema,
  } = options;

  // ----- State -----
  const [savingSource, setSavingSource] = useState<'auto' | 'manual' | null>(null);

  // ----- Sequencing & abort refs -----
  const saveSequenceRef = useRef(0);
  const lastSavedHashRef = useRef<string | null>(null);
  const autoSaveAbortRef = useRef<AbortController | null>(null);
  const manualSaveAbortRef = useRef<AbortController | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Telemetry / debug
  const lastSaveSourceRef = useRef<'auto' | 'manual' | null>(null);
  const lastSaveAttemptAtRef = useRef<number | null>(null);

  // ----- State mirror refs (avoid stale closures in performSave) -----
  const fogakRef = useRef(fogak);
  const implantatumokRef = useRef(implantatumok);
  const vanBeutaloRef = useRef(vanBeutalo);
  const currentPatientIdRef = useRef(currentPatientRef.current?.id);

  useEffect(() => {
    fogakRef.current = fogak;
    implantatumokRef.current = implantatumok;
    vanBeutaloRef.current = vanBeutalo;
    currentPatientIdRef.current = currentPatientRef.current?.id;
  }, [fogak, implantatumok, vanBeutalo, currentPatientRef]);

  // ----- Reset on patient change -----
  useEffect(() => {
    lastSavedHashRef.current = null;
    saveSequenceRef.current = 0;
    lastSaveSourceRef.current = null;
    lastSaveErrorRef.current = null;
  }, [patientId, lastSaveErrorRef]);

  // Serializes ALL saves so a new one never starts before the previous has
  // fully settled. Without this, two overlapping saves (e.g. typing a beutaló
  // orvos név that triggers the auto-fill setValue('beutaloIntezmeny')) both
  // read the same `updatedAt` from currentPatientRef and send the same
  // If-Match: the first commits → server bumps updated_at → the second hits a
  // self-inflicted 409 STALE_WRITE. Chaining guarantees each save reads the
  // fresh updatedAt the previous save wrote back via updateCurrentPatient().
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());

  // ----- Unified save function -----
  const performSaveInner = useCallback(
    async (
      source: 'auto' | 'manual',
      formData: Patient,
      retryCount = 0
    ): Promise<Patient | null> => {
      // Manual aborts any in-flight auto-save
      if (source === 'manual' && autoSaveAbortRef.current) {
        autoSaveAbortRef.current.abort();
        autoSaveAbortRef.current = null;
      }

      const abortRef = source === 'auto' ? autoSaveAbortRef : manualSaveAbortRef;

      // Cancel previous same-source request
      if (abortRef.current) abortRef.current.abort();

      const controller = new AbortController();
      abortRef.current = controller;

      const seq = ++saveSequenceRef.current;

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

        const parsed = saveValidator.safeParse(payload);
        if (!parsed.success) {
          await trigger();
          if (source === 'auto') return null;
          const msg = parsed.error.errors
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join('; ');
          throw new Error(`Validációs hibák: ${msg}`);
        }

        const validatedPayload = parsed.data;

        // Hash-based skip for auto-save only
        if (source === 'auto') {
          const hash = stableStringify(validatedPayload);
          if (lastSavedHashRef.current === hash) return null;
        }

        const payloadWithUpdatedAt = {
          ...validatedPayload,
          updatedAt:
            currentPatientRef.current?.updatedAt || validatedPayload.updatedAt,
        };

        const saved = await savePatient(payloadWithUpdatedAt, {
          signal: controller.signal,
          source,
        });

        // Stale response guard
        if (seq !== saveSequenceRef.current) {
          console.log(`Save (${source}): outdated response, ignoring`);
          return null;
        }

        // Update state
        updateCurrentPatient(saved);
        // Csak BEkapcsoljuk a „Van beutaló?" togglet, ha mentett adat van —
        // soha nem kapcsoljuk KI automatikusan, különben egy üres mezővel
        // lefutó mentés összecsukná a szekciót, és a felhasználó épp begépelt
        // értéke eltűnne. A kikapcsolás csak kézi (onVanBeutaloChange) lehet.
        setVanBeutalo(prev => prev || !!(saved.beutaloOrvos || saved.beutaloIntezmeny));
        if (saved.meglevoImplantatumok) setImplantatumok(saved.meglevoImplantatumok);
        if (saved.meglevoFogak)
          setFogak(saved.meglevoFogak as Record<string, ToothStatus>);

        // Update hash
        lastSavedHashRef.current = stableStringify(validatedPayload);
        lastSaveSourceRef.current = source;

        // Telemetry
        const durationMs = Date.now() - startTime;
        const successEventType =
          source === 'auto' ? 'autosave_success' : 'manualsave_success';
        logEvent(successEventType, {
          source,
          durationMs,
          patientId: currentPatientIdRef.current || undefined,
        });

        onSave(saved, { source });

        // Manual save: reset form dirty state
        if (source === 'manual') {
          const resetData = {
            ...saved,
            szuletesiDatum: formatDateForInput(saved.szuletesiDatum),
            mutetIdeje: formatDateForInput(saved.mutetIdeje),
            felvetelDatuma: formatDateForInput(saved.felvetelDatuma),
            kezelesiTervFelso:
              ensureArray(saved.kezelesiTervFelso).map((item) => ({
                ...item,
                tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma as string | null | undefined),
              })),
            kezelesiTervAlso:
              ensureArray(saved.kezelesiTervAlso).map((item) => ({
                ...item,
                tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma as string | null | undefined),
              })),
            kezelesiTervArcotErinto:
              ensureArray(saved.kezelesiTervArcotErinto).map((item) => ({
                ...item,
                tervezettAtadasDatuma: formatDateForInput(item.tervezettAtadasDatuma as string | null | undefined),
              })),
          };
          reset(resetData, { keepDirty: false, keepDefaultValues: false });
        }

        return saved;
      } catch (err: any) {
        if (err?.name === 'AbortError' || controller.signal.aborted) return null;

        // 409 Conflict (STALE_WRITE)
        if (
          err instanceof ApiError &&
          err.status === 409 &&
          err.code === 'STALE_WRITE'
        ) {
          const durationMs = Date.now() - startTime;
          const failEventType =
            source === 'auto' ? 'autosave_fail' : 'manualsave_fail';
          logEvent(
            failEventType,
            {
              source,
              durationMs,
              status: err.status,
              errorName: err.name,
              code: err.code,
              patientId: currentPatientIdRef.current || undefined,
            },
            err.correlationId
          );

          if (source === 'auto') {
            onAutoSaveConflict(err);
            return null;
          } else {
            onManualSaveConflict(err);
            throw err;
          }
        }

        // Retry logic
        if (retryCount < 2 && isRetryableError(err)) {
          const delay = 1000 * (retryCount + 1);
          console.warn(
            `Save (${source}) failed, retrying (${retryCount + 1}/2) after ${delay}ms...`,
            err
          );
          await new Promise((r) => setTimeout(r, delay));

          if (source === 'auto') {
            return performSaveInner('auto', getValues(), retryCount + 1);
          }
          return performSaveInner('manual', formData, retryCount + 1);
        }

        // Final failure telemetry
        const durationMs = Date.now() - startTime;
        const failEventType =
          source === 'auto' ? 'autosave_fail' : 'manualsave_fail';
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

        // Sentry: skip expected client failures (4xx ApiError); capture everything else
        if (
          Sentry &&
          !(err instanceof ApiError && err.status >= 400 && err.status < 500)
        ) {
          if (err instanceof ApiError && err.correlationId) {
            Sentry.setTag('correlation_id', err.correlationId);
          }
          Sentry.captureException(
            err instanceof Error ? err : new Error(String(err)),
          );
        }

        if (source === 'manual') {
          showToast(
            `Hiba a mentés során: ${err?.message || 'Ismeretlen hiba'}`,
            'error'
          );
          throw err;
        }

        console.error('Auto-save failed:', err);
        lastSaveErrorRef.current = err;
        return null;
      } finally {
        setSavingSource(null);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [
      currentPatientRef,
      getValues,
      lastSaveErrorRef,
      onAutoSaveConflict,
      onManualSaveConflict,
      onSave,
      reset,
      saveValidator,
      setFogak,
      setImplantatumok,
      setVanBeutalo,
      showToast,
      trigger,
      updateCurrentPatient,
    ]
  );

  // Public entry point. Every save (auto AND manual) is chained one-after-
  // another so each reads the freshest `updatedAt` and can never collide with
  // its predecessor. A manual save additionally aborts any in-flight auto-save
  // up front so the chain drains immediately (the user shouldn't wait on a
  // background autosave).
  const performSave = useCallback(
    (
      source: 'auto' | 'manual',
      formData: Patient,
      retryCount = 0
    ): Promise<Patient | null> => {
      if (source === 'manual' && autoSaveAbortRef.current) {
        autoSaveAbortRef.current.abort();
        autoSaveAbortRef.current = null;
      }
      const next = saveChainRef.current
        .catch(() => {})
        .then(() => performSaveInner(source, formData, retryCount));
      saveChainRef.current = next.catch(() => {});
      return next;
    },
    [performSaveInner]
  );

  // ----- Auto-save debounce effect -----

  const dirtyTopKeys = useMemo(() => {
    if (!isDirty) return [];
    return Object.keys(dirtyFields).filter((k) => !!(dirtyFields as any)[k]);
  }, [isDirty, dirtyFields]);

  const dirtyHash = useMemo(() => {
    if (!isDirty) return null;
    const snap: any = {};
    for (const k of dirtyTopKeys) snap[k] = (formValues as any)[k];
    return stableStringify(snap);
  }, [isDirty, dirtyTopKeys, formValues]);

  useEffect(() => {
    if (isViewOnly) return;
    if (!patientId) return;
    if (!isDirty) return;
    if (!dirtyHash) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(() => {
      performSave('auto', getValues()).catch(() => {
        // Errors handled in performSave
      });
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [patientId, dirtyHash, fogak, implantatumok, vanBeutalo, isViewOnly, isDirty, performSave, getValues]);

  // ----- Cleanup on unmount -----
  useEffect(() => {
    return () => {
      if (autoSaveAbortRef.current) autoSaveAbortRef.current.abort();
      if (manualSaveAbortRef.current) manualSaveAbortRef.current.abort();
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  return {
    savingSource,
    performSave,
    fogakRef,
    implantatumokRef,
    vanBeutaloRef,
  };
}

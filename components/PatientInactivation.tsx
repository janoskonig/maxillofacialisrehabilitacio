'use client';

import { useCallback, useEffect, useState } from 'react';
import { Archive, ArchiveRestore, X } from 'lucide-react';
import {
  PATIENT_INACTIVATION_REASONS,
  PATIENT_INACTIVATION_REASON_LABELS,
  inactivationNoteRequired,
  type PatientInactivationReason,
  type PatientInactivationState,
} from '@/lib/patient-inactivation-reasons';

/**
 * Beteg inaktiválása (117): állapot-hook + karton-fejléc gomb + banner.
 * Az inaktív beteg kimarad a listákból és az automatikus emlékeztetőkből,
 * de a kartonja megnyitható és újraaktiválható.
 */
export function usePatientInactivation(patientId: string | null | undefined) {
  const [state, setState] = useState<PatientInactivationState | null>(null);

  const reload = useCallback(async () => {
    if (!patientId) return;
    try {
      const res = await fetch(`/api/patients/${patientId}/inactivation`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setState(data.inactivation ?? null);
    } catch {
      // A karton e nélkül is használható; csendben elengedjük.
    }
  }, [patientId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { state, setState, reload };
}

async function callInactivationApi(
  patientId: string,
  method: 'POST' | 'DELETE',
  body?: { reason: PatientInactivationReason; note: string },
): Promise<PatientInactivationState> {
  const res = await fetch(`/api/patients/${patientId}/inactivation`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'A művelet nem sikerült');
  }
  return data.inactivation as PatientInactivationState;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Fejléc-akció: „Inaktiválás" gomb + dialógus (csak aktív betegnél látszik). */
export function PatientInactivateButton({
  patientId,
  patientName,
  state,
  onChanged,
}: {
  patientId: string;
  patientName?: string | null;
  state: PatientInactivationState | null;
  onChanged: (next: PatientInactivationState) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!state || state.inaktivalvaAt) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 text-sm"
        title="A beteg inaktiválása (pl. nem célcsoport)"
      >
        <Archive className="w-4 h-4" />
        <span className="hidden sm:inline">Inaktiválás</span>
      </button>
      {open && (
        <PatientInactivateDialog
          patientId={patientId}
          patientName={patientName}
          futureAppointmentCount={state.futureAppointmentCount}
          onClose={() => setOpen(false)}
          onDone={(next) => {
            setOpen(false);
            onChanged(next);
          }}
        />
      )}
    </>
  );
}

function PatientInactivateDialog({
  patientId,
  patientName,
  futureAppointmentCount,
  onClose,
  onDone,
}: {
  patientId: string;
  patientName?: string | null;
  futureAppointmentCount: number;
  onClose: () => void;
  onDone: (next: PatientInactivationState) => void;
}) {
  const [reason, setReason] = useState<PatientInactivationReason>('nem_celcsoport');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteRequired = inactivationNoteRequired(reason);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const submit = async () => {
    if (noteRequired && !note.trim()) {
      setError('Egyéb ok esetén a megjegyzés kötelező.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      onDone(await callInactivationApi(patientId, 'POST', { reason, note }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'A művelet nem sikerült');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="patient-inactivate-title"
    >
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h2
            id="patient-inactivate-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2"
          >
            <Archive className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            Beteg inaktiválása
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1"
            aria-label="Bezárás"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-sm text-gray-700 dark:text-gray-300">
          <p>
            {patientName ? <strong>{patientName}</strong> : 'A beteg'} kikerül a beteglistából, a
            munkalistákból és a stádium-nézetekből, és nem kap több automatikus emlékeztetőt. Az adatai
            megmaradnak, a karton linkkel megnyitható, és bármikor újraaktiválható.
          </p>

          {futureAppointmentCount > 0 && (
            <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-amber-900 dark:text-amber-200">
              A betegnek <strong>{futureAppointmentCount}</strong> jövőbeli időpontja van. Az inaktiválás
              ezeket nem mondja le — ha nem kellenek, előbb mondd le őket.
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="font-medium text-gray-900 dark:text-gray-100 mb-1">Ok</legend>
            {PATIENT_INACTIVATION_REASONS.map((value) => (
              <label key={value} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="inactivation-reason"
                  value={value}
                  checked={reason === value}
                  onChange={() => setReason(value)}
                  className="mt-0.5"
                />
                <span>{PATIENT_INACTIVATION_REASON_LABELS[value]}</span>
              </label>
            ))}
          </fieldset>

          <label className="block">
            <span className="font-medium text-gray-900 dark:text-gray-100">
              Megjegyzés{noteRequired ? ' (kötelező)' : ' (nem kötelező)'}
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              rows={3}
              className="form-input w-full mt-1"
              placeholder="Pl. hová irányítottuk, ki döntött róla…"
            />
          </label>

          {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
          <button type="button" onClick={onClose} disabled={submitting} className="btn-secondary">
            Mégse
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="btn-primary disabled:opacity-50"
          >
            {submitting ? 'Mentés…' : 'Inaktiválás'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Karton-banner inaktív betegnél, újraaktiválás gombbal. */
export function PatientInactiveBanner({
  patientId,
  state,
  canManage,
  onChanged,
}: {
  patientId: string;
  state: PatientInactivationState | null;
  canManage: boolean;
  onChanged: (next: PatientInactivationState) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state?.inaktivalvaAt) return null;

  const reactivate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      onChanged(await callInactivationApi(patientId, 'DELETE'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'A művelet nem sikerült');
    } finally {
      setSubmitting(false);
    }
  };

  const reasonLabel = state.inaktivalasOka
    ? PATIENT_INACTIVATION_REASON_LABELS[state.inaktivalasOka]
    : 'ismeretlen ok';

  return (
    <div
      role="status"
      className="mb-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/70 px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200"
    >
      <Archive className="hidden sm:block w-5 h-5 shrink-0 text-gray-500 dark:text-gray-400" />
      <div className="flex-1 min-w-0">
        <p>
          <strong>Inaktív beteg</strong> — {reasonLabel}
          <span className="text-gray-500 dark:text-gray-400">
            {' · '}
            {formatDate(state.inaktivalvaAt)}
            {state.inaktivaltaNev ? `, ${state.inaktivaltaNev}` : ''}
          </span>
        </p>
        {state.inaktivalasMegjegyzes && (
          <p className="mt-0.5 text-gray-600 dark:text-gray-400 break-words">{state.inaktivalasMegjegyzes}</p>
        )}
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          Nem szerepel a listákban, és nem kap automatikus emlékeztetőt.
        </p>
        {error && <p className="mt-1 text-red-600 dark:text-red-400">{error}</p>}
      </div>
      {canManage && (
        <button
          type="button"
          onClick={reactivate}
          disabled={submitting}
          className="btn-secondary inline-flex items-center gap-1.5 text-sm px-3 py-1.5 self-start sm:self-auto disabled:opacity-50"
        >
          <ArchiveRestore className="w-4 h-4" />
          {submitting ? 'Folyamatban…' : 'Újraaktiválás'}
        </button>
      )}
    </div>
  );
}

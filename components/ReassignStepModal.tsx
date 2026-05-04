'use client';

/**
 * ReassignStepModal — egy meglévő jövőbeli foglalás áthelyezése az epizód
 * egy MÁSIK pending munkafázisára. Az időpont (slot) nem változik, csak a
 * fázis-hovatartozás (step_code, step_seq, work_phase_id).
 *
 * Óvatos művelet: a felhasználónak ki kell választania egy célfázist,
 * meg kell adnia egy minimum-hosszúságú indoklást, és egy explicit
 * megerősítést kell kattintania. A modal NEM hív API-t közvetlenül —
 * a szülő (PatientWorklistWidget) az `onConfirm` callback-en keresztül
 * küldi a PATCH kérést.
 */

import { useEffect, useMemo, useState } from 'react';
import { Shuffle, X, AlertTriangle } from 'lucide-react';
import type { WorklistItemBackend } from '@/lib/worklist-types';

const MIN_REASON_LENGTH = 5;

export interface ReassignStepCandidate {
  workPhaseId: string;
  stepCode: string;
  stepLabel: string;
  pool: string;
  windowStart: string | null;
  windowEnd: string | null;
  stepSeq: number | null;
  bookableWindowStart: string | null;
  bookableWindowEnd: string | null;
  /**
   * Cél fázis aktuális státusza. Ha `completed`, az átrendezés csak az
   * `appointment_id` snapshot-ot frissíti, a fázis tényállapotát NEM
   * változtatja meg. A modal ezt jelzi a felhasználónak.
   */
  status?: 'completed' | 'scheduled' | 'pending' | 'skipped' | null;
}

export interface ReassignStepPayload {
  targetWorkPhaseId: string;
  reason: string;
}

export interface ReassignStepModalProps {
  open: boolean;
  onClose: () => void;
  /** Az éppen BOOKED worklist sor — innen jön a cím / fejléc / pool ellenőrzés. */
  sourceItem: WorklistItemBackend;
  /** A jelölhető cél fázisok (ugyanaz az epizód, ugyanaz a pool, nincs BOOKED foglalása). */
  candidates: ReassignStepCandidate[];
  onConfirm: (payload: ReassignStepPayload) => Promise<void> | void;
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return '–';
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('hu-HU', {
      month: 'short',
      day: 'numeric',
    });
  if (start && end) {
    const a = fmt(start);
    const b = fmt(end);
    return a === b ? a : `${a} – ${b}`;
  }
  return fmt(start ?? (end as string));
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('hu-HU', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ReassignStepModal({
  open,
  onClose,
  sourceItem,
  candidates,
  onConfirm,
}: ReassignStepModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setReason('');
    setSubmitError(null);
    setSubmitting(false);
  }, [open]);

  const filteredCandidates = useMemo(
    () =>
      candidates.filter(
        (c) => c.workPhaseId && c.workPhaseId !== sourceItem.workPhaseId
      ),
    [candidates, sourceItem.workPhaseId]
  );

  if (!open) return null;

  const trimmedReason = reason.trim();
  const reasonValid = trimmedReason.length >= MIN_REASON_LENGTH;
  const canSubmit =
    !!selectedId && reasonValid && !submitting && filteredCandidates.length > 0;

  const handleConfirm = async () => {
    if (!canSubmit || !selectedId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirm({ targetWorkPhaseId: selectedId, reason: trimmedReason });
      onClose();
    } catch (e) {
      setSubmitError(
        e instanceof Error ? e.message : 'Hiba történt — próbáld újra.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const currentLabel =
    sourceItem.stepLabel ?? sourceItem.nextStep ?? sourceItem.stepCode ?? 'Munkafázis';
  const bookedStart = sourceItem.bookedAppointmentStartTime ?? null;
  const isPastBooking = !!bookedStart && new Date(bookedStart) <= new Date();

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reassign-step-title"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2
            id="reassign-step-title"
            className="text-lg font-semibold text-gray-900 flex items-center gap-2"
          >
            <Shuffle className="w-5 h-5 text-medical-primary" />
            Foglalás áthelyezése másik fázisra
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 p-1"
            aria-label="Bezárás"
            type="button"
            disabled={submitting}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-sm text-gray-700 bg-amber-50 border border-amber-200 p-3 rounded flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-amber-900">
                {isPastBooking
                  ? 'Múltbeli snapshot-rögzítés javítása'
                  : 'Óvatos adatmozgatás'}
              </div>
              <div className="text-xs text-amber-900/80 mt-1">
                {isPastBooking ? (
                  <>
                    Az időpont (slot) nem változik, csak a fázis-hovatartozás
                    (<code>step_code</code> / <code>step_seq</code> /
                    <code> work_phase_id</code> snapshot). A cél fázis
                    tényállapota nem változik (<code>completed</code> az
                    is marad), csak az <code>appointment_id</code> link
                    frissül.
                  </>
                ) : (
                  <>
                    Az időpont (slot) nem változik, csak a fázis-hovatartozás.
                    A régi fázis visszaáll <code>pending</code>-re, a cél
                    fázis <code>scheduled</code>-re.
                  </>
                )}{' '}
                Az összes lépés auditálva lesz az
                {' '}<code>episode_work_phase_audit</code> táblában, és a
                művelet aktivitás-naplóba is bekerül.
              </div>
            </div>
          </div>

          <div className="text-sm text-gray-700 bg-gray-50 border border-gray-200 p-3 rounded space-y-1">
            <div className="flex justify-between gap-2">
              <span className="text-xs text-gray-500">Jelenlegi fázis</span>
              <span className="text-xs text-gray-500">
                pool: <code>{sourceItem.pool}</code>
              </span>
            </div>
            <div className="font-medium text-gray-900">{currentLabel}</div>
            <div className="text-xs text-gray-600">
              Időpont: <strong>{formatDateTime(bookedStart)}</strong>
            </div>
          </div>

          <div>
            <div className="text-sm font-medium text-gray-700 mb-2">
              Cél fázis
              <span className="text-xs text-gray-500 font-normal ml-1">
                (azonos pool, még nincs foglalása)
              </span>
            </div>
            {filteredCandidates.length === 0 ? (
              <div className="text-sm text-gray-500 italic bg-gray-50 border border-gray-200 rounded p-3">
                Nincs olyan másik munkafázis ebben az epizódban, ami
                jelöltnek számít (azonos <code>pool</code>, nincs
                BOOKED‑állapotban, nem completed/skipped).
              </div>
            ) : (
              <div className="border border-gray-200 rounded divide-y divide-gray-100 max-h-64 overflow-y-auto">
                {filteredCandidates.map((c) => {
                  const isSelected = selectedId === c.workPhaseId;
                  const windowStart =
                    c.bookableWindowStart ?? c.windowStart;
                  const windowEnd = c.bookableWindowEnd ?? c.windowEnd;
                  return (
                    <label
                      key={c.workPhaseId}
                      className={`flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 ${
                        isSelected ? 'bg-medical-primary/5' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="reassign-target"
                        className="mt-1"
                        checked={isSelected}
                        onChange={() => setSelectedId(c.workPhaseId)}
                        disabled={submitting}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-900 font-medium flex items-center gap-1.5">
                          <span>{c.stepLabel || c.stepCode}</span>
                          {c.status && (
                            <span
                              className={`text-[10px] px-1 py-0.5 rounded font-medium ${
                                c.status === 'completed'
                                  ? 'bg-green-100 text-green-800'
                                  : c.status === 'scheduled'
                                    ? 'bg-blue-100 text-blue-800'
                                    : c.status === 'skipped'
                                      ? 'bg-gray-200 text-gray-700'
                                      : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {c.status === 'completed'
                                ? 'KÉSZ'
                                : c.status === 'scheduled'
                                  ? 'FOGLALT'
                                  : c.status === 'skipped'
                                    ? 'KIHAGYVA'
                                    : 'PENDING'}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-600 truncate">
                          {windowStart || windowEnd ? (
                            <>
                              Terv szerinti ablak:{' '}
                              <strong>
                                {formatDateRange(windowStart, windowEnd)}
                              </strong>
                            </>
                          ) : (
                            <span className="italic text-gray-500">
                              {c.status === 'completed'
                                ? 'Lezárt fázis'
                                : 'Nincs ablak'}
                            </span>
                          )}
                          {c.stepSeq != null && (
                            <span className="ml-1 text-gray-500">
                              · seq {c.stepSeq}
                            </span>
                          )}
                        </div>
                        {c.status === 'completed' && (
                          <div className="text-xs text-blue-700 mt-0.5">
                            ℹ Lezárt fázis — az átrendezés csak az
                            <code className="mx-0.5">appointment_id</code>
                            snapshot-ot frissíti, a fázis státusza nem változik.
                          </div>
                        )}
                        {bookedStart &&
                          windowStart &&
                          windowEnd &&
                          c.status !== 'completed' &&
                          (new Date(bookedStart) < new Date(windowStart) ||
                            new Date(bookedStart) > new Date(windowEnd)) && (
                            <div className="text-xs text-amber-700 mt-0.5">
                              ⚠ A foglalás időpontja kívül esik a fázis
                              tervezett ablakán — az átrendezés engedélyezett,
                              de fontolja meg.
                            </div>
                          )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="reassign-reason"
              className="text-sm font-medium text-gray-700"
            >
              Indoklás{' '}
              <span className="text-xs text-gray-500 font-normal">
                (kötelező, min. {MIN_REASON_LENGTH} karakter)
              </span>
            </label>
            <textarea
              id="reassign-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              disabled={submitting}
              className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-medical-primary/30"
              placeholder="Pl. a foglalás valójában Kontroll 2-re vonatkozik, nem Kontroll 3-ra."
            />
          </div>

          {submitError && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 p-2 rounded">
              {submitError}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50"
          >
            Mégse
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="px-3 py-1.5 text-sm bg-medical-primary text-white rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Átrendezés…' : 'Átrendezés megerősítése'}
          </button>
        </div>
      </div>
    </div>
  );
}

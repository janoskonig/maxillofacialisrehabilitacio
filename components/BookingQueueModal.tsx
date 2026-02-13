'use client';

import { useState, useCallback, useEffect } from 'react';
import { X, SkipForward, Square } from 'lucide-react';
import type { WorklistItemBackend } from '@/lib/worklist-types';
import { SlotPickerModal } from './SlotPickerModal';
import { OverrideModal } from './OverrideModal';

export type BatchQueueState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'ABORTED';

export interface BookingQueueModalProps {
  open: boolean;
  onClose: () => void;
  /** Queue items (READY only) */
  items: WorklistItemBackend[];
  /** Called when batch completes (success, skip, or abort) */
  onBatchComplete: (bookedKeys: string[], skippedKeys: string[]) => void;
  /** Book single item – returns { success }, { skip }, or { needsOverride } for 409 ONE_HARD_NEXT */
  onBookItem: (
    item: WorklistItemBackend,
    slotId: string,
    overrideReason?: string
  ) => Promise<
    | { success: boolean }
    | { skip: boolean }
    | { needsOverride: { error: string; overrideHint?: string; expectedHardNext?: unknown; existingAppointment?: unknown } }
  >;
  /** Get worklist item key */
  getItemKey: (item: WorklistItemBackend) => string;
}

export function BookingQueueModal({
  open,
  onClose,
  items,
  onBatchComplete,
  onBookItem,
  getItemKey,
}: BookingQueueModalProps) {
  const [queue, setQueue] = useState<WorklistItemBackend[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [batchState, setBatchState] = useState<BatchQueueState>('IDLE');
  const [bookedKeys, setBookedKeys] = useState<string[]>([]);
  const [skippedKeys, setSkippedKeys] = useState<string[]>([]);
  const [overridePayload, setOverridePayload] = useState<{
    error: string;
    overrideHint?: string;
    expectedHardNext?: { stepCode: string; earliestStart: string; latestStart: string; durationMinutes: number };
    existingAppointment?: { id: string; startTime: string; providerName?: string };
    item: WorklistItemBackend;
    slotId: string;
  } | null>(null);
  const [slotPickerItem, setSlotPickerItem] = useState<WorklistItemBackend | null>(null);
  const [pauseError, setPauseError] = useState<string | null>(null);

  const totalCount = queue.length;
  const doneCount = bookedKeys.length + skippedKeys.length;
  const currentItem = queue[currentIndex] ?? null;

  const handleStart = useCallback(() => {
    if (items.length === 0) return;
    setQueue([...items]);
    setCurrentIndex(0);
    setBatchState('RUNNING');
    setBookedKeys([]);
    setSkippedKeys([]);
    setOverridePayload(null);
    setPauseError(null);
    setSlotPickerItem(items[0] ?? null);
  }, [items]);

  const handleClose = useCallback(() => {
    if (batchState === 'RUNNING' || batchState === 'PAUSED') {
      setBatchState('ABORTED');
      onBatchComplete(bookedKeys, [...skippedKeys, ...queue.slice(currentIndex).map(getItemKey)]);
    }
    setSlotPickerItem(null);
    setOverridePayload(null);
    onClose();
  }, [batchState, bookedKeys, skippedKeys, queue, currentIndex, getItemKey, onBatchComplete, onClose]);

  const handleSlotSelect = useCallback(
    async (slotId: string) => {
      if (!currentItem) return;
      const key = getItemKey(currentItem);
      try {
        const result = await onBookItem(currentItem, slotId);
        if ('success' in result && result.success) {
          setBookedKeys((prev) => [...prev, key]);
          setSlotPickerItem(null);
          const nextIdx = currentIndex + 1;
          if (nextIdx >= queue.length) {
            setBatchState('COMPLETED');
            onBatchComplete([...bookedKeys, key], skippedKeys);
            onClose();
          } else {
            setCurrentIndex(nextIdx);
            setSlotPickerItem(queue[nextIdx] ?? null);
          }
        } else if ('skip' in result && result.skip) {
          setSkippedKeys((prev) => [...prev, key]);
          setSlotPickerItem(null);
          const nextIdx = currentIndex + 1;
          if (nextIdx >= queue.length) {
            setBatchState('COMPLETED');
            onBatchComplete(bookedKeys, [...skippedKeys, key]);
            onClose();
          } else {
            setCurrentIndex(nextIdx);
            setSlotPickerItem(queue[nextIdx] ?? null);
          }
        } else if ('needsOverride' in result && result.needsOverride) {
          const no = result.needsOverride;
          setOverridePayload({
            error: no.error,
            overrideHint: no.overrideHint,
            expectedHardNext: no.expectedHardNext as { stepCode: string; earliestStart: string; latestStart: string; durationMinutes: number } | undefined,
            existingAppointment: no.existingAppointment as { id: string; startTime: string; providerName?: string } | undefined,
            item: currentItem,
            slotId,
          });
          setSlotPickerItem(null);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Hiba történt';
        if (msg.includes('500') || msg.includes('Szerver hiba') || msg.includes('timeout')) {
          setBatchState('PAUSED');
          setPauseError(msg);
          setSlotPickerItem(null);
        } else {
          setSlotPickerItem(null);
          throw e;
        }
      }
    },
    [currentItem, currentIndex, queue, bookedKeys, skippedKeys, getItemKey, onBookItem, onBatchComplete, onClose]
  );

  const handleOverrideConfirm = useCallback(
    async (overrideReason: string) => {
      if (!overridePayload) return;
      const { item, slotId } = overridePayload;
      try {
        const result = await onBookItem(item, slotId, overrideReason);
        if ('success' in result && result.success) {
          const key = getItemKey(item);
          setBookedKeys((prev) => [...prev, key]);
          setOverridePayload(null);
          const nextIdx = currentIndex + 1;
          if (nextIdx >= queue.length) {
            setBatchState('COMPLETED');
            onBatchComplete([...bookedKeys, key], skippedKeys);
            onClose();
          } else {
            setCurrentIndex(nextIdx);
            setSlotPickerItem(queue[nextIdx] ?? null);
          }
        }
      } catch {
        setOverridePayload(null);
      }
    },
    [overridePayload, currentIndex, queue, bookedKeys, skippedKeys, getItemKey, onBookItem, onBatchComplete, onClose]
  );

  const handleSkip = useCallback(() => {
    if (!currentItem) return;
    const key = getItemKey(currentItem);
    setSkippedKeys((prev) => [...prev, key]);
    setSlotPickerItem(null);
    setOverridePayload(null);
    const nextIdx = currentIndex + 1;
    if (nextIdx >= queue.length) {
      setBatchState('COMPLETED');
      onBatchComplete(bookedKeys, [...skippedKeys, key]);
      onClose();
    } else {
      setCurrentIndex(nextIdx);
      setSlotPickerItem(queue[nextIdx] ?? null);
    }
  }, [currentItem, currentIndex, queue, bookedKeys, skippedKeys, getItemKey, onBatchComplete, onClose]);

  const handleStop = useCallback(() => {
    setBatchState('ABORTED');
    const remaining = queue.slice(currentIndex).map(getItemKey);
    onBatchComplete(bookedKeys, [...skippedKeys, ...remaining]);
    onClose();
  }, [currentIndex, queue, bookedKeys, skippedKeys, getItemKey, onBatchComplete, onClose]);

  const handleRetry = useCallback(() => {
    setBatchState('RUNNING');
    setPauseError(null);
    setSlotPickerItem(currentItem);
  }, [currentItem]);

  useEffect(() => {
    if (!open) {
      setQueue([]);
      setCurrentIndex(0);
      setBatchState('IDLE');
      setBookedKeys([]);
      setSkippedKeys([]);
      setOverridePayload(null);
      setSlotPickerItem(null);
      setPauseError(null);
      return;
    }
    if (items.length > 0 && queue.length === 0 && batchState === 'IDLE') {
      handleStart();
    }
  }, [open, items.length, queue.length, batchState, handleStart]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-queue-title"
      >
        <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
          <div className="flex items-center justify-between p-4 border-b">
            <h2 id="booking-queue-title" className="text-lg font-semibold text-gray-900">
              Kötegelt foglalás
            </h2>
            <button onClick={handleClose} className="text-gray-500 hover:text-gray-700 p-1" aria-label="Bezárás">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">
                {doneCount}/{totalCount} kész
              </span>
              {(batchState === 'RUNNING' || batchState === 'PAUSED') && currentItem && (
                <span className="font-medium text-gray-900">
                  Következő: {currentItem.patientName ?? `#${currentItem.patientId.slice(0, 8)}`} – {currentItem.nextStep}
                </span>
              )}
            </div>

            {batchState === 'PAUSED' && pauseError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                {pauseError}
                <div className="mt-2 flex gap-2">
                  <button onClick={handleRetry} className="btn-primary text-sm">
                    Újra
                  </button>
                  <button onClick={handleSkip} className="btn-secondary text-sm flex items-center gap-1">
                    <SkipForward className="w-4 h-4" />
                    Kihagyás
                  </button>
                  <button onClick={handleStop} className="btn-secondary text-sm flex items-center gap-1">
                    <Square className="w-4 h-4" />
                    Leállítás
                  </button>
                </div>
              </div>
            )}

            {batchState === 'COMPLETED' && (
              <p className="text-green-700 font-medium">Kész. {bookedKeys.length} foglalva, {skippedKeys.length} kihagyva.</p>
            )}

            {batchState === 'ABORTED' && (
              <p className="text-gray-600">Leállítva. {bookedKeys.length} foglalva, {skippedKeys.length} kihagyva.</p>
            )}
          </div>

          <div className="flex justify-end gap-2 p-4 border-t">
            {(batchState === 'RUNNING' || batchState === 'PAUSED') && (
              <>
                <button
                  onClick={handleSkip}
                  className="btn-secondary text-sm flex items-center gap-1"
                  disabled={!currentItem}
                >
                  <SkipForward className="w-4 h-4" />
                  Kihagyás
                </button>
                <button onClick={handleStop} className="btn-secondary text-sm flex items-center gap-1">
                  <Square className="w-4 h-4" />
                  Leállítás
                </button>
              </>
            )}
            {batchState === 'IDLE' && (
              <button onClick={handleStart} className="btn-primary">
                Indítás
              </button>
            )}
          </div>
        </div>
      </div>

      {slotPickerItem && (
        <SlotPickerModal
          open={!!slotPickerItem}
          onClose={() => {
            handleSkip();
          }}
          pool={(slotPickerItem.pool as 'work' | 'consult' | 'control') || 'work'}
          durationMinutes={slotPickerItem.durationMinutes || 30}
          windowStart={
            slotPickerItem.windowStart ? new Date(slotPickerItem.windowStart) : new Date()
          }
          windowEnd={
            slotPickerItem.windowEnd
              ? new Date(slotPickerItem.windowEnd)
              : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          }
          patientId={slotPickerItem.patientId}
          episodeId={slotPickerItem.episodeId}
          patientName={slotPickerItem.patientName ?? undefined}
          onSelectSlot={handleSlotSelect}
        />
      )}

      {overridePayload && (
        <OverrideModal
          open={!!overridePayload}
          onClose={() => {
            setOverridePayload(null);
            handleSkip();
          }}
          error={overridePayload.error}
          overrideHint={overridePayload.overrideHint}
          expectedHardNext={overridePayload.expectedHardNext}
          existingAppointment={overridePayload.existingAppointment}
          onConfirm={async (reason) => {
            await handleOverrideConfirm(reason);
          }}
        />
      )}
    </>
  );
}

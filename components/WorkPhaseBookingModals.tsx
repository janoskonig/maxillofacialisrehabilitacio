'use client';

import { SlotPickerModal } from './SlotPickerModal';
import { OverrideModal } from './OverrideModal';
import { LinkAppointmentModal } from './LinkAppointmentModal';
import { MarkCompletedRetroModal } from './MarkCompletedRetroModal';
import { UnsuccessfulAttemptModal } from './UnsuccessfulAttemptModal';
import type { WorkPhaseBookingApi } from '@/hooks/useWorkPhaseBooking';

/**
 * A useWorkPhaseBooking hook modáljai egy helyen — a Kezelési terv kártya
 * (EpisodeStepsManager) rendereli. A prop-származtatás megegyezik a
 * PatientWorklistWidget-ben bevált mintával.
 */
export function WorkPhaseBookingModals({ api }: { api: WorkPhaseBookingApi }) {
  const {
    slotPickerItem,
    slotPickerRetryContext,
    closeSlotPicker,
    handleSelectSlot,
    override429,
    closeOverride,
    handleOverrideConfirm,
    linkAppointmentItem,
    closeLinkAppointment,
    confirmLinkAppointment,
    markCompleteRetroCtx,
    closeMarkCompleteRetro,
    confirmMarkCompleteRetro,
    unsuccessfulModalCtx,
    closeMarkUnsuccessful,
    confirmMarkUnsuccessful,
  } = api;

  return (
    <>
      {override429 && (
        <OverrideModal
          open={!!override429}
          onClose={closeOverride}
          error={override429.error}
          overrideHint={override429.overrideHint}
          expectedHardNext={override429.expectedHardNext}
          existingAppointment={override429.existingAppointment}
          onConfirm={handleOverrideConfirm}
        />
      )}

      {slotPickerItem && (
        <SlotPickerModal
          open={!!slotPickerItem}
          onClose={closeSlotPicker}
          pool={(slotPickerItem.pool as 'work' | 'consult' | 'control') || 'work'}
          durationMinutes={slotPickerItem.durationMinutes || 30}
          windowStart={
            slotPickerItem.bookableWindowStart
              ? new Date(slotPickerItem.bookableWindowStart)
              : slotPickerItem.windowStart
                ? new Date(slotPickerItem.windowStart)
                : new Date()
          }
          windowEnd={
            slotPickerItem.bookableWindowEnd
              ? new Date(slotPickerItem.bookableWindowEnd)
              : slotPickerItem.windowEnd
                ? new Date(slotPickerItem.windowEnd)
                : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          }
          patientId={slotPickerItem.patientId}
          episodeId={slotPickerItem.episodeId}
          providerId={slotPickerItem.assignedProviderId ?? undefined}
          patientName={slotPickerItem.patientName ?? undefined}
          rescheduleFromIso={
            // Retry-kontextus elnyomja a "reschedule" bannert — egyértelmű,
            // hogy ez ÚJ próba, nem a régi áthelyezése.
            slotPickerRetryContext
              ? null
              : slotPickerItem.bookedAppointmentId
                ? slotPickerItem.bookedAppointmentStartTime ?? null
                : null
          }
          retryContext={slotPickerRetryContext}
          onSelectSlot={handleSelectSlot}
        />
      )}

      {linkAppointmentItem && (
        <LinkAppointmentModal
          open
          onClose={closeLinkAppointment}
          item={linkAppointmentItem}
          onConfirm={async (appointmentId, reason) => {
            await confirmLinkAppointment(appointmentId, reason);
          }}
        />
      )}

      {markCompleteRetroCtx && (
        <MarkCompletedRetroModal
          open
          onClose={closeMarkCompleteRetro}
          patientId={markCompleteRetroCtx.item.patientId}
          stepLabel={markCompleteRetroCtx.item.stepLabel ?? markCompleteRetroCtx.item.nextStep}
          excludeAppointmentIds={markCompleteRetroCtx.excludeAppointmentIds}
          onConfirm={async (payload) => {
            await confirmMarkCompleteRetro(payload);
          }}
        />
      )}

      {unsuccessfulModalCtx && (
        <UnsuccessfulAttemptModal
          open
          onClose={closeMarkUnsuccessful}
          appointmentId={unsuccessfulModalCtx.appointmentId}
          appointmentStart={unsuccessfulModalCtx.appointmentStart}
          stepLabel={
            unsuccessfulModalCtx.item.stepLabel ?? unsuccessfulModalCtx.item.nextStep
          }
          attemptNumber={unsuccessfulModalCtx.attemptNumber}
          onConfirmed={async (payload) => {
            await confirmMarkUnsuccessful(payload);
          }}
        />
      )}
    </>
  );
}

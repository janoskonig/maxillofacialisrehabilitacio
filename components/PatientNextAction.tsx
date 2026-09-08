"use client";

import { CalendarClock, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { hu } from "date-fns/locale";
import type { WorklistItemBackend } from "@/lib/worklist-types";
import {
  patientNextStepAction,
  patientNextStepLabel,
} from "@/lib/patient-next-step";

export function PatientNextAction({
  item,
  doctor,
  onGoToScheduling,
}: {
  item: WorklistItemBackend | null;
  doctor?: string | null;
  onGoToScheduling?: () => void;
}) {
  const booked = Boolean(item?.bookedAppointmentId);
  const date = (value: string) =>
    format(new Date(value), "yyyy. MMM d.", { locale: hu });
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-2">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {item ? patientNextStepLabel(item) : "Nincs következő munkafázis."}
        </h3>
        {item && (
          <>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {booked && item.bookedAppointmentStartTime
                ? `Lefoglalt időpont: ${format(new Date(item.bookedAppointmentStartTime), "yyyy. MMM d. HH:mm", { locale: hu })}`
                : item.windowStart
                  ? `Tervezett időszak: ${date(item.windowStart)}${item.windowEnd ? ` – ${date(item.windowEnd)}` : ""}`
                  : "Tervezett időszak még nincs megadva."}
            </p>
            {!booked && item.status === "blocked" && (
              <p className="text-sm text-amber-800 dark:text-amber-200">
                {item.blockedReason ||
                  "A folytatáshoz a kezelési terv áttekintése szükséges."}
              </p>
            )}
            {!booked && item.overdueByDays > 0 && (
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                {item.overdueByDays} napja lejárt a tervezett időszak.
              </p>
            )}
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Kezelőorvos: {doctor || "Nincs kijelölve"}
            </p>
          </>
        )}
      </div>
      {onGoToScheduling && (
        <button
          type="button"
          onClick={onGoToScheduling}
          className="btn-primary inline-flex shrink-0 items-center justify-center gap-2 self-start"
        >
          {booked ? (
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          )}
          {item ? patientNextStepAction(item) : "Kezelési terv áttekintése"}
        </button>
      )}
    </div>
  );
}

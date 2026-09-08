import type { WorklistItemBackend } from "./worklist-types";

/** The worklist also includes terminal steps; those must never become the next action. */
export function selectPatientNextStep(
  items: WorklistItemBackend[],
  patientId: string,
) {
  return (
    items
      .filter(
        (item) =>
          item.patientId === patientId &&
          item.stepStatus !== "completed" &&
          item.stepStatus !== "skipped",
      )
      .sort(
        (a, b) =>
          (a.episodeOrder ?? 0) - (b.episodeOrder ?? 0) ||
          (a.stepSeq ?? 0) - (b.stepSeq ?? 0),
      )[0] ?? null
  );
}

export function patientNextStepAction(item: WorklistItemBackend) {
  if (item.bookedAppointmentId) return "Időpont megtekintése";
  if (item.status === "blocked") return "Kezelési terv áttekintése";
  return "Időpont egyeztetése";
}

export function patientNextStepLabel(item: WorklistItemBackend) {
  if (item.blockedCode === "NO_CARE_PATHWAY")
    return "Kezelési terv kiválasztása";
  return (
    item.stepLabel ||
    (item.nextStep === "-" ? "Kezelési terv áttekintése" : item.nextStep)
  );
}

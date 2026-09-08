import { describe, expect, it } from "vitest";
import {
  selectPatientNextStep,
  patientNextStepAction,
} from "@/lib/patient-next-step";
import type { WorklistItemBackend } from "@/lib/worklist-types";

const item = (overrides: Partial<WorklistItemBackend>) =>
  ({
    patientId: "p1",
    episodeOrder: 0,
    stepSeq: 0,
    ...overrides,
  }) as WorklistItemBackend;

describe("next patient action", () => {
  it("excludes other patients and terminal steps, then orders remaining phases without mutating the source", () => {
    const next = item({ stepSeq: 3 });
    const items = [
      item({ patientId: "p2" }),
      item({ stepStatus: "completed" }),
      item({ stepStatus: "skipped" }),
      item({ episodeOrder: 1 }),
      next,
    ];
    const original = [...items];
    expect(selectPatientNextStep(items, "p1")).toBe(next);
    expect(items).toEqual(original);
  });
  it("returns empty for a fully completed plan", () => {
    expect(
      selectPatientNextStep([item({ stepStatus: "completed" })], "p1"),
    ).toBeNull();
  });
  it("shows booked and blocked actions without offering duplicate bookings", () => {
    expect(
      patientNextStepAction(
        item({ bookedAppointmentId: "a1", status: "blocked" }),
      ),
    ).toBe("Időpont megtekintése");
    expect(patientNextStepAction(item({ status: "blocked" }))).toBe(
      "Kezelési terv áttekintése",
    );
  });
});

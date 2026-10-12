import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { PatientOverviewTab } from "@/components/PatientOverviewTab";
import { PatientList } from "@/components/PatientList";
import type { Patient } from "@/lib/types";
import type { WorklistItemBackend } from "@/lib/worklist-types";

vi.mock("@/components/EpisodeStageCard", () => ({
  EpisodeStageCard: () => null,
}));
vi.mock("@/components/PatientListAvatar", () => ({
  PatientListAvatar: () => null,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const patient = {
  id: "a77ba197-8715-45ed-b595-6d7420fb8020",
  nev: "Minta Anna",
  szuletesiDatum: "1978-04-12",
  kezeleoorvos: "Dr. Minta Orvos",
} as Patient;
const next = (overrides: Partial<WorklistItemBackend> = {}) =>
  ({
    patientId: patient.id,
    episodeId: "episode-1",
    nextStep: "Konzultáció",
    stepLabel: "Konzultáció",
    stepStatus: "pending",
    episodeOrder: 0,
    stepSeq: 1,
    windowStart: "2026-09-08T08:00:00Z",
    windowEnd: "2026-09-15T08:00:00Z",
    overdueByDays: 0,
    ...overrides,
  }) as WorklistItemBackend;
const response = (data: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, json: async () => data } as Response);
const emptyEnrichment = {
  appointments: {},
  stages: {},
  opDocuments: {},
  fotoDocuments: {},
  portraitDocumentIds: {},
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("patient overview", () => {
  it("keeps failed tasks distinct from empty data and supports an independent retry", async () => {
    let failTasks = true;
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/tasks"))
        return response({ tasks: [] }, failTasks ? 500 : 200);
      if (url.includes("worklists"))
        return response({
          items: [
            next({
              stepStatus: "completed",
              stepSeq: 0,
              stepLabel: "Régi vizit",
            }),
            next(),
          ],
        });
      return response({ success: true, logs: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSchedule = vi.fn();
    render(
      <PatientOverviewTab
        patient={patient}
        onGoToTab={vi.fn()}
        onGoToScheduling={onSchedule}
      />,
    );
    expect(screen.queryByText("Nincs nyitott feladat.")).toBeNull();
    expect(
      await screen.findByText("A feladatok betöltése sikertelen."),
    ).toBeTruthy();
    expect(screen.queryByText("Régi vizit")).toBeNull();
    expect(screen.getByText("Konzultáció")).toBeTruthy();
    expect(screen.getByText("Kezelőorvos: Dr. Minta Orvos")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Időpont egyeztetése" }),
    );
    expect(onSchedule).toHaveBeenCalledOnce();
    const worklistCalls = fetchMock.mock.calls.filter(([url]) =>
      url.includes("worklists"),
    ).length;
    failTasks = false;
    fireEvent.click(screen.getByRole("button", { name: "Újrapróbálás" }));
    expect(await screen.findByText("Nincs nyitott feladat.")).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(([url]) => url.includes("worklists")).length,
    ).toBe(worklistCalls);
  });

  it("does not label a booked step overdue or invite duplicate booking", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        response(
          url.includes("worklists")
            ? {
                items: [
                  next({
                    bookedAppointmentId: "appointment-1",
                    bookedAppointmentStartTime: "2026-09-09T08:00:00Z",
                    overdueByDays: 8,
                  }),
                ],
              }
            : { tasks: [], success: true, logs: [] },
        ),
      ),
    );
    render(
      <PatientOverviewTab
        patient={patient}
        onGoToTab={vi.fn()}
        onGoToScheduling={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("button", { name: "Időpont megtekintése" }),
    ).toBeTruthy();
    expect(screen.queryByText(/napja lejárt/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Időpont egyeztetése" }),
    ).toBeNull();
  });
});

describe("patient directory", () => {
  it("opens the overview from the patient name, keeps editing explicit, and restores optional columns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        response(
          url.includes("worklists") ? { items: [next()] } : emptyEnrichment,
        ),
      ),
    );
    const onView = vi.fn();
    const onEdit = vi.fn();
    const props = {
      patients: [patient],
      onView,
      onEdit,
      canEdit: true,
      userRole: "admin" as const,
    };
    const view = render(<PatientList {...props} />);
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(8);
    expect(within(table).getByRole("columnheader", { name: "Kapcsolat" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "Regisztráció" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Minta Anna" }));
    expect(onView).toHaveBeenCalledWith(patient);
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Szerkesztés" }));
    expect(onEdit).toHaveBeenCalledWith(patient);
    fireEvent.click(screen.getByText("Oszlopok"));
    fireEvent.click(screen.getByLabelText("TAJ szám"));
    expect(
      within(table).getByRole("columnheader", { name: "TAJ szám" }),
    ).toBeTruthy();
    view.unmount();
    render(<PatientList {...props} />);
    await waitFor(() =>
      expect(
        screen.getByRole("columnheader", { name: "TAJ szám" }),
      ).toBeTruthy(),
    );
  });

  it("always shows age and registration details, including when old preferences hid creation data", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00"));
    localStorage.setItem("patient-list-columns-v1", "[]");
    vi.stubGlobal("fetch", vi.fn((url: string) => response(
      url.includes("worklists") ? { items: [] } : emptyEnrichment,
    )));
    const onSort = vi.fn();
    const registered = {
      ...patient,
      createdBy: "regisztralo.orvos@example.com",
      createdAt: "2026-09-01T12:00:00Z",
    };
    render(<PatientList patients={[registered]} onView={vi.fn()} onSort={onSort} userRole="admin" />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("48 éves")).toBeTruthy();
    expect(within(table).getByText("Más regisztrálta")).toBeTruthy();
    expect(within(table).getByText("Regisztráló: regisztralo.orvos@example.com")).toBeTruthy();
    expect(within(table).getByText("2026-09-01")).toBeTruthy();
    fireEvent.click(within(table).getByRole("button", { name: "Regisztráció" }));
    expect(onSort).toHaveBeenCalledWith("createdAt");
    expect(within(table).queryByRole("columnheader", { name: "Kapcsolat" })).toBeNull();
  });

  it("does not infer self-registration from missing historical registrar data", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => response(
      url.includes("worklists") ? { items: [] } : emptyEnrichment,
    )));
    render(<PatientList patients={[{ ...patient, createdBy: null, createdAt: null }]} onView={vi.fn()} userRole="admin" />);
    expect(await screen.findByText("Regisztráló nincs rögzítve")).toBeTruthy();
    expect(screen.getByText("A regisztráció dátuma nincs rögzítve")).toBeTruthy();
    expect(screen.queryByText("Más regisztrálta")).toBeNull();
  });

  it("keeps the next action visible on mobile and puts contact details behind an expandable section", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00"));
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        response(
          url.includes("worklists") ? { items: [next()] } : { ...emptyEnrichment, opDocuments: { [patient.id!]: 1 } },
        ),
      ),
    );
    const onView = vi.fn();
    const onEdit = vi.fn();
    render(
      <PatientList
        patients={[{ ...patient, telefonszam: "+36 00 000 0000", createdBy: "regisztralo@example.com", createdAt: "2026-09-01T12:00:00Z" }]}
        onView={onView}
        onEdit={onEdit}
        canEdit
        userRole="admin"
      />,
    );
    expect(
      await screen.findByRole("link", { name: "Időpont egyeztetése" }),
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    const details = screen
      .getByText("Részletek és dokumentumok")
      .closest("details")!;
    expect(details.open).toBe(false);
    expect(screen.getByText("48 éves").closest("details")).toBeNull();
    expect(screen.getByText("Regisztráló: regisztralo@example.com").closest("details")).toBeNull();
    expect(screen.getByText("2026-09-01").closest("details")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Minta Anna" }));
    expect(onView).toHaveBeenCalledWith(
      expect.objectContaining({ id: patient.id }),
    );
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("does not request or display clinical next steps for technicians", async () => {
    const fetchMock = vi.fn((_url: string) => response(emptyEnrichment));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <PatientList
        patients={[patient]}
        onView={vi.fn()}
        userRole="technikus"
      />,
    );
    await screen.findByRole("button", { name: "Minta Anna" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("worklists");
    expect(
      screen.queryByRole("columnheader", { name: "Következő teendő" }),
    ).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Regisztráció" })).toBeNull();
    expect(screen.queryByText("Regisztráló nincs rögzítve")).toBeNull();
    expect(screen.queryByText(/éves/)).toBeNull();
  });

  it("does not turn a failed appointment request into a no-appointment claim", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        response(
          url.includes("worklists") ? { items: [] } : {},
          url.includes("worklists") ? 200 : 500,
        ),
      ),
    );
    render(
      <PatientList patients={[patient]} onView={vi.fn()} userRole="admin" />,
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Nincs foglalt időpont")).toBeNull();
  });
});

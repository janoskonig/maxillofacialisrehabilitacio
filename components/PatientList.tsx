"use client";

import { useState, useEffect, useMemo, memo } from "react";
import Link from "next/link";
import { Patient, patientStageOptions } from "@/lib/types";
import {
  FileText,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  Camera,
  Image as ImageIcon,
  Columns,
} from "lucide-react";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { PatientCard } from "./PatientCard";
import { MobileTable } from "./mobile/MobileTable";
import { PatientListAvatar } from "./PatientListAvatar";
import { useRemoteData } from "@/hooks/useRemoteData";
import { RemoteDataState } from "./ui/RemoteDataState";
import {
  selectPatientNextStep,
  patientNextStepAction,
  patientNextStepLabel,
} from "@/lib/patient-next-step";
import type { WorklistItemBackend } from "@/lib/worklist-types";

type SortField = "nev" | "idopont" | "createdAt" | "kezeleoorvos";
interface PatientListProps {
  patients: Patient[];
  onView: (patient: Patient) => void;
  onEdit?: (patient: Patient) => void;
  onDelete?: (patient: Patient) => void;
  onViewOP?: (patient: Patient) => void;
  onViewFoto?: (patient: Patient) => void;
  canEdit?: boolean;
  canDelete?: boolean;
  userRole?: "admin" | "fogpótlástanász" | "technikus" | "beutalo_orvos";
  sortField?: SortField | null;
  sortDirection?: "asc" | "desc";
  onSort?: (field: SortField) => void;
  searchQuery?: string;
  isFiltered?: boolean;
}

interface AppointmentInfo {
  id: string;
  startTime: string;
  dentistEmail: string | null;
  dentistName?: string | null;
  appointmentStatus?:
    | "cancelled_by_doctor"
    | "cancelled_by_patient"
    | "completed"
    | "no_show"
    | null;
  completionNotes?: string | null;
  isLate?: boolean;
}
interface ListEnrichment {
  appointments: Record<string, AppointmentInfo>;
  opDocuments: Record<string, number>;
  fotoDocuments: Record<string, number>;
  portraitDocumentIds: Record<string, string>;
  stages: Record<
    string,
    { stage: string; stageDate?: string; notes?: string; stageLabel?: string }
  >;
}

const EXTRA_COLUMNS = [
  { id: "foto", label: "Fotók" },
  { id: "op", label: "OP" },
  { id: "taj", label: "TAJ szám" },
  { id: "contact", label: "Kapcsolat" },
  { id: "created", label: "Létrehozva" },
] as const;
type ExtraColumn = (typeof EXTRA_COLUMNS)[number]["id"];
const COLUMN_KEY = "patient-list-columns-v1";
const cell = "px-3 py-4 text-sm text-gray-900 dark:text-gray-100 align-top";
const secondary = "text-xs text-gray-600 dark:text-gray-400";

function PatientListComponent({
  patients,
  onView,
  onEdit,
  onDelete,
  onViewOP,
  onViewFoto,
  canEdit = false,
  canDelete = false,
  userRole,
  sortField,
  sortDirection = "asc",
  onSort,
  searchQuery = "",
  isFiltered = false,
}: PatientListProps) {
  const clinical = userRole !== "technikus";
  const patientIds = useMemo(
    () => patients.flatMap((p) => (p.id ? [p.id] : [])),
    [patients],
  );
  const enrichment = useRemoteData<ListEnrichment>(
    patientIds.length ? "/api/patients/list-enrichment" : null,
    JSON.stringify({ patientIds }),
  );
  const nextSteps = useRemoteData<{ items: WorklistItemBackend[] }>(
    clinical && patientIds.length
      ? `/api/worklists/wip-next-appointments?patientIds=${encodeURIComponent(patientIds.join(","))}`
      : null,
  );
  const appointments = enrichment.data?.appointments;
  const [columns, setColumns] = useState<ExtraColumn[]>([]);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(COLUMN_KEY) ?? "[]",
      );
      if (Array.isArray(saved))
        setColumns(
          EXTRA_COLUMNS.filter((c) => saved.includes(c.id)).map((c) => c.id),
        );
    } catch {
      /* Use the compact default when browser storage is unavailable. */
    }
  }, []);
  const toggleColumn = (id: ExtraColumn) => {
    const next = columns.includes(id)
      ? columns.filter((c) => c !== id)
      : [...columns, id];
    setColumns(next);
    try {
      localStorage.setItem(COLUMN_KEY, JSON.stringify(next));
    } catch {
      /* Optional preference. */
    }
  };

  const sortedPatients = useMemo(() => {
    if (sortField !== "idopont") return patients;
    return [...patients].sort((a, b) => {
      const first = appointments?.[a.id ?? ""];
      const second = appointments?.[b.id ?? ""];
      if (!first && !second) return 0;
      if (!first) return 1;
      if (!second) return -1;
      return (
        (new Date(first.startTime).getTime() -
          new Date(second.startTime).getTime()) *
        (sortDirection === "asc" ? 1 : -1)
      );
    });
  }, [patients, appointments, sortField, sortDirection]);

  const header = (label: string, field?: SortField) => (
    <th
      scope="col"
      className="px-3 py-3 text-left text-xs font-medium text-gray-600 dark:text-gray-300"
      aria-sort={
        field && sortField === field
          ? sortDirection === "asc"
            ? "ascending"
            : "descending"
          : undefined
      }
    >
      {field && onSort ? (
        <button
          type="button"
          onClick={() => onSort(field)}
          className="inline-flex items-center gap-1.5 py-1 text-left hover:text-blue-700 dark:hover:text-blue-300"
        >
          {label}
          {sortField === field &&
            (sortDirection === "asc" ? (
              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            ))}
        </button>
      ) : (
        label
      )}
    </th>
  );
  const pendingText =
    enrichment.status === "loading" ? "Betöltés…" : "Nem tölthető be";
  const renderNextStep = (patient: Patient) => {
    if (nextSteps.status !== "success")
      return (
        <span className={secondary}>
          {nextSteps.status === "loading" ? "Betöltés…" : "Nem tölthető be"}
        </span>
      );
    const step = selectPatientNextStep(
      nextSteps.data?.items ?? [],
      patient.id ?? "",
    );
    if (!step)
      return <span className={secondary}>Nincs következő munkafázis.</span>;
    return (
      <div className="min-w-[140px] max-w-xs space-y-1">
        <span className="block text-sm font-medium">
          {patientNextStepLabel(step)}
        </span>
        <Link
          href={`/patients/${patient.id}/stages`}
          className="inline-flex min-h-11 items-center text-xs text-blue-700 md:min-h-0 md:py-1 hover:underline dark:text-blue-300"
        >
          {patientNextStepAction(step)}
        </Link>
        {step.status === "blocked" && !step.bookedAppointmentId && (
          <span className="block text-xs text-amber-800 dark:text-amber-200">
            {step.blockedReason || "A folytatáshoz egyeztetés szükséges."}
          </span>
        )}
        {step.overdueByDays > 0 && !step.bookedAppointmentId && (
          <span className="block text-xs text-red-700 dark:text-red-300">
            {step.overdueByDays} napja lejárt
          </span>
        )}
      </div>
    );
  };
  const renderAppointment = (patient: Patient) => {
    if (enrichment.status !== "success")
      return <span className={secondary}>{pendingText}</span>;
    const appointment = appointments?.[patient.id ?? ""];
    if (!appointment)
      return <span className={secondary}>Nincs foglalt időpont</span>;
    const labels = {
      cancelled_by_doctor: "Lemondva (orvos)",
      cancelled_by_patient: "Lemondva (beteg)",
      completed: "Teljesült",
      no_show: "Nem jelent meg",
    };
    return (
      <div className="space-y-1">
        <time dateTime={appointment.startTime} className="block tabular-nums">
          {new Date(appointment.startTime).toLocaleString("hu-HU", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
        {appointment.dentistName && (
          <span className={`block ${secondary}`}>
            {appointment.dentistName}
          </span>
        )}
        {appointment.appointmentStatus && (
          <span
            className={`block ${secondary}`}
            title={appointment.completionNotes ?? undefined}
          >
            {labels[appointment.appointmentStatus]}
          </span>
        )}
        {appointment.isLate && (
          <span className="block text-xs text-amber-800 dark:text-amber-200">
            Késett
          </span>
        )}
      </div>
    );
  };
  const renderExtraCell = (patient: Patient, column: ExtraColumn) => {
    const id = patient.id ?? "";
    if (column === "taj") return patient.taj || "Nincs megadva";
    if (column === "created") return formatDateForDisplay(patient.createdAt);
    if (column === "contact")
      return (
        <div className="space-y-1">
          <span className="block">
            {patient.telefonszam || "Nincs telefonszám"}
          </span>
          {patient.email && (
            <span className={`block break-all ${secondary}`}>
              {patient.email}
            </span>
          )}
        </div>
      );
    if (enrichment.status !== "success")
      return <span className={secondary}>{pendingText}</span>;
    const count =
      (column === "foto"
        ? enrichment.data?.fotoDocuments[id]
        : enrichment.data?.opDocuments[id]) ?? 0;
    const Icon = column === "foto" ? Camera : ImageIcon;
    if (!count) return <span className={secondary}>Nincs</span>;
    return (
      <button
        type="button"
        onClick={() =>
          (column === "foto" ? (onViewFoto ?? onView) : (onViewOP ?? onView))(
            patient,
          )
        }
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-2 text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950"
        aria-label={`${column === "foto" ? "Fotók" : "OP felvételek"}: ${patient.nev}, ${count} dokumentum`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {count}
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {clinical && (
        <details className="hidden md:block">
          <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
            <Columns className="h-4 w-4" aria-hidden="true" />
            Oszlopok{columns.length > 0 ? ` (+${columns.length})` : ""}
          </summary>
          <fieldset className="mt-2 flex flex-wrap gap-4 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
            <legend className="sr-only">További oszlopok</legend>
            {EXTRA_COLUMNS.map((column) => (
              <label
                key={column.id}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={columns.includes(column.id)}
                  onChange={() => toggleColumn(column.id)}
                />
                {column.label}
              </label>
            ))}
          </fieldset>
        </details>
      )}
      {patients.length > 0 && enrichment.status === "error" && (
        <RemoteDataState
          status="error"
          label="Az időpontok és dokumentumok"
          onRetry={enrichment.retry}
        >
          {null}
        </RemoteDataState>
      )}
      {patients.length > 0 && clinical && nextSteps.status === "error" && (
        <RemoteDataState
          status="error"
          label="A következő teendők"
          onRetry={nextSteps.retry}
        >
          {null}
        </RemoteDataState>
      )}
      <MobileTable
        items={sortedPatients}
        keyExtractor={(patient) => patient.id ?? ""}
        emptyState={
          <div className="card py-8 text-center">
            <FileText
              className="mx-auto mb-2 h-8 w-8 text-gray-400"
              aria-hidden="true"
            />
            <h3 className="font-medium">Nincs találat</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {isFiltered || searchQuery.trim()
                ? "Próbálja módosítani a keresési feltételeket."
                : "Kezdje az első beteg hozzáadásával."}
            </p>
          </div>
        }
        renderHeader={() => (
          <>
            {header("Beteg", "nev")}
            {clinical && header("Következő teendő")}
            {clinical && header("Kezelési szakasz")}
            {header("Kezelőorvos", "kezeleoorvos")}
            {clinical && header("Következő időpont", "idopont")}
            {clinical &&
              EXTRA_COLUMNS.filter((c) => columns.includes(c.id)).map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className="px-3 py-3 text-left text-xs font-medium text-gray-600 dark:text-gray-300"
                >
                  {c.id === "created" && onSort ? (
                    <button type="button" onClick={() => onSort("createdAt")}>
                      {c.label}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            {header("Műveletek")}
          </>
        )}
        renderRow={(patient) => {
          const id = patient.id ?? "";
          const stage = enrichment.data?.stages[id];
          return (
            <>
              <td className={cell}>
                <div className="flex items-start gap-2.5">
                  {patient.id && (
                    <PatientListAvatar
                      patientId={patient.id}
                      patientName={patient.nev}
                      portraitDocumentId={
                        enrichment.data?.portraitDocumentIds[id] ?? null
                      }
                    />
                  )}
                  <div className="min-w-[110px]">
                    <button
                      type="button"
                      onClick={() => onView(patient)}
                      className="py-1 text-left font-semibold text-blue-700 hover:underline dark:text-blue-300"
                    >
                      {patient.nev || "Név nélküli beteg"}
                    </button>
                    {clinical && patient.szuletesiDatum && (
                      <span className={`block ${secondary}`}>
                        Szül.: {formatDateForDisplay(patient.szuletesiDatum)}
                      </span>
                    )}
                    {patient.halalDatum && (
                      <span className={`block ${secondary}`}>
                        Elhunyt · {formatDateForDisplay(patient.halalDatum)}
                      </span>
                    )}
                  </div>
                </div>
              </td>
              {clinical && <td className={cell}>{renderNextStep(patient)}</td>}
              {clinical && (
                <td className={cell}>
                  {enrichment.status !== "success" ? (
                    <span className={secondary}>{pendingText}</span>
                  ) : stage ? (
                    <span
                      className="inline-block rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                      title={stage.notes}
                    >
                      {stage.stageLabel ??
                        patientStageOptions.find((s) => s.value === stage.stage)
                          ?.label ??
                        stage.stage}
                    </span>
                  ) : (
                    <span className={secondary}>Nincs megadva</span>
                  )}
                </td>
              )}
              <td className={cell}>
                {patient.kezeleoorvos || (
                  <span className="text-xs text-amber-800 dark:text-amber-200">
                    Nincs kijelölve
                  </span>
                )}
              </td>
              {clinical && (
                <td className={cell}>{renderAppointment(patient)}</td>
              )}
              {clinical &&
                EXTRA_COLUMNS.filter((c) => columns.includes(c.id)).map((c) => (
                  <td key={c.id} className={cell}>
                    {renderExtraCell(patient, c.id)}
                  </td>
                ))}
              <td className={cell}>
                <div className="space-y-2">
                  {canEdit && onEdit && (
                    <button
                      type="button"
                      onClick={() => onEdit(patient)}
                      className="inline-flex items-center gap-1.5 py-1 text-sm text-gray-700 hover:text-blue-700 dark:text-gray-200 dark:hover:text-blue-300"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Szerkesztés
                    </button>
                  )}
                  <details>
                    <summary className="cursor-pointer py-1 text-xs text-gray-600 dark:text-gray-300">
                      Továbbiak
                    </summary>
                    <div className="mt-1 flex flex-col items-start gap-2">
                      <Link
                        href={`/patients/${id}/view?tab=kommunikacio`}
                        className="py-1 text-xs text-blue-700 hover:underline dark:text-blue-300"
                      >
                        Kommunikáció
                      </Link>
                      <Link
                        href={`/patients/${id}/history`}
                        className="py-1 text-xs text-blue-700 hover:underline dark:text-blue-300"
                      >
                        Életút
                      </Link>
                      {canDelete && onDelete && (
                        <button
                          type="button"
                          onClick={() => onDelete(patient)}
                          className="inline-flex items-center gap-1 py-2 text-xs text-red-700 dark:text-red-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Beteg törlése
                        </button>
                      )}
                    </div>
                  </details>
                </div>
              </td>
            </>
          );
        }}
        renderCard={(patient) => (
          <PatientCard
            patient={patient}
            appointment={appointments?.[patient.id ?? ""]}
            opDocumentCount={
              enrichment.data?.opDocuments[patient.id ?? ""] ?? 0
            }
            fotoDocumentCount={
              enrichment.data?.fotoDocuments[patient.id ?? ""] ?? 0
            }
            portraitDocumentId={
              enrichment.data?.portraitDocumentIds[patient.id ?? ""] ?? null
            }
            stage={enrichment.data?.stages[patient.id ?? ""]}
            nextAction={clinical ? renderNextStep(patient) : undefined}
            onView={onView}
            onEdit={onEdit}
            onDelete={onDelete}
            onViewOP={onViewOP}
            onViewFoto={onViewFoto}
            canEdit={canEdit}
            canDelete={canDelete}
            userRole={userRole}
          />
        )}
      />
    </div>
  );
}

export const PatientList = memo(PatientListComponent);

"use client";

import { memo, type ReactNode } from "react";
import { Patient, patientStageOptions } from "@/lib/types";
import {
  Calendar,
  Pencil,
  Trash2,
  Image as ImageIcon,
  Camera,
  CheckCircle2,
  XCircle,
  Clock,
  Clock as ClockIcon,
  History,
  User,
} from "lucide-react";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { useRouter } from "next/navigation";
import { PatientListAvatar } from "./PatientListAvatar";

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
  isLate?: boolean;
}

interface PatientCardProps {
  patient: Patient;
  nextAction?: ReactNode;
  appointment?: AppointmentInfo;
  opDocumentCount?: number;
  fotoDocumentCount?: number;
  /** Legfrissebb portré / önarckép dokumentum (fotodokumentáció címke) — a lista avatárja */
  portraitDocumentId?: string | null;
  stage?: {
    stage: string;
    stageDate?: string;
    notes?: string;
    stageLabel?: string;
  };
  onView: (patient: Patient) => void;
  onEdit?: (patient: Patient) => void;
  onDelete?: (patient: Patient) => void;
  onViewOP?: (patient: Patient) => void;
  onViewFoto?: (patient: Patient) => void;
  canEdit?: boolean;
  canDelete?: boolean;
  userRole?: "admin" | "fogpótlástanász" | "technikus" | "beutalo_orvos";
}

function PatientCardComponent({
  patient,
  nextAction,
  appointment,
  opDocumentCount = 0,
  fotoDocumentCount = 0,
  portraitDocumentId = null,
  stage,
  onView,
  onEdit,
  onDelete,
  onViewOP,
  onViewFoto,
  canEdit = false,
  canDelete = false,
  userRole,
}: PatientCardProps) {
  const router = useRouter();

  const handleHistoryClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/patients/${patient.id}/history`);
  };

  const handleImpersonate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!patient.id) return;

    try {
      const response = await fetch("/api/patient-portal/auth/impersonate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ patientId: patient.id }),
      });

      if (response.ok) {
        const data = await response.json();
        // Redirect to patient portal
        window.location.href = data.redirectUrl || "/patient-portal/dashboard";
      } else {
        const data = await response.json();
        alert(data.error || "Hiba történt a bejelentkezéskor");
      }
    } catch (error) {
      console.error("Error impersonating patient:", error);
      alert("Hiba történt a bejelentkezéskor");
    }
  };

  const getStatusInfo = (
    status?: AppointmentInfo["appointmentStatus"],
    isLate?: boolean,
  ) => {
    if (isLate) {
      return {
        label: "Késett",
        color: "text-orange-600 dark:text-orange-400",
        bgColor: "bg-orange-50 dark:bg-orange-950/40",
        icon: ClockIcon,
      };
    }
    switch (status) {
      case "cancelled_by_doctor":
        return {
          label: "Lemondva (orvos)",
          color: "text-red-600 dark:text-red-400",
          bgColor: "bg-red-50 dark:bg-red-950/40",
          icon: XCircle,
        };
      case "cancelled_by_patient":
        return {
          label: "Lemondva (beteg)",
          color: "text-orange-600 dark:text-orange-400",
          bgColor: "bg-orange-50 dark:bg-orange-950/40",
          icon: XCircle,
        };
      case "completed":
        return {
          label: "Teljesült",
          color: "text-green-600 dark:text-green-400",
          bgColor: "bg-green-50 dark:bg-green-950/40",
          icon: CheckCircle2,
        };
      case "no_show":
        return {
          label: "Nem jelent meg",
          color: "text-red-700 dark:text-red-400",
          bgColor: "bg-red-100 dark:bg-red-900",
          icon: XCircle,
        };
      default:
        return null;
    }
  };

  const statusInfo = appointment
    ? getStatusInfo(appointment.appointmentStatus, appointment.isLate)
    : null;

  const getStageLabel = (s: { stage: string; stageLabel?: string }) => {
    return (
      s.stageLabel ??
      patientStageOptions.find((opt) => opt.value === s.stage)?.label ??
      s.stage
    );
  };

  return (
    <article className="card space-y-3" aria-label={patient.nev || "Beteg"}>
      <div className="flex items-start gap-3">
        {patient.id && (
          <PatientListAvatar
            patientId={patient.id}
            patientName={patient.nev}
            portraitDocumentId={portraitDocumentId}
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">
            <button
              type="button"
              onClick={() => onView(patient)}
              className="min-h-9 text-left text-blue-700 hover:underline dark:text-blue-300"
            >
              {patient.nev || "Név nélküli beteg"}
            </button>
          </h3>
          {userRole !== "technikus" && patient.szuletesiDatum && (
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Szül.: {formatDateForDisplay(patient.szuletesiDatum)}
            </p>
          )}
          {patient.halalDatum && (
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Elhunyt · {formatDateForDisplay(patient.halalDatum)}
            </p>
          )}
        </div>
      </div>
      {stage && (
        <span
          className="inline-block rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200"
          title={stage.notes}
        >
          {getStageLabel(stage)}
        </span>
      )}

      {nextAction && (
        <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-950/40">
          <p className="mb-1 text-xs font-medium text-blue-800 dark:text-blue-200">
            Következő teendő
          </p>
          {nextAction}
        </div>
      )}

      {userRole !== "technikus" && appointment && (
        <div className="flex items-start gap-2 text-sm">
          <Calendar
            className="mt-0.5 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
            aria-hidden="true"
          />
          <div>
            <time dateTime={appointment.startTime}>
              {new Date(appointment.startTime).toLocaleString("hu-HU", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
            {statusInfo && (
              <span className={`ml-2 text-xs ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
            )}
          </div>
        </div>
      )}
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Kezelőorvos:{" "}
        {patient.kezeleoorvos || (
          <span className="text-amber-800 dark:text-amber-200">
            Nincs kijelölve
          </span>
        )}
      </p>

      <details className="border-t border-gray-200 pt-1 dark:border-gray-700">
        <summary className="cursor-pointer py-3 text-sm text-gray-700 dark:text-gray-200">
          Részletek és dokumentumok
        </summary>
        <div className="space-y-3 pb-3 text-sm text-gray-600 dark:text-gray-300">
          {userRole !== "technikus" && (
            <>
              <p>TAJ: {patient.taj || "Nincs megadva"}</p>
              <p className="break-all">
                {patient.telefonszam || "Nincs telefonszám"}
                {patient.email && (
                  <span className="block">{patient.email}</span>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {opDocumentCount > 0 && (
                  <button
                    type="button"
                    onClick={() => (onViewOP ?? onView)(patient)}
                    className="btn-secondary inline-flex items-center gap-2"
                  >
                    <ImageIcon className="h-4 w-4" aria-hidden="true" />
                    OP ({opDocumentCount})
                  </button>
                )}
                {fotoDocumentCount > 0 && (
                  <button
                    type="button"
                    onClick={() => (onViewFoto ?? onView)(patient)}
                    className="btn-secondary inline-flex items-center gap-2"
                  >
                    <Camera className="h-4 w-4" aria-hidden="true" />
                    Fotók ({fotoDocumentCount})
                  </button>
                )}
              </div>
              {patient.createdAt && (
                <p className="text-xs">
                  Létrehozva: {formatDateForDisplay(patient.createdAt)}
                  {patient.createdBy ? ` · ${patient.createdBy}` : ""}
                </p>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {patient.id && (
              <button
                type="button"
                onClick={handleHistoryClick}
                className="btn-secondary inline-flex items-center gap-2"
              >
                <History className="h-4 w-4" aria-hidden="true" />
                Életút
              </button>
            )}
            {userRole === "admin" && patient.id && (
              <button
                type="button"
                onClick={handleImpersonate}
                className="btn-secondary inline-flex items-center gap-2"
              >
                <User className="h-4 w-4" aria-hidden="true" />
                Belépés betegként
              </button>
            )}
            {canDelete && onDelete && (
              <button
                type="button"
                onClick={() => onDelete(patient)}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-3 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Beteg törlése
              </button>
            )}
          </div>
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onView(patient)}
          className="btn-secondary flex-1"
        >
          Megtekintés
        </button>
        {canEdit && onEdit && (
          <button
            type="button"
            onClick={() => onEdit(patient)}
            className="btn-secondary inline-flex flex-1 items-center justify-center gap-2"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Szerkesztés
          </button>
        )}
      </div>
    </article>
  );
}

export const PatientCard = memo(PatientCardComponent);

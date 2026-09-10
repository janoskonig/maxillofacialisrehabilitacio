"use client";

import { Patient } from "@/lib/types";
import type { WorklistItemBackend } from "@/lib/worklist-types";
import { EpisodeStageCard } from "@/components/EpisodeStageCard";
import {
  ClipboardList,
  CheckSquare,
  MessageSquare,
  ArrowRight,
} from "lucide-react";
import { format } from "date-fns";
import { hu } from "date-fns/locale";
import { useRemoteData } from "@/hooks/useRemoteData";
import { RemoteDataState } from "@/components/ui/RemoteDataState";
import { PatientNextAction } from "@/components/PatientNextAction";
import { selectPatientNextStep } from "@/lib/patient-next-step";

type CommType = "message" | "phone" | "in_person" | "other";
const COMM_TYPE_LABELS: Record<CommType, string> = {
  message: "Üzenet",
  phone: "Telefonhívás",
  in_person: "Személyes",
  other: "Egyéb",
};

interface CommLogRow {
  id: string;
  communicationType: CommType;
  subject: string | null;
  content: string;
  createdAt: string;
}

interface TaskRow {
  id: string;
  title: string;
  dueAt: string | null;
  assigneeName: string | null;
}

interface PatientOverviewTabProps {
  patient: Patient;
  /** A beteg ablakai közti navigáció (deep-link más fülre). */
  onGoToTab: (tab: string) => void;
  /** Ugrás a terv-hub oldalra (/patients/[id]/stages) — foglalási jogosultsággal. */
  onGoToScheduling?: () => void;
  canSeeClinical?: boolean;
}

function CardShell({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-3.5 sm:p-4 flex flex-col">
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="text-gray-500 dark:text-gray-400">{icon}</span>
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {title}
        </span>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="ml-auto py-1 text-sm text-blue-700 dark:text-blue-300 hover:underline inline-flex items-center gap-0.5"
          >
            {action.label}
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

/**
 * „Áttekintés” fül — összefoglaló dashboard, ami a korábban szétszórt
 * (különböző füleken elásott) információkat egy olvasható nézetbe gyűjti.
 * Főleg olvasható: minden kártya deep-linkel a részletes fülre.
 */
export function PatientOverviewTab({
  patient,
  onGoToTab,
  onGoToScheduling,
  canSeeClinical = true,
}: PatientOverviewTabProps) {
  const patientId = patient.id;
  const nextSteps = useRemoteData<{ items: WorklistItemBackend[] }>(
    patientId && canSeeClinical
      ? `/api/worklists/wip-next-appointments?patientId=${encodeURIComponent(patientId)}`
      : null,
  );
  const taskData = useRemoteData<{ tasks: TaskRow[] }>(
    patientId ? `/api/patients/${patientId}/tasks` : null,
  );
  const logData = useRemoteData<{ logs: CommLogRow[] }>(
    patientId ? `/api/communication-logs?patientId=${patientId}` : null,
  );
  const nextStep = selectPatientNextStep(
    nextSteps.data?.items ?? [],
    patientId ?? "",
  );
  const tasks = taskData.data?.tasks ?? [];
  const logs = (logData.data?.logs ?? []).slice(0, 3);

  return (
    <div className="space-y-4 sm:space-y-6">
      {canSeeClinical && (
        <section
          aria-label="Következő teendő"
          className="rounded-xl border border-blue-200 bg-blue-50 p-4 sm:p-5 dark:border-blue-900 dark:bg-blue-950/40"
        >
          <h2 className="mb-3 text-sm font-medium text-blue-800 dark:text-blue-200">
            Következő teendő
          </h2>
          <RemoteDataState
            status={nextSteps.status}
            label="A következő teendő"
            onRetry={nextSteps.retry}
          >
            <PatientNextAction
              item={nextStep}
              doctor={patient.kezeleoorvos}
              onGoToScheduling={onGoToScheduling}
            />
          </RemoteDataState>
        </section>
      )}
      {/* Ellátási útvonal — epizód + stádium + idővonal */}
      {patientId && (
        <EpisodeStageCard
          patientId={patientId}
          patientName={patient.nev}
          patientReason={patient.kezelesreErkezesIndoka}
          isDeceased={Boolean(patient.halalDatum)}
        />
      )}

      {/* Összefoglaló kártyák */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {/* Beutaló */}
        <CardShell
          icon={<ClipboardList className="w-4 h-4" />}
          title="Beutaló"
          action={{
            label: "Törzsadatok",
            onClick: () => onGoToTab("torzsadatok"),
          }}
        >
          {patient.beutaloOrvos ||
          patient.beutaloIntezmeny ||
          patient.szovettaniDiagnozis ? (
            <div className="space-y-0.5">
              {patient.beutaloOrvos && (
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {patient.beutaloOrvos}
                </p>
              )}
              {patient.beutaloIntezmeny && (
                <p className="text-[13px] text-gray-600 dark:text-gray-400">
                  {patient.beutaloIntezmeny}
                </p>
              )}
              {patient.szovettaniDiagnozis && (
                <p className="text-[13px] text-gray-600 dark:text-gray-400">
                  Dg.: {patient.szovettaniDiagnozis}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-gray-500 dark:text-gray-400">
              Nincs beutaló adat rögzítve.
            </p>
          )}
        </CardShell>

        {/* Nyitott feladatok */}
        <CardShell
          icon={<CheckSquare className="w-4 h-4" />}
          title={`Nyitott feladatok${tasks.length ? ` (${tasks.length})` : ""}`}
          action={{
            label: "Admin",
            onClick: () => onGoToTab("adminisztracio"),
          }}
        >
          <RemoteDataState
            status={taskData.status}
            label="A feladatok"
            onRetry={taskData.retry}
          >
            {tasks.length > 0 ? (
              <ul className="space-y-1.5">
                {tasks.slice(0, 3).map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start gap-2 text-[13px] text-gray-700 dark:text-gray-300"
                  >
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 dark:bg-amber-500 shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate">{t.title}</span>
                      {(t.dueAt || t.assigneeName) && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {t.assigneeName ?? ""}
                          {t.dueAt
                            ? `${t.assigneeName ? " · " : ""}${format(new Date(t.dueAt), "MMM d.", { locale: hu })}`
                            : ""}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
                {tasks.length > 3 && (
                  <li className="text-xs text-gray-500 dark:text-gray-400">
                    +{tasks.length - 3} további
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-[13px] text-gray-500 dark:text-gray-400">
                Nincs nyitott feladat.
              </p>
            )}
          </RemoteDataState>
        </CardShell>

        {/* Friss kommunikáció */}
        <CardShell
          icon={<MessageSquare className="w-4 h-4" />}
          title="Friss kommunikáció"
          action={{
            label: "Kommunikáció",
            onClick: () => onGoToTab("kommunikacio"),
          }}
        >
          <RemoteDataState
            status={logData.status}
            label="A kommunikáció"
            onRetry={logData.retry}
          >
            {logs.length > 0 ? (
              <ul className="space-y-1.5">
                {logs.map((l) => (
                  <li
                    key={l.id}
                    className="text-[13px] text-gray-700 dark:text-gray-300"
                  >
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {COMM_TYPE_LABELS[l.communicationType]}
                    </span>
                    {" — "}
                    <span className="text-gray-600 dark:text-gray-400">
                      {l.subject || l.content}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                      ·{" "}
                      {format(new Date(l.createdAt), "MMM d.", { locale: hu })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-gray-500 dark:text-gray-400">
                Nincs rögzített kommunikáció.
              </p>
            )}
          </RemoteDataState>
        </CardShell>
      </div>
    </div>
  );
}

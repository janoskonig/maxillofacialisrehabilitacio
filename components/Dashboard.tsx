"use client";

import { useState, useEffect, useCallback } from "react";
import { RemoteDataState } from "./ui/RemoteDataState";
import Link from "next/link";
import { TodaysAppointmentsWidget } from "./widgets/TodaysAppointmentsWidget";
import { PendingApprovalsWidget } from "./widgets/PendingApprovalsWidget";
import {
  ClipboardList,
  MessageCircle,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { Patient } from "@/lib/types";
import { EmptyState } from "./ui/EmptyState";
import { useStaffTaskSummary } from "@/hooks/useStaffTaskSummary";
import { useStaffInboxSummary } from "@/hooks/useStaffInboxSummary";

interface DashboardData {
  nextAppointments: any[];
  pendingAppointments: any[];
  newRegistrations: any[];
}

interface DashboardProps {
  userRole?: string;
  showAppointments?: boolean;
  onViewPatient?: (patient: Patient) => void;
  onEditPatient?: (patient: Patient) => void;
  onViewOP?: (patient: Patient) => void;
  onViewFoto?: (patient: Patient) => void;
}

/**
 * Teendő-központú főoldali panel: a napi, ténylegesen elvégzendő dolgokat
 * emeli ki (jóváhagyásra váró időpontok, mai időpontok) + gyors belépők a
 * nyitott feladatokhoz és olvasatlan üzenetekhez. A korábbi tabos „Dashboard"
 * (GANTT / terhelés / pipeline) kikerült a saját oldalaira.
 */
export function Dashboard({ showAppointments = true }: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const {
    summary: taskSummary,
    loading: tasksLoading,
    refetch: retryTasks,
  } = useStaffTaskSummary(true);
  const {
    summary: inboxSummary,
    loading: inboxLoading,
    refetch: retryInbox,
  } = useStaffInboxSummary(true);

  const refreshData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboard", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Teendők nem tölthetők be.");
      setData(await response.json());
    } catch {
      setError("Teendők nem tölthetők be.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  if (loading || error || !data) {
    return (
      <RemoteDataState
        status={loading ? "loading" : "error"}
        label="A teendők"
        onRetry={refreshData}
      >
        {null}
      </RemoteDataState>
    );
  }

  const openTasks = taskSummary?.totalOpen ?? 0;
  const unreadMessages =
    (inboxSummary?.patientUnread ?? 0) + (inboxSummary?.doctorUnread ?? 0);

  const hasPending = data.pendingAppointments.length > 0;
  const hasToday = showAppointments && data.nextAppointments.length > 0;
  const hasChips = openTasks > 0 || unreadMessages > 0;
  const nothingToDo =
    !tasksLoading &&
    !inboxLoading &&
    taskSummary !== null &&
    inboxSummary !== null &&
    !hasPending &&
    !hasToday &&
    !hasChips;

  return (
    <section className="space-y-3 md:space-y-4" aria-label="Teendőim">
      <h2 className="text-heading-3">Teendőim</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <RemoteDataState
          status={tasksLoading ? "loading" : taskSummary ? "success" : "error"}
          label="A feladatösszesítő"
          onRetry={retryTasks}
        >
          {null}
        </RemoteDataState>
        <RemoteDataState
          status={inboxLoading ? "loading" : inboxSummary ? "success" : "error"}
          label="Az üzenetösszesítő"
          onRetry={retryInbox}
        >
          {null}
        </RemoteDataState>
      </div>
      {nothingToDo ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nincs nyitott teendő."
          description="Nincs jóváhagyásra váró kérés, nyitott feladat vagy olvasatlan üzenet."
        />
      ) : (
        <>
          {hasChips && (
            <div className="flex flex-wrap gap-2">
              {openTasks > 0 && (
                <Link
                  href="/tasks"
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  <ClipboardList className="w-4 h-4" />
                  <span className="font-medium">{openTasks}</span>
                  nyitott feladat
                  <ChevronRight className="w-4 h-4 opacity-60" />
                </Link>
              )}
              {unreadMessages > 0 && (
                <Link
                  href="/messages"
                  className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 transition-colors hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-900/40"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span className="font-medium">{unreadMessages}</span>
                  olvasatlan üzenet
                  <ChevronRight className="w-4 h-4 opacity-60" />
                </Link>
              )}
            </div>
          )}

          {(hasPending || hasToday) && (
            <div
              className={`grid gap-4 ${hasPending && hasToday ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}
            >
              {hasPending && (
                <PendingApprovalsWidget approvals={data.pendingAppointments} />
              )}
              {hasToday && (
                <TodaysAppointmentsWidget
                  appointments={data.nextAppointments}
                  onUpdate={refreshData}
                />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

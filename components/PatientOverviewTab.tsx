'use client';

import { useEffect, useState } from 'react';
import { Patient } from '@/lib/types';
import type { WorklistItemBackend } from '@/lib/worklist-types';
import { EpisodeStageCard } from '@/components/EpisodeStageCard';
import {
  ClipboardList,
  CalendarClock,
  CheckSquare,
  MessageSquare,
  ArrowRight,
  ArrowUpRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';

type CommType = 'message' | 'phone' | 'in_person' | 'other';
const COMM_TYPE_LABELS: Record<CommType, string> = {
  message: 'Üzenet',
  phone: 'Telefonhívás',
  in_person: 'Személyes',
  other: 'Egyéb',
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
    <div className="bg-white rounded-lg border border-gray-200 p-3.5 sm:p-4 flex flex-col">
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="text-gray-400">{icon}</span>
        <span className="text-xs font-medium text-gray-500">{title}</span>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="ml-auto text-xs text-medical-primary hover:underline inline-flex items-center gap-0.5"
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
  canSeeClinical = true,
}: PatientOverviewTabProps) {
  const [nextStep, setNextStep] = useState<WorklistItemBackend | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [logs, setLogs] = useState<CommLogRow[]>([]);
  const patientId = patient.id;

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;

    const loadNextStep = async () => {
      if (!canSeeClinical) return;
      try {
        const res = await fetch(
          `/api/worklists/wip-next-appointments?patientId=${encodeURIComponent(patientId)}`,
          { credentials: 'include' }
        );
        if (!res.ok) return;
        const data = await res.json();
        const items: WorklistItemBackend[] = data.items ?? [];
        if (items.length === 0) return;
        const sorted = [...items].sort((a, b) => {
          const epA = a.episodeOrder ?? 0;
          const epB = b.episodeOrder ?? 0;
          if (epA !== epB) return epA - epB;
          return (a.stepSeq ?? 0) - (b.stepSeq ?? 0);
        });
        if (!cancelled) setNextStep(sorted[0]);
      } catch {
        /* non-critical */
      }
    };

    const loadTasks = async () => {
      try {
        const res = await fetch(`/api/patients/${patientId}/tasks`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setTasks(data.tasks ?? []);
      } catch {
        /* non-critical */
      }
    };

    const loadLogs = async () => {
      try {
        const res = await fetch(`/api/communication-logs?patientId=${patientId}`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && !cancelled) setLogs((data.logs ?? []).slice(0, 3));
      } catch {
        /* non-critical */
      }
    };

    loadNextStep();
    loadTasks();
    loadLogs();
    return () => {
      cancelled = true;
    };
  }, [patientId, canSeeClinical]);

  const windowStart = nextStep?.bookableWindowStart || nextStep?.windowStart;
  const windowEnd = nextStep?.bookableWindowEnd || nextStep?.windowEnd;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Ellátási útvonal — epizód + stádium + idővonal */}
      {patientId && (
        <EpisodeStageCard
          patientId={patientId}
          patientName={patient.nev}
          patientReason={patient.kezelesreErkezesIndoka}
        />
      )}

      {/* Összefoglaló kártyák */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {/* Beutaló */}
        <CardShell
          icon={<ClipboardList className="w-4 h-4" />}
          title="Beutaló"
          action={{ label: 'Törzsadatok', onClick: () => onGoToTab('torzsadatok') }}
        >
          {patient.beutaloOrvos || patient.beutaloIntezmeny || patient.szovettaniDiagnozis ? (
            <div className="space-y-0.5">
              {patient.beutaloOrvos && (
                <p className="text-sm font-medium text-gray-900">{patient.beutaloOrvos}</p>
              )}
              {patient.beutaloIntezmeny && (
                <p className="text-[13px] text-gray-600">{patient.beutaloIntezmeny}</p>
              )}
              {patient.szovettaniDiagnozis && (
                <p className="text-[13px] text-gray-600">Dg.: {patient.szovettaniDiagnozis}</p>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-gray-400">Nincs beutaló adat rögzítve.</p>
          )}
        </CardShell>

        {/* Következő lépés / időpont */}
        {canSeeClinical && (
          <CardShell
            icon={<CalendarClock className="w-4 h-4" />}
            title="Következő lépés"
            action={{ label: 'Időpont', onClick: () => onGoToTab('terv_idopont') }}
          >
            {nextStep ? (
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-900">
                  {nextStep.stepLabel || nextStep.nextStep}
                </p>
                {windowStart && (
                  <p className="text-[13px] text-gray-600">
                    Ablak: {format(new Date(windowStart), 'yyyy. MMM d.', { locale: hu })}
                    {windowEnd ? ` – ${format(new Date(windowEnd), 'MMM d.', { locale: hu })}` : ''}
                  </p>
                )}
                {nextStep.overdueByDays > 0 && (
                  <p className="text-[13px] text-red-600">
                    {nextStep.overdueByDays} napja esedékes
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => onGoToTab('terv_idopont')}
                  className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-medical-primary hover:underline"
                >
                  Foglalás a munkalistán
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <p className="text-[13px] text-gray-400">Nincs következő munkafázis.</p>
            )}
          </CardShell>
        )}

        {/* Nyitott feladatok */}
        <CardShell
          icon={<CheckSquare className="w-4 h-4" />}
          title={`Nyitott feladatok${tasks.length ? ` (${tasks.length})` : ''}`}
          action={{ label: 'Admin', onClick: () => onGoToTab('adminisztracio') }}
        >
          {tasks.length > 0 ? (
            <ul className="space-y-1.5">
              {tasks.slice(0, 3).map((t) => (
                <li key={t.id} className="flex items-start gap-2 text-[13px] text-gray-700">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate">{t.title}</span>
                    {(t.dueAt || t.assigneeName) && (
                      <span className="text-[11px] text-gray-400">
                        {t.assigneeName ?? ''}
                        {t.dueAt
                          ? `${t.assigneeName ? ' · ' : ''}${format(new Date(t.dueAt), 'MMM d.', { locale: hu })}`
                          : ''}
                      </span>
                    )}
                  </span>
                </li>
              ))}
              {tasks.length > 3 && (
                <li className="text-[11px] text-gray-400">+{tasks.length - 3} további</li>
              )}
            </ul>
          ) : (
            <p className="text-[13px] text-gray-400">Nincs nyitott feladat.</p>
          )}
        </CardShell>

        {/* Friss kommunikáció */}
        <CardShell
          icon={<MessageSquare className="w-4 h-4" />}
          title="Friss kommunikáció"
          action={{ label: 'Kommunikáció', onClick: () => onGoToTab('kommunikacio') }}
        >
          {logs.length > 0 ? (
            <ul className="space-y-1.5">
              {logs.map((l) => (
                <li key={l.id} className="text-[13px] text-gray-700">
                  <span className="font-medium text-gray-900">
                    {COMM_TYPE_LABELS[l.communicationType]}
                  </span>
                  {' — '}
                  <span className="text-gray-600">{l.subject || l.content}</span>
                  <span className="text-[11px] text-gray-400 ml-1">
                    · {format(new Date(l.createdAt), 'MMM d.', { locale: hu })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-gray-400">Nincs rögzített kommunikáció.</p>
          )}
        </CardShell>
      </div>
    </div>
  );
}

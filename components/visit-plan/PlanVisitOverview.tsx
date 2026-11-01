'use client';

import type { ReactNode } from 'react';
import { CalendarDays, CheckCircle2, ChevronDown, Pencil } from 'lucide-react';
import {
  formatShortDateTime, phaseScopeText, summarizeVisitStatusV2,
  visitDateInfoV2, visitDisplayLabel, visitHasOpenAppointment, visitTotalMinutes,
  type EpisodeStep, type StepProjectionInfo, type VisitGroup,
} from './visit-plan-types';

interface Props {
  groups: VisitGroup[];
  unassignedCount: number;
  unattachedCount: number;
  projectionByPhaseId: Map<string, StepProjectionInfo>;
  getStepLabel: (step: EpisodeStep) => string;
  renderBooking: (group: VisitGroup) => ReactNode;
  onEdit: () => void;
  onManageAppointments?: (appointmentId?: string) => void;
}

/** The everyday view uses the same visits and booking actions as the plan editor. */
export function PlanVisitOverview({
  groups, unassignedCount, unattachedCount, projectionByPhaseId,
  getStepLabel, renderBooking, onEdit, onManageAppointments,
}: Props) {
  const remaining = groups.filter((g) => !['teljesult', 'kihagyva'].includes(summarizeVisitStatusV2(g.visit, g.primaries).key));
  const finished = groups.filter((g) => !remaining.includes(g));

  const renderRow = (group: VisitGroup, next = false) => {
    const { visit, phases, primaries } = group;
    const status = summarizeVisitStatusV2(visit, primaries);
    const booked = visitHasOpenAppointment(visit);
    const date = visitDateInfoV2(visit, primaries, projectionByPhaseId);
    const minutes = visitTotalMinutes(visit, primaries);
    const scopes = Array.from(new Set(phases.map(phaseScopeText).filter(Boolean)));
    const activePhases = phases.filter((p) => p.status !== 'skipped');
    // Canceled or missed appointments must never look like a secured slot.
    const dateText = booked && visit.appointmentStart
      ? formatShortDateTime(visit.appointmentStart)
      : date?.kind === 'window' ? `Tervezett: ${date.text}`
        : date?.kind === 'done' ? date.text : null;
    return (
      <li key={visit.id} className={`flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-4 ${next ? 'bg-blue-50/60 dark:bg-blue-950/20' : ''}`}>
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${next ? 'bg-medical-primary text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}>
          {status.key === 'teljesult' ? <CheckCircle2 className="h-4 w-4" /> : groups.indexOf(group) + 1}
        </div>
        <div className="min-w-0 flex-1">
          {next && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-medical-primary">Következő alkalom</p>}
          <p className="font-medium text-gray-900 dark:text-gray-100">{visitDisplayLabel(visit, activePhases, getStepLabel)}</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {[minutes != null ? `${minutes} perc` : null, ...scopes, status.key === 'teljesult' || status.key === 'kihagyva' ? status.label : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="sm:text-right text-sm">
          {dateText && <p className={booked ? 'font-medium text-blue-800 dark:text-blue-200' : 'text-gray-500 dark:text-gray-400'}>{dateText}</p>}
          {remaining.includes(group) && <p className={`text-xs ${booked ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}>{booked ? 'Időpont lefoglalva' : 'Nincs lefoglalt időpont'}</p>}
        </div>
        <div className="flex items-center gap-2 sm:justify-end sm:min-w-[100px]">
          {renderBooking(group)}
          {booked && onManageAppointments && <button type="button" onClick={() => onManageAppointments(visit.appointmentId ?? undefined)} className="text-xs font-medium text-medical-primary hover:underline">Státusz</button>}
          {phases.length === 0 && <button type="button" onClick={onEdit} className="text-xs font-medium text-medical-primary hover:underline">Kezelések megadása</button>}
        </div>
      </li>
    );
  };

  return (
    <div data-testid="plan-visit-overview">
      {remaining.length > 0 ? (
        <>
          <ol className="divide-y divide-gray-100 dark:divide-gray-800">{remaining.slice(0, 4).map((g, i) => renderRow(g, i === 0))}</ol>
          {remaining.length > 4 && <details className="border-t border-gray-100 dark:border-gray-800">
            <summary className="cursor-pointer px-4 py-3 text-sm text-medical-primary">További tervezett alkalmak ({remaining.length - 4})</summary>
            <ol className="divide-y divide-gray-100 dark:divide-gray-800">{remaining.slice(4).map((g) => renderRow(g))}</ol>
          </details>}
        </>
      ) : (
        <div className="px-4 py-7 text-center">
          <CalendarDays className="mx-auto mb-2 h-6 w-6 text-gray-400" />
          <p className="text-sm text-gray-600 dark:text-gray-400">{groups.length ? 'Nincs hátralévő tervezett alkalom.' : 'Még nincsenek összeállítva az elkészítési munkafázisok.'}</p>
          <button type="button" onClick={onEdit} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-medical-primary hover:underline"><Pencil className="h-3.5 w-3.5" />{groups.length ? 'Munkafázisok kiegészítése' : 'Munkafázisok összeállítása'}</button>
        </div>
      )}
      {(unassignedCount > 0 || unattachedCount > 0) && <div className="mx-4 my-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
        {unassignedCount > 0 && <p>{unassignedCount} kezelés még nincs alkalomhoz rendelve.</p>}
        {unattachedCount > 0 && <p>{unattachedCount} időpont még nincs a tervhez rendelve.</p>}
        <button type="button" onClick={onEdit} className="mt-1 font-medium underline">Hozzárendelés a tervben</button>
      </div>}
      {finished.length > 0 && <details className="group border-t border-gray-100 dark:border-gray-800">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm text-gray-500 dark:text-gray-400 [&::-webkit-details-marker]:hidden"><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />Lezárt alkalmak ({finished.length})</summary>
        <ol className="divide-y divide-gray-100 dark:divide-gray-800">{finished.map((g) => renderRow(g))}</ol>
      </details>}
    </div>
  );
}

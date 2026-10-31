'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import type { AftercareWorkspace } from '@/lib/aftercare/model';
import { withAftercareTimeline } from '@/lib/treatment-workspace';
import { EpisodeRow } from './TreatmentPlanGantt/EpisodeRow';
import { TimelineHeader } from './TreatmentPlanGantt/TimelineHeader';
import { StepPopover } from './TreatmentPlanGantt/StepPopover';
import { useTimelineRange } from './TreatmentPlanGantt/useTimelineRange';
import { useMaxMd } from './TreatmentPlanGantt/useMaxMd';
import type { TimelineEpisode, TimelineStep } from './TreatmentPlanGantt/types';

export function PatientTreatmentJourney({ episode, care, serverNow, onOpenStep }: {
  episode: TimelineEpisode;
  care: AftercareWorkspace | null;
  serverNow?: string | null;
  onOpenStep: (step: TimelineStep) => void;
}) {
  const journey = useMemo(() => withAftercareTimeline(episode, care), [episode, care]);
  const episodes = useMemo(() => [journey], [journey]);
  const axis = useTimelineRange('auto', episodes, serverNow ?? null);
  const [selected, setSelected] = useState<TimelineStep | null>(null);
  const isMobile = useMaxMd();
  const select = useCallback((_episode: TimelineEpisode, step: TimelineStep) => setSelected(step), []);
  const close = useCallback(() => setSelected(null), []);

  return <section aria-label="A kezelés idővonala" className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <h2 className="text-sm font-medium text-gray-600 dark:text-gray-300">Betegút</h2>
      <Link className="text-xs text-medical-primary hover:underline" href={`/treatment-plans?tplan_patient=${episode.patientId}&tplan_status=all&tplan_view=merged`}>Teljes GANTT nézet</Link>
    </div>
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <TimelineHeader t0={axis.t0} t1={axis.t1} toPercent={axis.toPercent} todayPercent={axis.todayPercent} trackMinWidth={640} height={36} />
        <EpisodeRow episode={journey} range={axis} toPercent={axis.toPercent} todayPercent={axis.todayPercent} trackMinWidth={640} trackHeight={52} hideSummary onStepSelect={select} />
      </div>
    </div>
    <StepPopover open={!!selected} step={selected} episode={journey} isMobile={isMobile} onClose={close} onOpenStep={onOpenStep} />
  </section>;
}

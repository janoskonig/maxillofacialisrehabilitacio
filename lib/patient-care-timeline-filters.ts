import type {
  CareTimelineEvent,
  CareTimelineFilterCategory,
  CareTimelineEventType,
} from '@/lib/types/patient-care-timeline';

const STAGE_TYPES: CareTimelineEventType[] = ['stage_change', 'milestone'];
const CONSILIUM_TYPES: CareTimelineEventType[] = [
  'consilium',
  'consilium_prep',
  'consilium_prep_link',
];
const TASK_TYPES: CareTimelineEventType[] = ['delegated_task', 'work_phase'];

export function filterCareTimelineEvents(
  events: CareTimelineEvent[],
  category: CareTimelineFilterCategory,
): CareTimelineEvent[] {
  if (category === 'all') return events;
  if (category === 'stage') return events.filter((e) => STAGE_TYPES.includes(e.type));
  if (category === 'consilium') return events.filter((e) => CONSILIUM_TYPES.includes(e.type));
  return events.filter((e) => TASK_TYPES.includes(e.type));
}

export const CARE_TIMELINE_FILTER_OPTIONS: { id: CareTimelineFilterCategory; label: string }[] = [
  { id: 'all', label: 'Mind' },
  { id: 'stage', label: 'Stádium' },
  { id: 'consilium', label: 'Konzílium' },
  { id: 'tasks', label: 'Feladatok' },
];

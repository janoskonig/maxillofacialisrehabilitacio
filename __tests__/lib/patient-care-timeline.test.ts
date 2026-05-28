import { describe, expect, it } from 'vitest';
import {
  pickEpisodeIdForDate,
  sortEventsNewestFirst,
} from '@/lib/patient-care-timeline';
import { filterCareTimelineEvents } from '@/lib/patient-care-timeline-filters';
import type { CareTimelineEvent } from '@/lib/types/patient-care-timeline';

describe('pickEpisodeIdForDate', () => {
  const episodes = [
    {
      id: 'ep-open',
      status: 'open',
      reason: null,
      chiefComplaint: null,
      caseTitle: null,
      openedAt: new Date('2024-01-01'),
      closedAt: null,
    },
    {
      id: 'ep-closed',
      status: 'closed',
      reason: null,
      chiefComplaint: null,
      caseTitle: null,
      openedAt: new Date('2022-01-01'),
      closedAt: new Date('2023-06-01'),
    },
  ];

  it('prefers episode covering the date', () => {
    const at = new Date('2023-03-01');
    expect(pickEpisodeIdForDate(episodes, at)).toBe('ep-closed');
  });

  it('falls back to open episode', () => {
    const at = new Date('2025-01-01');
    expect(pickEpisodeIdForDate(episodes, at)).toBe('ep-open');
  });

  it('returns null when no episodes', () => {
    expect(pickEpisodeIdForDate([], new Date())).toBeNull();
  });
});

describe('sortEventsNewestFirst', () => {
  it('orders by at descending', () => {
    const events: CareTimelineEvent[] = [
      {
        id: 'a',
        type: 'milestone',
        at: '2024-01-01T00:00:00.000Z',
        episodeId: 'ep1',
        payload: { code: 'X', label: 'X', note: null },
      },
      {
        id: 'b',
        type: 'milestone',
        at: '2025-01-01T00:00:00.000Z',
        episodeId: 'ep1',
        payload: { code: 'Y', label: 'Y', note: null },
      },
    ];
    const sorted = sortEventsNewestFirst(events);
    expect(sorted[0].id).toBe('b');
  });
});

describe('filterCareTimelineEvents', () => {
  const mixed: CareTimelineEvent[] = [
    {
      id: '1',
      type: 'stage_change',
      at: '2024-01-01T00:00:00.000Z',
      episodeId: 'ep',
      payload: {
        stageCode: 'STAGE_1',
        stageLabel: 'S1',
        note: null,
        authorDisplay: null,
      },
    },
    {
      id: '2',
      type: 'consilium',
      at: '2024-02-01T00:00:00.000Z',
      episodeId: 'ep',
      payload: {
        sessionId: 's',
        itemId: 'i',
        title: 'T',
        sessionStatus: 'closed',
        scheduledAt: '2024-02-01T00:00:00.000Z',
        discussed: true,
        verdictSummary: null,
      },
    },
    {
      id: '3',
      type: 'delegated_task',
      at: '2024-03-01T00:00:00.000Z',
      episodeId: 'ep',
      payload: {
        taskId: 't',
        title: 'Task',
        status: 'open',
        source: null,
        assigneeName: null,
        presentationPath: null,
        consiliumSessionId: null,
      },
    },
  ];

  it('filters consilium types', () => {
    const out = filterCareTimelineEvents(mixed, 'consilium');
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('consilium');
  });

  it('filters stage types including milestone', () => {
    const withMilestone: CareTimelineEvent[] = [
      ...mixed,
      {
        id: '4',
        type: 'milestone',
        at: '2024-04-01T00:00:00.000Z',
        episodeId: 'ep',
        payload: { code: 'OFFER_ACCEPTED', label: 'Elfogadva', note: null },
      },
    ];
    const out = filterCareTimelineEvents(withMilestone, 'stage');
    expect(out.map((e) => e.type)).toEqual(['stage_change', 'milestone']);
  });
});

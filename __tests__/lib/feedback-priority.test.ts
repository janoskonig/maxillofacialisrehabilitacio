import { describe, expect, it } from 'vitest';
import { classifyFeedbackPriority, priorityFromScore, scoreForPriority } from '@/lib/feedback-priority';

describe('classifyFeedbackPriority', () => {
  it('low priority for a suggestion without impact signals', () => {
    expect(classifyFeedbackPriority({ type: 'suggestion', description: 'Legyen sötétebb a fejléc.' })).toEqual({
      priority: 'low',
      score: 15,
      reasons: ['típus: suggestion'],
    });
  });

  it('high priority for an ordinary crash', () => {
    expect(classifyFeedbackPriority({ type: 'crash', description: 'Bezáródott az oldal.' }).priority).toBe('high');
  });

  it('critical priority for data loss', () => {
    const result = classifyFeedbackPriority({ type: 'bug', description: 'Mentéskor adatvesztés történt.' });
    expect(result.priority).toBe('critical');
    expect(result.score).toBe(80);
  });

  it('uses error logs as ranking evidence', () => {
    const result = classifyFeedbackPriority({
      type: 'error',
      description: 'Hiba történt.',
      errorLog: 'Service unavailable for all users',
    });
    expect(result.priority).toBe('critical');
    expect(result.reasons).toContain('szolgáltatáskiesésre utaló jelzés');
    expect(result.reasons).toContain('széles felhasználói hatásra utaló jelzés');
  });
});

describe('priority helpers', () => {
  it('maps score boundaries and manual priorities consistently', () => {
    expect(priorityFromScore(79)).toBe('high');
    expect(priorityFromScore(80)).toBe('critical');
    expect(scoreForPriority('critical')).toBe(90);
  });
});

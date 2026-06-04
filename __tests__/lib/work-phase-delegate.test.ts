import { describe, it, expect } from 'vitest';
import { workPhaseDelegateSchema } from '@/lib/work-phase-delegate';

describe('workPhaseDelegateSchema', () => {
  const assignee = '550e8400-e29b-41d4-a716-446655440000';

  it('requires assignee for single staff task', () => {
    const r = workPhaseDelegateSchema.safeParse({ mode: 'staff' });
    expect(r.success).toBe(false);
  });

  it('accepts single staff delegate', () => {
    const r = workPhaseDelegateSchema.safeParse({
      mode: 'staff',
      assigneeUserId: assignee,
    });
    expect(r.success).toBe(true);
  });

  it('requires at least two split items', () => {
    const r = workPhaseDelegateSchema.safeParse({
      mode: 'staff',
      assigneeUserId: assignee,
      splitItems: [{ label: 'only one' }],
    });
    expect(r.success).toBe(false);
  });

  it('accepts split with default assignee', () => {
    const r = workPhaseDelegateSchema.safeParse({
      mode: 'staff',
      assigneeUserId: assignee,
      splitItems: [
        { label: 'Csavar A' },
        { label: 'Csavar B' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('accepts split with per-item assignees', () => {
    const other = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const r = workPhaseDelegateSchema.safeParse({
      mode: 'staff',
      splitItems: [
        { label: 'Tétel 1', assigneeUserId: assignee },
        { label: 'Tétel 2', assigneeUserId: other },
      ],
    });
    expect(r.success).toBe(true);
  });
});

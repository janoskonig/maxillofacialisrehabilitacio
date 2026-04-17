import { describe, it, expect } from 'vitest';
import { toothTreatmentDelegateSchema } from '@/lib/tooth-treatment-delegate';

describe('toothTreatmentDelegateSchema', () => {
  it('requires assignee for staff mode', () => {
    const r = toothTreatmentDelegateSchema.safeParse({ mode: 'staff' });
    expect(r.success).toBe(false);
  });

  it('accepts staff with assignee', () => {
    const r = toothTreatmentDelegateSchema.safeParse({
      mode: 'staff',
      assigneeUserId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(r.success).toBe(true);
  });

  it('requires external label for external mode', () => {
    const r = toothTreatmentDelegateSchema.safeParse({ mode: 'external' });
    expect(r.success).toBe(false);
  });

  it('accepts external with label', () => {
    const r = toothTreatmentDelegateSchema.safeParse({
      mode: 'external',
      externalAssigneeLabel: 'Dr. Külső — +3630…',
    });
    expect(r.success).toBe(true);
  });
});

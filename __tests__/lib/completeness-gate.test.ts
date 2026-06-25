import { describe, it, expect } from 'vitest';
import {
  decideClinicalGate,
  canOverrideClinicalGate,
  type GateCompletenessRow,
} from '@/lib/completeness-gate';

const incompleteRow: GateCompletenessRow = {
  clinicalComplete: false,
  clinicalMissing: [
    { key: 'taj', label: 'TAJ' },
    { key: 'doc:op', label: 'OP röntgenfelvétel' },
  ],
};

const completeRow: GateCompletenessRow = {
  clinicalComplete: true,
  clinicalMissing: [],
};

describe('canOverrideClinicalGate', () => {
  it('admin and fogpótlástanász may override', () => {
    expect(canOverrideClinicalGate('admin')).toBe(true);
    expect(canOverrideClinicalGate('fogpótlástanász')).toBe(true);
  });
  it('beutalo_orvos and technikus may not override', () => {
    expect(canOverrideClinicalGate('beutalo_orvos')).toBe(false);
    expect(canOverrideClinicalGate('technikus')).toBe(false);
  });
});

describe('decideClinicalGate', () => {
  it('allows when the patient row is unknown (null)', () => {
    expect(decideClinicalGate(null, { role: 'fogpótlástanász' })).toEqual({ kind: 'allow' });
  });

  it('allows when clinical data is complete', () => {
    expect(decideClinicalGate(completeRow, { role: 'beutalo_orvos' })).toEqual({ kind: 'allow' });
  });

  it('blocks with 422 + missing list when incomplete and not forced', () => {
    const d = decideClinicalGate(incompleteRow, { role: 'fogpótlástanász' });
    expect(d.kind).toBe('block');
    if (d.kind === 'block') {
      expect(d.status).toBe(422);
      expect(d.body.error).toBe('CLINICAL_DATA_INCOMPLETE');
      expect(d.body.canOverride).toBe(true);
      expect(d.body.missing).toEqual(incompleteRow.clinicalMissing);
    }
  });

  it('reports canOverride=false for a referrer in the block payload', () => {
    const d = decideClinicalGate(incompleteRow, { role: 'beutalo_orvos' });
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.body.canOverride).toBe(false);
  });

  it('forbids override (403) for a non-privileged role even with force + reason', () => {
    const d = decideClinicalGate(incompleteRow, {
      role: 'beutalo_orvos',
      force: true,
      overrideReason: 'sürgős',
    });
    expect(d.kind).toBe('block');
    if (d.kind === 'block') {
      expect(d.status).toBe(403);
      expect(d.body.error).toBe('OVERRIDE_NOT_ALLOWED');
    }
  });

  it('requires a reason (422) when an authorized role forces without one', () => {
    const d = decideClinicalGate(incompleteRow, { role: 'admin', force: true, overrideReason: '   ' });
    expect(d.kind).toBe('block');
    if (d.kind === 'block') {
      expect(d.status).toBe(422);
      expect(d.body.error).toBe('OVERRIDE_REASON_REQUIRED');
    }
  });

  it('permits override (with audit summary) for an authorized role + reason', () => {
    const d = decideClinicalGate(incompleteRow, {
      role: 'fogpótlástanász',
      force: true,
      overrideReason: 'Sürgős eset, az adat utólag pótolva lesz',
    });
    expect(d.kind).toBe('override');
    if (d.kind === 'override') {
      expect(d.missingSummary).toBe('TAJ, OP röntgenfelvétel');
    }
  });
});

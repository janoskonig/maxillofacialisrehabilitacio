import { describe, it, expect } from 'vitest';
import { computeObligations, noticeAcknowledgedSql } from '@/lib/consent-obligations';

describe('computeObligations', () => {
  it('flags both when nothing is done', () => {
    const o = computeObligations('unknown', false);
    expect(o).toMatchObject({
      needsNoticeAck: true,
      needsResearch: true,
      needsAction: true,
      researchDecided: false,
    });
  });

  it('treats pending research as still undecided', () => {
    const o = computeObligations('pending', true);
    expect(o.needsNoticeAck).toBe(false);
    expect(o.needsResearch).toBe(true);
    expect(o.needsAction).toBe(true);
  });

  it('clears the obligation once research is granted and notice acknowledged', () => {
    const o = computeObligations('granted', true);
    expect(o.needsAction).toBe(false);
    expect(o.needsResearch).toBe(false);
    expect(o.needsNoticeAck).toBe(false);
  });

  it('treats a declined research decision as resolved', () => {
    const o = computeObligations('declined', true);
    expect(o.researchDecided).toBe(true);
    expect(o.needsResearch).toBe(false);
    expect(o.needsAction).toBe(false);
  });

  it('keeps reminding for the notice even after research is declined', () => {
    const o = computeObligations('declined', false);
    expect(o.needsResearch).toBe(false);
    expect(o.needsNoticeAck).toBe(true);
    expect(o.needsAction).toBe(true);
  });

  it('treats withdrawn/expired research as decided', () => {
    expect(computeObligations('withdrawn', true).needsResearch).toBe(false);
    expect(computeObligations('expired', true).needsResearch).toBe(false);
  });
});

describe('noticeAcknowledgedSql', () => {
  it('checks the current policy version for the given alias', () => {
    const sql = noticeAcknowledgedSql('pat', '$2');
    expect(sql).toContain('pat.id');
    expect(sql).toContain('privacy_notice_acknowledgements');
    expect(sql).toContain('policy_version = $2');
  });

  it('defaults the alias to p and the version param to $1', () => {
    const sql = noticeAcknowledgedSql();
    expect(sql).toContain('p.id');
    expect(sql).toContain('policy_version = $1');
  });
});

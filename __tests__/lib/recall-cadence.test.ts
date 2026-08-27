import { describe, expect, it } from 'vitest';
import {
  RECALL_CADENCE_DAYS,
  RECALL_RISK_LEVELS,
  isRecallRiskLevel,
  normalizeRecallRiskLevel,
  recallCadenceForRisk,
  recallLabelForInterval,
} from '@/lib/recall-cadence';

describe('recall kadencia-katalógus (WP-3.2)', () => {
  it('a low kadencia a mai viselkedés: 6 és 12 hónap', () => {
    expect(RECALL_CADENCE_DAYS.low).toEqual([180, 365]);
  });

  it('medium és high fokozatosan sűrűbb, és mind tartalmazza a low napjait', () => {
    expect(RECALL_CADENCE_DAYS.medium).toEqual([90, 180, 365]);
    expect(RECALL_CADENCE_DAYS.high).toEqual([30, 90, 180, 365]);
    for (const level of RECALL_RISK_LEVELS) {
      for (const day of RECALL_CADENCE_DAYS.low) {
        expect(RECALL_CADENCE_DAYS[level]).toContain(day);
      }
    }
  });

  it('minden kadencia pozitív, szigorúan növekvő napokból áll', () => {
    for (const level of RECALL_RISK_LEVELS) {
      const days = RECALL_CADENCE_DAYS[level];
      expect(days.length).toBeGreaterThan(0);
      for (let i = 0; i < days.length; i++) {
        expect(Number.isInteger(days[i])).toBe(true);
        expect(days[i]).toBeGreaterThan(0);
        if (i > 0) expect(days[i]).toBeGreaterThan(days[i - 1]);
      }
    }
  });

  it('rizikószint nélkül (NULL / ismeretlen) a low kadenciát adja — a mai viselkedést', () => {
    expect(normalizeRecallRiskLevel(null)).toBe('low');
    expect(normalizeRecallRiskLevel(undefined)).toBe('low');
    expect(normalizeRecallRiskLevel('nagyon-magas')).toBe('low');
    expect(recallCadenceForRisk(null)).toEqual(RECALL_CADENCE_DAYS.low);
    expect(recallCadenceForRisk('medium')).toEqual(RECALL_CADENCE_DAYS.medium);
    expect(recallCadenceForRisk('high')).toEqual(RECALL_CADENCE_DAYS.high);
  });

  it('isRecallRiskLevel csak a három érvényes szintet fogadja el', () => {
    expect(isRecallRiskLevel('low')).toBe(true);
    expect(isRecallRiskLevel('medium')).toBe(true);
    expect(isRecallRiskLevel('high')).toBe(true);
    expect(isRecallRiskLevel('LOW')).toBe(false);
    expect(isRecallRiskLevel('')).toBe(false);
    expect(isRecallRiskLevel(42)).toBe(false);
    expect(isRecallRiskLevel(null)).toBe(false);
  });

  it('emberi címkét ad az intervallumokhoz (a 088-as backfill-lel egyezően)', () => {
    expect(recallLabelForInterval(180)).toBe('6 hónapos kontroll');
    expect(recallLabelForInterval(365)).toBe('12 hónapos kontroll');
    expect(recallLabelForInterval(730)).toBe('24 hónapos kontroll');
    expect(recallLabelForInterval(90)).toBe('3 hónapos kontroll');
    expect(recallLabelForInterval(30)).toBe('1 hónapos kontroll');
    expect(recallLabelForInterval(21)).toBe('3 hetes kontroll');
    expect(recallLabelForInterval(14)).toBe('2 hetes kontroll');
    expect(recallLabelForInterval(7)).toBe('1 hetes kontroll');
    expect(recallLabelForInterval(10)).toBe('10 napos kontroll');
    expect(recallLabelForInterval(1)).toBe('1 napos kontroll');
  });

  it('a teljes kadencia-katalógus minden napjára van címke', () => {
    for (const level of RECALL_RISK_LEVELS) {
      for (const day of RECALL_CADENCE_DAYS[level]) {
        expect(recallLabelForInterval(day)).toMatch(/kontroll$/);
      }
    }
  });
});

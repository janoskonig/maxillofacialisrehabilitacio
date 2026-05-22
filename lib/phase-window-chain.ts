/**
 * Munkafázis ablakok láncolása: egy korábbi foglalás / teljesítés után
 * a következő fázis nem lehet korábbi, mint előző tényleges időpont + offset.
 * (Ugyanaz a szabály, mint convert-all-intents chainMinStartTime.)
 */

import { computeStepWindow } from './step-window';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PhaseWindowChainRow {
  workPhaseCode: string;
  defaultDaysOffset: number;
  status: 'pending' | 'scheduled' | 'completed' | 'skipped';
  completedAt: Date | null;
  /** Jövőbeli aktív foglalás kezdete (ha van). */
  bookedStart: Date | null;
}

export interface PhaseWindowChainResult {
  windowStart: Date;
  windowEnd: Date;
  expectedDate: Date;
  /** Alsó korlát: max(pathway windowStart, előző hard start + offset). */
  earliestAllowedStart: Date;
}

/**
 * Epizód munkafázisai pathway sorrendben — ablakok és lánc-minimum.
 */
export function computePhaseWindowChain(
  phases: PhaseWindowChainRow[],
  initialAnchor: Date
): Map<string, PhaseWindowChainResult> {
  const out = new Map<string, PhaseWindowChainResult>();
  let anchor = new Date(initialAnchor);
  let prevHardStart: Date | null = null;

  for (const phase of phases) {
    const offset = phase.defaultDaysOffset;
    const { windowStart, windowEnd, expectedDate } = computeStepWindow(anchor, offset);

    let earliestAllowedStart = windowStart;
    if (prevHardStart) {
      const chainMin = new Date(prevHardStart.getTime() + offset * MS_PER_DAY);
      if (chainMin.getTime() > earliestAllowedStart.getTime()) {
        earliestAllowedStart = chainMin;
      }
    }

    out.set(phase.workPhaseCode, {
      windowStart,
      windowEnd,
      expectedDate,
      earliestAllowedStart,
    });

    const hard =
      phase.completedAt != null
        ? new Date(phase.completedAt)
        : phase.bookedStart != null
          ? new Date(phase.bookedStart)
          : null;

    if (hard) {
      anchor = hard;
      prevHardStart = hard;
    } else {
      anchor = expectedDate;
    }
  }

  return out;
}

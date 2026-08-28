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

/** WP-4.2: vizit-tudatos lánc-sor — a rowKey a konkrét EWP sor azonosítója. */
export interface VisitAwareChainRow extends PhaseWindowChainRow {
  /** Sor-szintű kulcs (episode_work_phases.id, vagy determinisztikus fallback). */
  rowKey: string;
  /** A sor vizitje; NULL/undefined = a sor önálló (egyfős) láncegység. */
  visitId?: string | null;
  /** A vizit days_offset-je („ennyi nappal az előző alkalom után"); NULL → fallback a fázis offsetjére. */
  visitDaysOffset?: number | null;
}

/**
 * WP-4.2: vizit-tudatos ablak-lánc. Egy vizit ("Alkalom") fázisai EGY
 * alkalomnak számítanak: a vizit-tagok között nincs nap-eltolás, minden tag a
 * vizit ablakát kapja; a vizitek között a CÉL-vizit days_offset-je a lépésköz
 * (fallback: a vizit első fázisának default_days_offset-je).
 *
 * A láncegységek sorrendje a fázis-lista sorrendje (első tag pozíciója) —
 * ez a mai COALESCE(seq, pathway_order_index) rendezéssel konzisztens.
 *
 * Kompatibilitási invariáns (tesztelt): ahol minden vizit egyfős és a
 * days_offset a fázisból jött (backfill-állapot), a kimenet megegyezik a
 * computePhaseWindowChain mai értékeivel. Vizit-mező nélküli sorok (legacy
 * séma / hiányzó visit_id) egyfős egységként viselkednek — a mai működés.
 *
 * A visszaadott Map kulcsa a rowKey (sor-szintű), így a duplikált
 * work_phase_code-ú testvérek nem írják felül egymás ablakát.
 */
export function computeVisitAwareWindowChain(
  rows: VisitAwareChainRow[],
  initialAnchor: Date
): Map<string, PhaseWindowChainResult> {
  // 1) Egységekbe csoportosítás: vizit szerint, az első tag pozíciójának
  //    sorrendjében; vizit nélküli sor önálló egység.
  interface ChainUnit {
    offset: number;
    completedAt: Date | null;
    bookedStart: Date | null;
    memberKeys: string[];
  }
  const units: ChainUnit[] = [];
  const unitByVisit = new Map<string, ChainUnit>();

  for (const row of rows) {
    const existing = row.visitId ? unitByVisit.get(row.visitId) : undefined;
    if (existing) {
      existing.memberKeys.push(row.rowKey);
      // A vizit ténye (teljesítés/foglalás) bármely tagból jöhet: a
      // legkésőbbi teljesítés, ill. a legkorábbi jövőbeli foglalás számít.
      if (row.completedAt && (!existing.completedAt || row.completedAt > existing.completedAt)) {
        existing.completedAt = row.completedAt;
      }
      if (row.bookedStart && (!existing.bookedStart || row.bookedStart < existing.bookedStart)) {
        existing.bookedStart = row.bookedStart;
      }
      continue;
    }
    const unit: ChainUnit = {
      offset: row.visitDaysOffset ?? row.defaultDaysOffset,
      completedAt: row.completedAt,
      bookedStart: row.bookedStart,
      memberKeys: [row.rowKey],
    };
    units.push(unit);
    if (row.visitId) unitByVisit.set(row.visitId, unit);
  }

  // 2) Lánc-séta egységenként — a computePhaseWindowChain algoritmusa.
  const out = new Map<string, PhaseWindowChainResult>();
  let anchor = new Date(initialAnchor);
  let prevHardStart: Date | null = null;

  for (const unit of units) {
    const { windowStart, windowEnd, expectedDate } = computeStepWindow(anchor, unit.offset);

    let earliestAllowedStart = windowStart;
    if (prevHardStart) {
      const chainMin = new Date(prevHardStart.getTime() + unit.offset * MS_PER_DAY);
      if (chainMin.getTime() > earliestAllowedStart.getTime()) {
        earliestAllowedStart = chainMin;
      }
    }

    const result: PhaseWindowChainResult = {
      windowStart,
      windowEnd,
      expectedDate,
      earliestAllowedStart,
    };
    for (const key of unit.memberKeys) out.set(key, result);

    const hard = unit.completedAt ?? unit.bookedStart ?? null;
    if (hard) {
      anchor = hard;
      prevHardStart = hard;
    } else {
      anchor = expectedDate;
    }
  }

  return out;
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

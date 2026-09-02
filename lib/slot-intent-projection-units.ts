/**
 * Vizit-tudatos vetítési egységek a slot-intent projektorhoz (pure).
 *
 * Egy vizit („alkalom") fázisai EGY alkalomra esnek: közös ablakot és közös
 * javasolt kezdést kapnak, a horgony pedig csak az egység után lép tovább —
 * a vizitek között a vizit `days_offset`-je a lépésköz (fallback: az első tag
 * fázis-offsetje). Ugyanaz a csoportosítási szabály, mint a
 * `computeVisitAwareWindowChain`-ben (lib/phase-window-chain.ts): a tagok a
 * vizit ELSŐ előfordulásának pozíciójához tartoznak; vizit nélküli sor önálló
 * egyfős egység — a korábbi, soronkénti működés.
 */

export interface ProjectionStepLike {
  /** A sor vizitje; null/undefined = önálló egység. */
  visitId?: string | null;
  /** A vizit days_offset-je; null → a sor saját offsetje a fallback. */
  visitDaysOffset?: number | null;
  /** A sor saját (fázis-szintű) offsetje — csak fallback. */
  offset: number;
}

export interface ProjectionUnit<T extends ProjectionStepLike> {
  /** Az egység lépésköze napokban az előző egység után. */
  offset: number;
  members: T[];
}

export function groupProjectionUnits<T extends ProjectionStepLike>(
  steps: T[]
): ProjectionUnit<T>[] {
  const units: ProjectionUnit<T>[] = [];
  const unitByVisit = new Map<string, ProjectionUnit<T>>();
  for (const step of steps) {
    const existing = step.visitId ? unitByVisit.get(step.visitId) : undefined;
    if (existing) {
      existing.members.push(step);
      continue;
    }
    const unit: ProjectionUnit<T> = {
      offset: step.visitDaysOffset ?? step.offset,
      members: [step],
    };
    units.push(unit);
    if (step.visitId) unitByVisit.set(step.visitId, unit);
  }
  return units;
}

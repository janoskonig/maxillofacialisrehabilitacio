/**
 * Plan sequence check — pure detection of out-of-sequence BOOKED appointments.
 *
 * Célfunkció (#3): a munkafázisok megismételhetők (sikertelenség stb.); ekkor a
 * lépéseknek a foglalt időpontokon csúszniuk kell, és új időpont is foglalandó.
 *
 * A rendszer a MÉG LE NEM FOGLALT ablakokat automatikusan újraszámolja
 * (slot-intent-projector). A MÁR LEFOGLALT későbbi időpontokat viszont
 * szándékosan NEM mozgatjuk automatikusan (valós betegidőpontok) — helyette
 * észleljük, ha a sorrend felborult, és jelezzük, hogy újrafoglalás kell.
 *
 * Egy lefoglalt fázis akkor "out of sequence", ha egy NÁLA KORÁBBI, még be nem
 * fejezett (nem completed/skipped) fázis nincs előbb elvégezve / lefoglalva:
 *  - EARLIER_PHASE_NOT_DONE      — a korábbi fázis nincs befejezve és nincs is foglalva,
 *  - EARLIER_PHASE_BOOKED_LATER  — a korábbi fázis foglalt időpontja későbbre esik.
 */

export type SequenceViolationReason = 'EARLIER_PHASE_NOT_DONE' | 'EARLIER_PHASE_BOOKED_LATER';

export interface SequenceStepInput {
  workPhaseCode: string;
  label?: string | null;
  /** Tervbeli sorrend (pathway_order_index / seq). */
  orderIndex: number;
  status: string;
  /** A fázishoz tartozó jövőbeli aktív foglalás kezdete (ISO), vagy null. */
  bookedStart: string | null;
}

export interface SequenceViolation {
  /** A sorrenden kívülre került, lefoglalt fázis. */
  workPhaseCode: string;
  label?: string | null;
  bookedStart: string;
  /** A korábbi, még el nem végzett fázis, ami miatt a sorrend sérül. */
  blockingWorkPhaseCode: string;
  blockingLabel?: string | null;
  reason: SequenceViolationReason;
  message: string;
}

const DONE_STATUSES = new Set(['completed', 'skipped']);

const labelOf = (s: { label?: string | null; workPhaseCode: string }) =>
  s.label?.trim() ? s.label.trim() : s.workPhaseCode;

/**
 * Detektálja a sorrenden kívüli lefoglalt időpontokat. Lefoglalt fázisonként
 * legfeljebb egy (a legkorábbi blokkoló korábbi fázishoz tartozó) jelzést ad,
 * hogy a lista kezelhető maradjon.
 */
export function detectSequenceViolations(steps: SequenceStepInput[]): SequenceViolation[] {
  const sorted = [...steps].sort((a, b) => a.orderIndex - b.orderIndex);
  const violations: SequenceViolation[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const booked = sorted[i];
    if (!booked.bookedStart) continue; // csak lefoglalt fázis lehet "out of sequence"
    if (DONE_STATUSES.has(booked.status)) continue; // befejezett fázis rendben
    const bookedMs = new Date(booked.bookedStart).getTime();

    for (let j = 0; j < i; j++) {
      const earlier = sorted[j];
      if (DONE_STATUSES.has(earlier.status)) continue; // korábbi már kész → rendben

      if (!earlier.bookedStart) {
        violations.push({
          workPhaseCode: booked.workPhaseCode,
          label: booked.label ?? null,
          bookedStart: booked.bookedStart,
          blockingWorkPhaseCode: earlier.workPhaseCode,
          blockingLabel: earlier.label ?? null,
          reason: 'EARLIER_PHASE_NOT_DONE',
          message: `A(z) "${labelOf(booked)}" lépés időpontja le van foglalva, de a korábbi "${labelOf(
            earlier
          )}" lépés még nincs elvégezve és nincs is időpontja — a sorrend felborult, újrafoglalás szükséges.`,
        });
        break;
      }

      if (new Date(earlier.bookedStart).getTime() >= bookedMs) {
        violations.push({
          workPhaseCode: booked.workPhaseCode,
          label: booked.label ?? null,
          bookedStart: booked.bookedStart,
          blockingWorkPhaseCode: earlier.workPhaseCode,
          blockingLabel: earlier.label ?? null,
          reason: 'EARLIER_PHASE_BOOKED_LATER',
          message: `A(z) "${labelOf(booked)}" lépés időpontja korábbra esik, mint a tervben előtte álló "${labelOf(
            earlier
          )}" lépésé — a sorrend felborult, újrafoglalás szükséges.`,
        });
        break;
      }
    }
  }

  return violations;
}

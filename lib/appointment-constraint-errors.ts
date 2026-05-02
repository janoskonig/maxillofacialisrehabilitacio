/**
 * Translate Postgres `23505 unique_violation` constraint hits into human messages
 * the API handlers can return as `{ error, code, status, hint }`.
 *
 * Why: a worklist-driven booking flow can hit several unique indexes that all
 * mean roughly "this work phase already has an active appointment". Without
 * this translator the user just gets "Hiba történt" or a raw SQL string.
 */

export interface UniqueViolationTranslation {
  /** HTTP status code to return. */
  status: number;
  /** Stable machine code so the UI can route the error. */
  code: string;
  /** User-facing Hungarian message. */
  error: string;
  /** Optional follow-up text shown next to the error in the UI. */
  hint?: string;
}

const TRANSLATIONS: Record<string, UniqueViolationTranslation> = {
  idx_appointments_unique_pending_step: {
    status: 409,
    code: 'STEP_ALREADY_BOOKED',
    error: 'Ennek a kezelési lépésnek már van foglalt időpontja.',
    hint: 'Frissítsd a munkalistát; ha valóban újrafoglalnád, először töröld vagy módosítsd a meglévő időpontot.',
  },
  idx_appointments_unique_slot_intent: {
    status: 409,
    code: 'INTENT_ALREADY_CONVERTED',
    error: 'Ehhez a slot-foglalási szándékhoz már tartozik appointment.',
    hint: 'A slot intent egy 1-1 kapcsolatban áll az appointmenttel. Frissíts és nézd meg a meglévő foglalást.',
  },
  idx_appointments_one_hard_next: {
    status: 409,
    code: 'ONE_HARD_NEXT_VIOLATION',
    error: 'Az epizódhoz már tartozik egy jövőbeli munka-pool időpont.',
    hint: 'Egyszerre csak egy "kemény" jövőbeli foglalás lehet. Használd az „Összes szükséges időpont lefoglalása” gombot, vagy adj override indoklást (min. 10 karakter).',
  },
  appointments_time_slot_id_key: {
    status: 409,
    code: 'SLOT_ALREADY_BOOKED',
    error: 'Ezt az időpontot időközben más foglalta le.',
    hint: 'Frissítsd a naptárat és válassz másik szabad időpontot.',
  },
  idx_appointments_unique_work_phase_active: {
    status: 409,
    code: 'WORK_PHASE_ALREADY_BOOKED',
    error: 'Ennek a munkafázisnak már van aktív foglalása.',
    hint: 'A munkafázis egyszerre csak egy aktív appointmenthez köthető. Frissítsd a munkalistát.',
  },
};

interface PgLikeError {
  code?: string;
  constraint?: string;
  detail?: string;
  message?: string;
}

/**
 * Returns a translation for a Postgres unique-violation, or `null` if the
 * error is not a unique-violation we recognise.
 */
export function translateUniqueViolation(error: unknown): UniqueViolationTranslation | null {
  if (!error || typeof error !== 'object') return null;
  const pg = error as PgLikeError;
  if (pg.code !== '23505') return null;

  if (pg.constraint && TRANSLATIONS[pg.constraint]) {
    return TRANSLATIONS[pg.constraint];
  }

  if (pg.detail || pg.message) {
    const haystack = `${pg.detail ?? ''} ${pg.message ?? ''}`;
    for (const name of Object.keys(TRANSLATIONS)) {
      if (haystack.includes(name)) {
        return TRANSLATIONS[name];
      }
    }
  }

  return null;
}

/** True if the error is a recognised unique-violation we can translate. */
export function isKnownUniqueViolation(error: unknown): boolean {
  return translateUniqueViolation(error) !== null;
}

/**
 * Ütemezési integritás — detektálás és szűk hatókörű, idempotens javítás
 * (WP-1.2).
 *
 * Korábban ez a logika a `app/api/episodes/[id]/scheduling-integrity/route.ts`
 * fájlban élt, és a betegkartonon egy banner (EpisodeIntegrityBanner) mutatta
 * a violationöket, kézi „Javítás" gombbal. A WP-1.2 óta:
 *
 *  - a JAVÍTHATÓ violationöket (EWP_DANGLING_APPOINTMENT_LINK,
 *    APPOINTMENT_STEP_MISMATCH) a szerver automatikusan, kérdezés nélkül
 *    rendbe teszi (`autoRepairSchedulingIntegrity`) — a terv-kártya olvasása
 *    (GET work-phases) és az admin-scan triggereli;
 *  - a maradék (nem javítható) violationök az /admin „Ütemezési integritás"
 *    fülön jelennek meg, technikai nyelvezettel;
 *  - a kartonon csak a klinikai jelentésű nyom marad: a sor melletti halk
 *    „nincs élő időpont — foglaljon újat" jelzés
 *    (`getLostAppointmentWorkPhaseIds`).
 *
 * A repair NEM nyúl a slothoz, nem törli a foglalást, nem módosít kezelési
 * utat, és nem vezet be blokkoló állapotot. Idempotens: ha nincs mit
 * javítani, nem nyit tranzakciót és nem ír auditot.
 */

import { getDbPool } from './db';
import { logger } from './logger';
import { emitSchedulingEvent } from './scheduling-events';
import {
  SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT,
  SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT,
  isAppointmentActive,
} from './active-appointment';
import { insertWorkPhaseAudit } from './work-phase-audit';

type DbPool = ReturnType<typeof getDbPool>;

export type SchedulingIntegrityViolationKind =
  | 'ONE_HARD_NEXT_VIOLATION'
  | 'INTENT_OPEN_EPISODE_CLOSED'
  | 'APPOINTMENT_NO_SLOT'
  | 'SLOT_DOUBLE_BOOKED'
  | 'EWP_DANGLING_APPOINTMENT_LINK'
  | 'APPOINTMENT_STEP_MISMATCH';

export interface SchedulingIntegrityViolation {
  kind: SchedulingIntegrityViolationKind;
  message: string;
  appointmentIds?: string[];
  slotIds?: string[];
  intentIds?: string[];
  workPhaseIds?: string[];
  /**
   * EWP_DANGLING_APPOINTMENT_LINK / APPOINTMENT_STEP_MISMATCH részletei —
   * a repair ezeket használja a tisztításhoz.
   */
  details?: Array<Record<string, unknown>>;
  /** Az adott kategória automatikusan javítható-e. */
  repairable?: boolean;
}

interface DanglingRow {
  workPhaseId: string;
  workPhaseCode: string;
  ewpStatus: string;
  appointmentId: string;
  appointmentStatus: string | null;
  appointmentMissing: boolean;
}

interface MismatchRow {
  workPhaseId: string;
  ewpWorkPhaseCode: string;
  ewpPathwayOrderIndex: number | null;
  appointmentId: string;
  appointmentStepCode: string | null;
  appointmentStepSeq: number | null;
  appointmentStatus: string | null;
}

const DANGLING_SELECT = `SELECT ewp.id                      AS "workPhaseId",
        ewp.work_phase_code          AS "workPhaseCode",
        ewp.status                   AS "ewpStatus",
        ewp.appointment_id           AS "appointmentId",
        a.appointment_status          AS "appointmentStatus",
        (a.id IS NULL)                AS "appointmentMissing"
 FROM episode_work_phases ewp
 LEFT JOIN appointments a ON a.id = ewp.appointment_id
 WHERE ewp.episode_id = $1
   AND ewp.appointment_id IS NOT NULL
   AND (
     a.id IS NULL
     OR NOT ${SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT}
   )`;

const MISMATCH_SELECT = `SELECT ewp.id                        AS "workPhaseId",
        ewp.work_phase_code            AS "ewpWorkPhaseCode",
        ewp.pathway_order_index        AS "ewpPathwayOrderIndex",
        a.id                           AS "appointmentId",
        a.step_code                    AS "appointmentStepCode",
        a.step_seq                     AS "appointmentStepSeq",
        a.appointment_status           AS "appointmentStatus"
 FROM episode_work_phases ewp
 JOIN appointments a ON a.id = ewp.appointment_id
 WHERE ewp.episode_id = $1
   AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
   AND (
     a.step_code IS DISTINCT FROM ewp.work_phase_code
     OR a.step_seq IS DISTINCT FROM ewp.pathway_order_index
   )`;

/**
 * Egy epizód összes ismert integritás-violationje (diagnosztika).
 *
 * Ismert kategóriák:
 *  - ONE_HARD_NEXT_VIOLATION: több, mint 1 jövőbeli munkafoglalás
 *  - INTENT_OPEN_EPISODE_CLOSED: nyitott slot_intent lezárt epizódhoz
 *  - APPOINTMENT_NO_SLOT: foglalás slot nélkül
 *  - EWP_DANGLING_APPOINTMENT_LINK: ewp.appointment_id nem létező / cancelled /
 *    unsuccessful appointmentre mutat — emiatt a worklist state drift-el
 *  - APPOINTMENT_STEP_MISMATCH: `a.step_code / step_seq` eltér az
 *    `episode_work_phases` sortól, amelynek `appointment_id = a.id`.
 */
export async function detectSchedulingIntegrityViolations(
  pool: DbPool,
  episodeId: string,
  episodeStatus: string
): Promise<SchedulingIntegrityViolation[]> {
  const violations: SchedulingIntegrityViolation[] = [];

  // 1) One-hard-next: >1 future work appointment (excluding requires_precommit)
  const oneHardNextResult = await pool.query(
    `SELECT id FROM appointments
     WHERE episode_id = $1 AND pool = 'work'
     AND start_time > CURRENT_TIMESTAMP
     AND (appointment_status IS NULL OR appointment_status = 'completed')
     AND requires_precommit = false
     AND is_chain_reservation = false`,
    [episodeId]
  );
  if (oneHardNextResult.rows.length > 1) {
    violations.push({
      kind: 'ONE_HARD_NEXT_VIOLATION',
      message: `Epizódnak ${oneHardNextResult.rows.length} jövőbeli munkafoglalása van (max 1 engedélyezett)`,
      appointmentIds: oneHardNextResult.rows.map((r: { id: string }) => r.id),
    });
  }

  // 2) Intents open but episode closed
  if (episodeStatus === 'closed') {
    const openIntentsResult = await pool.query(
      `SELECT id FROM slot_intents WHERE episode_id = $1 AND state = 'open'`,
      [episodeId]
    );
    if (openIntentsResult.rows.length > 0) {
      violations.push({
        kind: 'INTENT_OPEN_EPISODE_CLOSED',
        message: 'Nyitott intentek léteznek lezárt epizódhoz',
        intentIds: openIntentsResult.rows.map((r: { id: string }) => r.id),
      });
    }
  }

  // 3) Episode appointments without valid slot
  const apptNoSlotResult = await pool.query(
    `SELECT a.id FROM appointments a
     LEFT JOIN available_time_slots ats ON a.time_slot_id = ats.id
     WHERE a.episode_id = $1 AND ats.id IS NULL
     AND (a.appointment_status IS NULL OR a.appointment_status = 'completed')`,
    [episodeId]
  );
  if (apptNoSlotResult.rows.length > 0) {
    violations.push({
      kind: 'APPOINTMENT_NO_SLOT',
      message: 'Foglalások léteznek slot nélkül',
      appointmentIds: apptNoSlotResult.rows.map((r: { id: string }) => r.id),
    });
  }

  // 4) EWP_DANGLING_APPOINTMENT_LINK — ewp.appointment_id IS NOT NULL, de a
  //    hivatkozott sor nem LÁTHATÓ (cancelled / unsuccessful / no_show / nem
  //    létezik). A worklist SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT szerint
  //    szűri a BOOKED matching-et, emiatt a drift READY↔BOOKED oszcillációt
  //    és hamis „cél már foglalt" riasztást okozott.
  const danglingResult = await pool.query(
    `${DANGLING_SELECT}
     ORDER BY ewp.pathway_order_index`,
    [episodeId]
  );
  if (danglingResult.rows.length > 0) {
    const rows = danglingResult.rows as DanglingRow[];
    violations.push({
      kind: 'EWP_DANGLING_APPOINTMENT_LINK',
      message: `Munkafázis sor lemondott / sikertelen / nem létező foglalásra mutat (${rows.length})`,
      workPhaseIds: rows.map((r) => r.workPhaseId),
      appointmentIds: rows.map((r) => r.appointmentId),
      details: rows.map((r) => ({
        workPhaseId: r.workPhaseId,
        workPhaseCode: r.workPhaseCode,
        ewpStatus: r.ewpStatus,
        appointmentId: r.appointmentId,
        appointmentStatus: r.appointmentMissing
          ? 'MISSING'
          : (r.appointmentStatus ?? 'NULL'),
      })),
      repairable: true,
    });
  }

  // 5) APPOINTMENT_STEP_MISMATCH — ewp.appointment_id AKTÍV appointmentre
  //    mutat, de a.step_code / step_seq nem egyezik az ewp saját
  //    work_phase_code / pathway_order_index-ével.
  const mismatchResult = await pool.query(
    `${MISMATCH_SELECT}
     ORDER BY ewp.pathway_order_index`,
    [episodeId]
  );
  if (mismatchResult.rows.length > 0) {
    const rows = mismatchResult.rows as MismatchRow[];
    violations.push({
      kind: 'APPOINTMENT_STEP_MISMATCH',
      message: `Foglalás step_code / step_seq eltér a hozzá kötött munkafázis sortól (${rows.length})`,
      workPhaseIds: rows.map((r) => r.workPhaseId),
      appointmentIds: rows.map((r) => r.appointmentId),
      details: rows.map((r) => ({
        workPhaseId: r.workPhaseId,
        ewpWorkPhaseCode: r.ewpWorkPhaseCode,
        ewpPathwayOrderIndex: r.ewpPathwayOrderIndex,
        appointmentId: r.appointmentId,
        appointmentStepCode: r.appointmentStepCode,
        appointmentStepSeq: r.appointmentStepSeq,
        appointmentStatus: r.appointmentStatus ?? 'NULL',
      })),
      repairable: true,
    });
  }

  return violations;
}

export interface SchedulingIntegrityRepairResult {
  /** Ténylegesen takarított (appointment_id → NULL) munkafázis-sorok száma. */
  danglingCleared: number;
  /** Ténylegesen átírt (step_code/step_seq) foglalások száma. */
  mismatchRepaired: number;
  /** A takarított munkafázis-sorok id-i (a sor-szintű karton-jelzéshez). */
  clearedWorkPhaseIds: string[];
}

/**
 * Szűk hatókörű, IDEMPOTENT javítás:
 *  - `EWP_DANGLING_APPOINTMENT_LINK` → `ewp.appointment_id = NULL`,
 *    `scheduled → pending` (ha az volt), audit-bejegyzéssel.
 *  - `APPOINTMENT_STEP_MISMATCH` → `appointments.step_code` és `step_seq`
 *    átírása az ewp szerint (az ewp az SSOT, mert a worklist is így matchel).
 *
 * NEM módosít slot-ot, nem törli a foglalást, nem nyúl a kezelési úthoz.
 * Ha nincs mit javítani, tranzakciót sem nyit. Hiba esetén dob — a hívó dönt
 * a válaszról (a route 500-at ad, az auto-repair lenyeli és logol).
 */
export async function repairSchedulingIntegrity(
  pool: DbPool,
  episodeId: string,
  opts: { changedBy: string; reasonSuffix?: string }
): Promise<SchedulingIntegrityRepairResult> {
  const reasonSuffix = opts.reasonSuffix ?? '';

  const dangling = await pool.query(DANGLING_SELECT, [episodeId]);
  const mismatch = await pool.query(MISMATCH_SELECT, [episodeId]);

  if (dangling.rows.length === 0 && mismatch.rows.length === 0) {
    return { danglingCleared: 0, mismatchRepaired: 0, clearedWorkPhaseIds: [] };
  }

  let danglingCleared = 0;
  let mismatchRepaired = 0;
  const clearedWorkPhaseIds: string[] = [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const row of dangling.rows as DanglingRow[]) {
      // Biztonsági utó-check a tranzakción belül — két egyidejű hívás
      // ne lépje meg egymást. Megerősítjük, hogy továbbra is stale.
      const recheck = await client.query(
        `SELECT ewp.appointment_id AS "appointmentId", ewp.status,
                a.appointment_status AS "appointmentStatus",
                (a.id IS NULL) AS "appointmentMissing"
         FROM episode_work_phases ewp
         LEFT JOIN appointments a ON a.id = ewp.appointment_id
         WHERE ewp.id = $1`,
        [row.workPhaseId]
      );
      const current = recheck.rows[0];
      if (!current || current.appointmentId !== row.appointmentId) continue;
      const stillStale =
        current.appointmentMissing === true ||
        !isAppointmentActive(current.appointmentStatus);
      if (!stillStale) continue;

      await client.query(
        `UPDATE episode_work_phases
         SET appointment_id = NULL,
             status = CASE WHEN status = 'scheduled' THEN 'pending' ELSE status END
         WHERE id = $1`,
        [row.workPhaseId]
      );
      danglingCleared += 1;
      clearedWorkPhaseIds.push(row.workPhaseId);

      if (current.status === 'scheduled') {
        await insertWorkPhaseAudit(client, {
          episodeWorkPhaseId: row.workPhaseId,
          episodeId,
          oldStatus: 'scheduled',
          newStatus: 'pending',
          changedBy: opts.changedBy,
          reason: `integrity repair: dangling appointment_id takarítása (mutatott: ${row.appointmentId}, status: ${row.appointmentMissing ? 'MISSING' : (row.appointmentStatus ?? 'NULL')})${reasonSuffix}`,
        });
      }
    }

    for (const row of mismatch.rows as MismatchRow[]) {
      const recheck = await client.query(
        `SELECT a.step_code AS "stepCode", a.step_seq AS "stepSeq",
                a.appointment_status AS "appointmentStatus"
         FROM appointments a
         WHERE a.id = $1`,
        [row.appointmentId]
      );
      const current = recheck.rows[0];
      if (!current) continue;
      if (!isAppointmentActive(current.appointmentStatus)) continue;
      const stillMismatch =
        current.stepCode !== row.ewpWorkPhaseCode ||
        current.stepSeq !== row.ewpPathwayOrderIndex;
      if (!stillMismatch) continue;

      await client.query(
        `UPDATE appointments
         SET step_code = $1, step_seq = $2, work_phase_id = $3
         WHERE id = $4`,
        [
          row.ewpWorkPhaseCode,
          row.ewpPathwayOrderIndex,
          row.workPhaseId,
          row.appointmentId,
        ]
      );
      mismatchRepaired += 1;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { danglingCleared, mismatchRepaired, clearedWorkPhaseIds };
}

/** Sentry breadcrumb, ha a Sentry elérhető — nélküle is működik. */
function addSentryBreadcrumb(data: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/nextjs') as typeof import('@sentry/nextjs');
    Sentry.addBreadcrumb({
      category: 'scheduling-integrity',
      message: 'auto-repair',
      level: 'info',
      data,
    });
  } catch {
    /* Sentry nem elérhető — a szerver log akkor is megvan */
  }
}

/**
 * Automatikus (kérdezés nélküli) javítás — a terv-kártya olvasása és az
 * admin-scan hívja. Idempotens; hibát SOHA nem dob tovább (az olvasási út
 * nem törhet el miatta), csak logol. Ha javított valamit, szerver logot ír,
 * Sentry breadcrumb-ot ad, és scheduling eventet emittál, hogy a cache-ek
 * frissüljenek.
 */
export async function autoRepairSchedulingIntegrity(
  pool: DbPool,
  episodeId: string,
  opts: { changedBy: string; trigger: string }
): Promise<SchedulingIntegrityRepairResult | null> {
  let result: SchedulingIntegrityRepairResult;
  try {
    result = await repairSchedulingIntegrity(pool, episodeId, {
      changedBy: opts.changedBy,
      reasonSuffix: ` — automatikus javítás (${opts.trigger})`,
    });
  } catch (err) {
    logger.error('[scheduling-integrity] auto-repair sikertelen', {
      episodeId,
      trigger: opts.trigger,
      err,
    });
    return null;
  }

  if (result.danglingCleared > 0 || result.mismatchRepaired > 0) {
    // Direkt console.warn: a next.config removeConsole a warn-t élesben is
    // megtartja (a logger.warn csak dev-ben ír) — az auto-repair nyoma a
    // production szerver logban is kell.
    console.warn('[scheduling-integrity] auto-repair', {
      episodeId,
      trigger: opts.trigger,
      danglingCleared: result.danglingCleared,
      mismatchRepaired: result.mismatchRepaired,
      clearedWorkPhaseIds: result.clearedWorkPhaseIds,
    });
    addSentryBreadcrumb({
      episodeId,
      trigger: opts.trigger,
      danglingCleared: result.danglingCleared,
      mismatchRepaired: result.mismatchRepaired,
    });
    try {
      await emitSchedulingEvent('episode', episodeId, 'integrity_repaired');
    } catch {
      /* non-blocking */
    }
  }

  return result;
}

/**
 * A karton sor-szintű, klinikai jelentésű jelzéséhez: azok a munkafázis-sorok,
 * amelyek az integritás-javítás során veszítették el a foglalásukat, és azóta
 * sem kaptak újat. „Elveszett" = a sor `pending`, nincs appointment-linkje, és
 * a LEGUTOLSÓ audit-bejegyzése a dangling-takarítás. Amint a sorra új időpontot
 * foglalnak (vagy bármi más státusz-mozgás történik), a jelzés magától eltűnik.
 */
export async function getLostAppointmentWorkPhaseIds(
  pool: DbPool,
  episodeId: string
): Promise<string[]> {
  const result = await pool.query(
    `SELECT ewp.id
     FROM episode_work_phases ewp
     JOIN LATERAL (
       SELECT au.new_status, au.reason
       FROM episode_work_phase_audit au
       WHERE au.episode_work_phase_id = ewp.id
       ORDER BY au.created_at DESC, au.id DESC
       LIMIT 1
     ) last_audit ON TRUE
     WHERE ewp.episode_id = $1
       AND ewp.status = 'pending'
       AND ewp.appointment_id IS NULL
       AND last_audit.new_status = 'pending'
       AND last_audit.reason LIKE 'integrity repair: dangling appointment_id takarítása%'`,
    [episodeId]
  );
  return result.rows.map((r: { id: string }) => r.id);
}

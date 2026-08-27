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
  | 'APPOINTMENT_STEP_MISMATCH'
  | 'MULTI_EWP_APPOINTMENT_LINK';

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

/**
 * Egy AKTÍV appointmentre több EWP sor is mutathat (nincs unique index az
 * `episode_work_phases.appointment_id`-n — séma-döntés, ezen a WP-n túl).
 * Az ilyen "multi-link" esetet a mismatch-repair NEM javíthatja: két eltérő
 * kódú fázis közül bármelyikhez igazítaná a step_code-ot, a következő futás
 * a másikhoz — a step_code oda-vissza billegne (flip-flop), és minden futás
 * írna. Ezért a MISMATCH_SELECT kizárja, a detect pedig külön, NEM javítható
 * violationként (MULTI_EWP_APPOINTMENT_LINK) jelenti az admin felületre.
 */
const MISMATCH_MULTI_LINK_EXCLUSION = `AND NOT EXISTS (
     SELECT 1 FROM episode_work_phases other
     WHERE other.appointment_id = ewp.appointment_id
       AND other.id <> ewp.id
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
   )
   ${MISMATCH_MULTI_LINK_EXCLUSION}`;

/**
 * MULTI_EWP_APPOINTMENT_LINK: aktív appointment, amelyre egynél több EWP sor
 * mutat, és amelyre az adott epizód legalább egy sora hivatkozik. A számlálás
 * szándékosan epizód-független (a másik link jöhet másik epizódból is), mert
 * a flip-flop veszély attól függetlenül fennáll.
 */
const MULTI_LINK_SELECT = `SELECT a.id                 AS "appointmentId",
        a.appointment_status                            AS "appointmentStatus",
        array_agg(ewp.id ORDER BY ewp.pathway_order_index)              AS "workPhaseIds",
        array_agg(ewp.work_phase_code ORDER BY ewp.pathway_order_index) AS "workPhaseCodes",
        COUNT(*)::int                                   AS "linkCount"
 FROM appointments a
 JOIN episode_work_phases ewp ON ewp.appointment_id = a.id
 WHERE ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
   AND EXISTS (
     SELECT 1 FROM episode_work_phases own
     WHERE own.appointment_id = a.id AND own.episode_id = $1
   )
 GROUP BY a.id, a.appointment_status
 HAVING COUNT(*) > 1`;

interface MultiLinkRow {
  appointmentId: string;
  appointmentStatus: string | null;
  workPhaseIds: string[];
  workPhaseCodes: string[];
  linkCount: number;
}

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
 *  - MULTI_EWP_APPOINTMENT_LINK: több EWP sor mutat ugyanarra az aktív
 *    appointmentre — NEM auto-javítható, kézi rendezést igényel.
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

  // 6) MULTI_EWP_APPOINTMENT_LINK — több EWP sor mutat ugyanarra az AKTÍV
  //    appointmentre. NEM auto-javítható (melyik link a jó, azt csak ember
  //    döntheti el; az auto-repair itt szándékosan nem ír semmit, különben a
  //    step_code futásonként oda-vissza billegne). Admin felületen jelenik meg.
  const multiLinkResult = await pool.query(MULTI_LINK_SELECT, [episodeId]);
  if (multiLinkResult.rows.length > 0) {
    const rows = multiLinkResult.rows as MultiLinkRow[];
    violations.push({
      kind: 'MULTI_EWP_APPOINTMENT_LINK',
      message: `Több munkafázis sor mutat ugyanarra az aktív foglalásra (${rows.length} foglalás érintett) — kézi rendezést igényel`,
      appointmentIds: rows.map((r) => r.appointmentId),
      workPhaseIds: rows.flatMap((r) => r.workPhaseIds),
      details: rows.map((r) => ({
        appointmentId: r.appointmentId,
        appointmentStatus: r.appointmentStatus ?? 'NULL',
        workPhaseIds: r.workPhaseIds,
        workPhaseCodes: r.workPhaseCodes,
        linkCount: r.linkCount,
      })),
      repairable: false,
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
 *    `scheduled → pending` (ha az volt), MINDEN tényleges link-nullázás
 *    audit-bejegyzéssel jár (státusztól függetlenül, change_type
 *    'integrity_repair' — WP-2.1 elv: minden terv-mutáció auditált).
 *  - `APPOINTMENT_STEP_MISMATCH` → `appointments.step_code` és `step_seq`
 *    átírása az ewp szerint (az ewp az SSOT, mert a worklist is így matchel).
 *  - MULTI_EWP_APPOINTMENT_LINK (több EWP → egy aktív appointment) esetén
 *    NEM ír semmit — az eset nem auto-javítható, az admin maradék-listán
 *    jelenik meg (lásd MISMATCH_MULTI_LINK_EXCLUSION).
 *
 * Versenyhelyzet-védelem (READ COMMITTED alatt): a tranzakción belüli
 * recheck SELECT `FOR UPDATE`-tel zárolja az érintett sort, ÉS az UPDATE
 * WHERE-je is tartalmazza a guard-feltételeket (appointment_id egyezés,
 * stale/aktív státusz) — így egy párhuzamos foglalási tranzakció commitja
 * után az EPQ-újraértékelt WHERE hamis lesz, a friss link érintetlen marad.
 * A számlálók és az audit-írás a tényleges UPDATE rowCount-ján alapulnak.
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
      // Biztonsági utó-check a tranzakción belül — két egyidejű hívás ne
      // lépje meg egymást. A FOR UPDATE OF ewp zárolja a munkafázis-sort:
      // egy in-flight foglalási tranzakció commitjáig itt várunk, és a
      // zárolt olvasás már a FRISS appointment_id-t adja vissza (EPQ).
      const recheck = await client.query(
        `SELECT ewp.appointment_id AS "appointmentId", ewp.status,
                a.appointment_status AS "appointmentStatus",
                (a.id IS NULL) AS "appointmentMissing"
         FROM episode_work_phases ewp
         LEFT JOIN appointments a ON a.id = ewp.appointment_id
         WHERE ewp.id = $1
         FOR UPDATE OF ewp`,
        [row.workPhaseId]
      );
      const current = recheck.rows[0];
      if (!current || current.appointmentId !== row.appointmentId) continue;
      const stillStale =
        current.appointmentMissing === true ||
        !isAppointmentActive(current.appointmentStatus);
      if (!stillStale) continue;

      // A guard-feltételek az UPDATE WHERE-jében is: csak akkor nullázunk,
      // ha a sor MÉG MINDIG a stale foglalásra mutat, és az a foglalás
      // továbbra sem látható/aktív. Párhuzamos új foglalás linkjét így az
      // EPQ-újraértékelés sem engedi kitörölni.
      const updated = await client.query(
        `UPDATE episode_work_phases
         SET appointment_id = NULL,
             status = CASE WHEN status = 'scheduled' THEN 'pending' ELSE status END
         WHERE id = $1
           AND appointment_id = $2
           AND NOT EXISTS (
             SELECT 1 FROM appointments a
             WHERE a.id = $2 AND ${SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT}
           )`,
        [row.workPhaseId, row.appointmentId]
      );
      if ((updated.rowCount ?? 0) === 0) continue;

      danglingCleared += 1;
      clearedWorkPhaseIds.push(row.workPhaseId);

      // MINDEN tényleges link-nullázás auditot ír, státusztól függetlenül
      // (WP-2.1 elv). A dedikált change_type ('integrity_repair') alapján
      // ismeri fel a sor-szintű karton-jelzés (getLostAppointmentWorkPhaseIds)
      // a takarítást — nem szöveg-prefixre támaszkodunk.
      const newStatus = current.status === 'scheduled' ? 'pending' : current.status;
      await insertWorkPhaseAudit(client, {
        episodeWorkPhaseId: row.workPhaseId,
        episodeId,
        oldStatus: current.status,
        newStatus,
        changedBy: opts.changedBy,
        changeType: 'integrity_repair',
        reason: `integrity repair: dangling appointment_id takarítása (mutatott: ${row.appointmentId}, status: ${row.appointmentMissing ? 'MISSING' : (row.appointmentStatus ?? 'NULL')})${reasonSuffix}`,
      });
    }

    for (const row of mismatch.rows as MismatchRow[]) {
      // Recheck FRISS ewp-értékekkel, mindkét sor zárolásával. A linkCount
      // a multi-link (több EWP → egy appointment) közbeni megjelenését fogja
      // meg — ilyenkor nem írunk (nem auto-javítható, flip-flop veszély).
      const recheck = await client.query(
        `SELECT a.id AS "appointmentId",
                a.step_code AS "stepCode", a.step_seq AS "stepSeq",
                a.appointment_status AS "appointmentStatus",
                ewp.work_phase_code AS "ewpWorkPhaseCode",
                ewp.pathway_order_index AS "ewpPathwayOrderIndex",
                (SELECT COUNT(*)::int FROM episode_work_phases e2
                  WHERE e2.appointment_id = a.id) AS "linkCount"
         FROM episode_work_phases ewp
         JOIN appointments a ON a.id = ewp.appointment_id
         WHERE ewp.id = $1
         FOR UPDATE OF ewp, a`,
        [row.workPhaseId]
      );
      const current = recheck.rows[0];
      if (!current) continue;
      if (current.appointmentId !== row.appointmentId) continue;
      if (!isAppointmentActive(current.appointmentStatus)) continue;
      if (current.linkCount > 1) continue;
      const stillMismatch =
        current.stepCode !== current.ewpWorkPhaseCode ||
        current.stepSeq !== current.ewpPathwayOrderIndex;
      if (!stillMismatch) continue;

      // Guard-feltételek az UPDATE WHERE-jében is: aktív státusz, tényleges
      // eltérés, és a cél-EWP link vissza-ellenőrzése.
      const updated = await client.query(
        `UPDATE appointments a
         SET step_code = $1, step_seq = $2, work_phase_id = $3
         WHERE a.id = $4
           AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
           AND (
             a.step_code IS DISTINCT FROM $1
             OR a.step_seq IS DISTINCT FROM $2
             OR a.work_phase_id IS DISTINCT FROM $3
           )
           AND EXISTS (
             SELECT 1 FROM episode_work_phases g
             WHERE g.id = $3 AND g.appointment_id = a.id
           )`,
        [
          current.ewpWorkPhaseCode,
          current.ewpPathwayOrderIndex,
          row.workPhaseId,
          row.appointmentId,
        ]
      );
      if ((updated.rowCount ?? 0) === 0) continue;
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
 * Az audit-bejegyzések közül ezek a change_type-ok NEM érintik a foglalás-linket
 * / státuszt (pl. időzítés- vagy címke-módosítás) — a sor-szintű „elveszett
 * időpont" jelzést nem szabad kioltaniuk. A `reorder` epizód-szintű sor
 * (episode_work_phase_id NULL), a fázis alatt eleve nem jelenik meg.
 */
const LINK_IRRELEVANT_AUDIT_CHANGE_TYPES = ['timing_change'] as const;

/**
 * A karton sor-szintű, klinikai jelentésű jelzéséhez: azok a munkafázis-sorok,
 * amelyek az integritás-javítás során veszítették el a foglalásukat, és azóta
 * sem kaptak újat. „Elveszett" = a sor `pending`, nincs appointment-linkje, és
 * a LEGUTOLSÓ link-releváns audit-bejegyzése a dedikált 'integrity_repair'
 * change_type-ú takarítás (nem szöveg-prefix egyezés — a reason csak embernek
 * szól). Közbeeső, linket nem érintő audit (timing_change stb.) nem oltja ki a
 * jelzést; új foglalás viszont igen: a link (appointment_id) beírásával a sor
 * kiesik a szűrésből, és a foglalás-könyvelés audit-sora is felülírja a
 * legutolsó link-releváns bejegyzést.
 */
export async function getLostAppointmentWorkPhaseIds(
  pool: DbPool,
  episodeId: string
): Promise<string[]> {
  const result = await pool.query(
    `SELECT ewp.id
     FROM episode_work_phases ewp
     JOIN LATERAL (
       SELECT au.change_type
       FROM episode_work_phase_audit au
       WHERE au.episode_work_phase_id = ewp.id
         AND au.change_type <> ALL($2::text[])
       ORDER BY au.created_at DESC, au.id DESC
       LIMIT 1
     ) last_relevant ON TRUE
     WHERE ewp.episode_id = $1
       AND ewp.status = 'pending'
       AND ewp.appointment_id IS NULL
       AND last_relevant.change_type = 'integrity_repair'`,
    [episodeId, [...LINK_IRRELEVANT_AUDIT_CHANGE_TYPES]]
  );
  return result.rows.map((r: { id: string }) => r.id);
}

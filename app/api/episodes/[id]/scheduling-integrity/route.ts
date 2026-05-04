import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';
import { logActivity } from '@/lib/activity';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import {
  SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT,
  SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT,
  isAppointmentActive,
} from '@/lib/active-appointment';

export const dynamic = 'force-dynamic';

type ViolationKind =
  | 'ONE_HARD_NEXT_VIOLATION'
  | 'INTENT_OPEN_EPISODE_CLOSED'
  | 'APPOINTMENT_NO_SLOT'
  | 'SLOT_DOUBLE_BOOKED'
  | 'EWP_DANGLING_APPOINTMENT_LINK'
  | 'APPOINTMENT_STEP_MISMATCH';

interface Violation {
  kind: ViolationKind;
  message: string;
  appointmentIds?: string[];
  slotIds?: string[];
  intentIds?: string[];
  workPhaseIds?: string[];
  /**
   * EWP_DANGLING_APPOINTMENT_LINK / APPOINTMENT_STEP_MISMATCH részletei —
   * a repair endpoint ezeket használja a tisztításhoz.
   */
  details?: Array<Record<string, unknown>>;
  /** Az adott kategória automatikusan javítható-e a repair endpointtal. */
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

/**
 * GET /api/episodes/:id/scheduling-integrity
 * Returns scheduling violations for this episode (diagnostic).
 *
 * Ismert kategóriák:
 *  - ONE_HARD_NEXT_VIOLATION: több, mint 1 jövőbeli munkafoglalás
 *  - INTENT_OPEN_EPISODE_CLOSED: nyitott slot_intent lezárt epizódhoz
 *  - APPOINTMENT_NO_SLOT: foglalás slot nélkül
 *  - EWP_DANGLING_APPOINTMENT_LINK: ewp.appointment_id nem létező / cancelled /
 *    unsuccessful appointmentre mutat — emiatt a worklist state drift-el
 *    (pl. READY ↔ BOOKED oszcillál, vagy a reassign-step endpoint
 *    „cél már foglalt"-ot jelez, miközben a foglalás valójában lemondott)
 *  - APPOINTMENT_STEP_MISMATCH: `a.step_code / step_seq` eltér az
 *    `episode_work_phases` sortól, amelynek `appointment_id = a.id`.
 *    Ilyenkor a `AppointmentBookingSection` badge-e más munkafázist mutat,
 *    mint a worklist sor — ez a diagnosztika segített felderíteni az
 *    eredeti Kontroll 2 ↔ Kontroll 3 csúszást.
 */
export const GET = authedHandler(async (_req, { params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  const episodeResult = await pool.query(
    `SELECT pe.id, pe.status, pe.patient_id as "patientId"
     FROM patient_episodes pe
     WHERE pe.id = $1`,
    [episodeId]
  );

  if (episodeResult.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }

  const episode = episodeResult.rows[0];
  const violations: Violation[] = [];

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
  if (episode.status === 'closed') {
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

  // 4) EWP_DANGLING_APPOINTMENT_LINK
  //    ewp.appointment_id IS NOT NULL, de a hivatkozott sor nem LÁTHATÓ
  //    (cancelled / unsuccessful / no_show / nem létezik). A worklist
  //    SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT szerint szűri a BOOKED
  //    matching-et, és emiatt ez a drift a UI-on pont ezt a jelenséget
  //    produkálja, ami a reassign-step „cél már foglalt" hamis riasztáshoz
  //    is vezetett eredetileg.
  const danglingResult = await pool.query(
    `SELECT ewp.id                      AS "workPhaseId",
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
       )
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

  // 5) APPOINTMENT_STEP_MISMATCH
  //    ewp.appointment_id mutat egy AKTÍV appointmentre, de
  //    a.step_code / step_seq nem egyezik az ewp saját work_phase_code /
  //    pathway_order_index-ével. A worklist matching a COALESCE-szel
  //    ezt elfedi, de a `AppointmentBookingSection` snapshot-ot mutat,
  //    így a két hely különbözőt ír — ez a drift okozta az eredeti
  //    „Kontroll 2 vs Kontroll 3" zavart.
  const mismatchResult = await pool.query(
    `SELECT ewp.id                        AS "workPhaseId",
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

  return NextResponse.json({
    episodeId,
    status: episode.status,
    violations,
    ok: violations.length === 0,
  });
});

/**
 * POST /api/episodes/:id/scheduling-integrity/repair
 *
 * Biztonságos, szűk hatókörű automatikus javítás:
 *  - `EWP_DANGLING_APPOINTMENT_LINK` → `ewp.appointment_id = NULL`,
 *    `scheduled → pending` (ha az volt), audit-bejegyzéssel.
 *  - `APPOINTMENT_STEP_MISMATCH` → `appointments.step_code` és `step_seq`
 *    átírása az ewp szerint (az ewp az SSOT, mert a worklist is így matchel).
 *
 * A művelet IDEMPOTENT és auditált. NEM módosít slot-ot, nem törli a
 * foglalást, nem nyúl a kezelési úthoz.
 *
 * Csak admin / beutalo_orvos / fogpótlástanász hívhatja.
 */
export const POST = roleHandler(
  ['admin', 'beutalo_orvos', 'fogpótlástanász'],
  async (req, { auth, params }) => {
    const episodeId = params.id;
    const pool = getDbPool();

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const reasonInput = typeof body?.reason === 'string' ? body.reason.trim() : '';

    const episodeResult = await pool.query(
      `SELECT pe.id, pe.status FROM patient_episodes pe WHERE pe.id = $1`,
      [episodeId]
    );
    if (episodeResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Epizód nem található' },
        { status: 404 }
      );
    }

    const changedBy = auth.email ?? auth.userId ?? 'unknown';
    const reasonSuffix = reasonInput.length > 0 ? ` — ${reasonInput}` : '';

    const dangling = await pool.query(
      `SELECT ewp.id                      AS "workPhaseId",
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
         )`,
      [episodeId]
    );

    const mismatch = await pool.query(
      `SELECT ewp.id                        AS "workPhaseId",
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
         )`,
      [episodeId]
    );

    if (dangling.rows.length === 0 && mismatch.rows.length === 0) {
      return NextResponse.json({
        ok: true,
        danglingCleared: 0,
        mismatchRepaired: 0,
        message: 'Nincs mit javítani',
      });
    }

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

        if (current.status === 'scheduled') {
          await client.query(
            `INSERT INTO episode_work_phase_audit
               (episode_work_phase_id, episode_id, old_status, new_status, changed_by, reason)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              row.workPhaseId,
              episodeId,
              'scheduled',
              'pending',
              changedBy,
              `integrity repair: dangling appointment_id takarítása (mutatott: ${row.appointmentId}, status: ${row.appointmentMissing ? 'MISSING' : (row.appointmentStatus ?? 'NULL')})${reasonSuffix}`,
            ]
          );
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
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('[scheduling-integrity/repair] transaction failed', {
        episodeId,
        err,
      });
      return NextResponse.json(
        { error: 'Integritás-javítás nem sikerült — adatbázis hiba' },
        { status: 500 }
      );
    } finally {
      client.release();
    }

    try {
      await logActivity(
        req,
        auth.email,
        'episode_integrity_repaired',
        `Episode ${episodeId}: ${dangling.rows.length} dangling link takarítva, ${mismatch.rows.length} step mismatch javítva${reasonSuffix}`
      );
    } catch {
      /* non-blocking */
    }

    try {
      await emitSchedulingEvent(
        'episode',
        episodeId,
        'integrity_repaired'
      );
    } catch {
      /* non-blocking */
    }

    return NextResponse.json({
      ok: true,
      danglingCleared: dangling.rows.length,
      mismatchRepaired: mismatch.rows.length,
    });
  }
);

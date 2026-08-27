import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import {
  autoRepairSchedulingIntegrity,
  detectSchedulingIntegrityViolations,
  type SchedulingIntegrityViolation,
} from '@/lib/scheduling-integrity';
import {
  SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT,
  SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT,
} from '@/lib/active-appointment';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/scheduling-integrity — teljes állomány-szintű integritás-scan
 * az /admin „Ütemezési integritás" fülhöz (WP-1.2).
 *
 * Két lépésben dolgozik:
 *  1. A JAVÍTHATÓ violationöket (stale foglalás-link, step_code eltérés)
 *     automatikusan rendbe teszi (lib/scheduling-integrity.ts — idempotens,
 *     auditált, nem kérdez).
 *  2. A maradékot epizódonként, beteg-linkkel adja vissza — ez a lista a
 *     karton helyett itt, admin felületen él, technikai nyelvezettel.
 *
 * Nem vezet be blokkoló állapotot: a lista tisztán diagnosztikai.
 */

/** Egy scan-futásban legfeljebb ennyi epizódot javítunk automatikusan. */
const AUTO_REPAIR_EPISODE_CAP = 50;
/** Legfeljebb ennyi violation-os epizódot részletezünk a válaszban. */
const DETAIL_EPISODE_CAP = 100;

interface EpisodeIntegrityReport {
  episodeId: string;
  episodeStatus: string;
  patientId: string | null;
  patientName: string | null;
  violations: SchedulingIntegrityViolation[];
}

export const GET = roleHandler(['admin', 'fogpótlástanász'], async (_req, { auth }) => {
  const pool = getDbPool();

  // ── 1) Auto-repair: epizódok javítható violationnel ───────────────────────
  const repairCandidates = await pool.query(
    `SELECT DISTINCT ewp.episode_id AS "episodeId"
     FROM episode_work_phases ewp
     LEFT JOIN appointments a ON a.id = ewp.appointment_id
     WHERE ewp.appointment_id IS NOT NULL
       AND (
         a.id IS NULL
         OR NOT ${SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT}
       )
     UNION
     SELECT DISTINCT ewp.episode_id AS "episodeId"
     FROM episode_work_phases ewp
     JOIN appointments a ON a.id = ewp.appointment_id
     WHERE ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
       AND (
         a.step_code IS DISTINCT FROM ewp.work_phase_code
         OR a.step_seq IS DISTINCT FROM ewp.pathway_order_index
       )`
  );

  const candidateIds: string[] = repairCandidates.rows.map(
    (r: { episodeId: string }) => r.episodeId
  );
  const toRepair = candidateIds.slice(0, AUTO_REPAIR_EPISODE_CAP);

  let danglingCleared = 0;
  let mismatchRepaired = 0;
  let repairedEpisodes = 0;
  for (const episodeId of toRepair) {
    const result = await autoRepairSchedulingIntegrity(pool, episodeId, {
      changedBy: `auto-repair (admin scan, ${auth.email ?? auth.userId ?? 'ismeretlen'})`,
      trigger: 'admin scan',
    });
    if (result && (result.danglingCleared > 0 || result.mismatchRepaired > 0)) {
      repairedEpisodes += 1;
      danglingCleared += result.danglingCleared;
      mismatchRepaired += result.mismatchRepaired;
    }
  }

  // ── 2) Maradék violationök epizódonként ──────────────────────────────────
  const violatingEpisodeIds = new Set<string>();

  // ONE_HARD_NEXT_VIOLATION
  const oneHardNext = await pool.query(
    `SELECT episode_id AS "episodeId"
     FROM appointments
     WHERE episode_id IS NOT NULL AND pool = 'work'
       AND start_time > CURRENT_TIMESTAMP
       AND (appointment_status IS NULL OR appointment_status = 'completed')
       AND requires_precommit = false
       AND is_chain_reservation = false
     GROUP BY episode_id
     HAVING COUNT(*) > 1`
  );
  for (const row of oneHardNext.rows as Array<{ episodeId: string }>) {
    violatingEpisodeIds.add(row.episodeId);
  }

  // INTENT_OPEN_EPISODE_CLOSED
  const openIntentClosed = await pool.query(
    `SELECT DISTINCT si.episode_id AS "episodeId"
     FROM slot_intents si
     JOIN patient_episodes pe ON pe.id = si.episode_id
     WHERE si.state = 'open' AND pe.status = 'closed'`
  );
  for (const row of openIntentClosed.rows as Array<{ episodeId: string }>) {
    violatingEpisodeIds.add(row.episodeId);
  }

  // APPOINTMENT_NO_SLOT
  const apptNoSlot = await pool.query(
    `SELECT DISTINCT a.episode_id AS "episodeId"
     FROM appointments a
     LEFT JOIN available_time_slots ats ON a.time_slot_id = ats.id
     WHERE a.episode_id IS NOT NULL AND ats.id IS NULL
       AND (a.appointment_status IS NULL OR a.appointment_status = 'completed')`
  );
  for (const row of apptNoSlot.rows as Array<{ episodeId: string }>) {
    violatingEpisodeIds.add(row.episodeId);
  }

  // Javítható kategóriák maradéka (pl. cap fölötti epizódok, vagy verseny
  // közben újratermelődött drift) — ezek is a listába kerülnek.
  const repairableLeft = await pool.query(
    `SELECT DISTINCT ewp.episode_id AS "episodeId"
     FROM episode_work_phases ewp
     LEFT JOIN appointments a ON a.id = ewp.appointment_id
     WHERE ewp.appointment_id IS NOT NULL
       AND (
         a.id IS NULL
         OR NOT ${SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT}
       )
     UNION
     SELECT DISTINCT ewp.episode_id AS "episodeId"
     FROM episode_work_phases ewp
     JOIN appointments a ON a.id = ewp.appointment_id
     WHERE ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
       AND (
         a.step_code IS DISTINCT FROM ewp.work_phase_code
         OR a.step_seq IS DISTINCT FROM ewp.pathway_order_index
       )`
  );
  for (const row of repairableLeft.rows as Array<{ episodeId: string }>) {
    violatingEpisodeIds.add(row.episodeId);
  }

  const detailIds = Array.from(violatingEpisodeIds).slice(0, DETAIL_EPISODE_CAP);

  const episodes: EpisodeIntegrityReport[] = [];
  if (detailIds.length > 0) {
    const metaResult = await pool.query(
      `SELECT pe.id, pe.status, pe.patient_id AS "patientId", p.nev AS "patientName"
       FROM patient_episodes pe
       LEFT JOIN patients p ON p.id = pe.patient_id
       WHERE pe.id = ANY($1::uuid[])`,
      [detailIds]
    );
    const metaById = new Map<
      string,
      { status: string; patientId: string | null; patientName: string | null }
    >(
      (metaResult.rows as Array<{
        id: string;
        status: string;
        patientId: string | null;
        patientName: string | null;
      }>).map((r) => [
        r.id,
        { status: r.status, patientId: r.patientId, patientName: r.patientName },
      ])
    );

    for (const episodeId of detailIds) {
      const meta = metaById.get(episodeId);
      if (!meta) continue;
      const violations = await detectSchedulingIntegrityViolations(
        pool,
        episodeId,
        meta.status
      );
      if (violations.length === 0) continue;
      episodes.push({
        episodeId,
        episodeStatus: meta.status,
        patientId: meta.patientId,
        patientName: meta.patientName,
        violations,
      });
    }
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    autoRepair: {
      candidateEpisodes: candidateIds.length,
      repairedEpisodes,
      danglingCleared,
      mismatchRepaired,
      capped: candidateIds.length > AUTO_REPAIR_EPISODE_CAP,
    },
    episodes,
    truncated: violatingEpisodeIds.size > DETAIL_EPISODE_CAP,
    ok: episodes.length === 0,
  });
});

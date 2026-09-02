import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { insertWorkPhaseAudit } from '@/lib/work-phase-audit';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';

export const dynamic = 'force-dynamic';

const ROLES = ['admin', 'beutalo_orvos', 'fogpótlástanász'] as const;

interface VisitPhaseRow {
  id: string;
  status: 'pending' | 'scheduled' | 'completed' | 'skipped';
  duration_minutes: number | null;
  merged_into_episode_work_phase_id: string | null;
  work_phase_code: string;
}

/**
 * POST /api/episodes/:id/visits/:visitId/prepare-booking
 *
 * Egy alkalom = EGY időpont. Foglalás előtt az alkalom még nyitott (pending /
 * scheduled), nem összevont fázisait egy foglalható blokkba vonjuk: az első
 * (foglalt, ha van; különben a sorrendben első) lesz a primary, a többi
 * pending sor a meglévő merge-mechanizmussal (merged_into_episode_work_phase_id)
 * alá kerül — a worklist, a projektor és a lánc így egy sort lát.
 *
 * A primary időtartama az alkalom `planned_duration_minutes`-e, ha van;
 * különben a MOST beolvasztott tagok percét adjuk hozzá (idempotens: ha nincs
 * beolvasztandó, nem nyúlunk a perchez).
 *
 * Válasz: { primaryWorkPhaseId, mergedCount, durationMinutes }. Egyetlen nyitott
 * fázisnál nincs változás, csak visszaadjuk az azonosítót. Nincs nyitott fázis
 * → 409 VISIT_NOT_BOOKABLE.
 */
export const POST = roleHandler([...ROLES], async (_req, { auth, params }) => {
  const episodeId = params.id;
  const visitId = params.visitId;
  const pool = getDbPool();
  const client = await pool.connect();
  let didChange = false;
  try {
    await client.query('BEGIN');
    const visitRow = await client.query(
      `SELECT v.id, v.planned_duration_minutes, pe.status AS episode_status
       FROM episode_visits v
       JOIN patient_episodes pe ON pe.id = v.episode_id
       WHERE v.id = $1 AND v.episode_id = $2
       FOR UPDATE OF v FOR SHARE OF pe`,
      [visitId, episodeId]
    );
    if (visitRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Alkalom nem található' }, { status: 404 });
    }
    if (visitRow.rows[0].episode_status !== 'open') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Lezárt epizód alkalmai nem módosíthatók', code: 'EPISODE_NOT_OPEN' },
        { status: 409 }
      );
    }
    const plannedDuration: number | null =
      visitRow.rows[0].planned_duration_minutes != null
        ? Number(visitRow.rows[0].planned_duration_minutes)
        : null;

    const phaseRows = await client.query(
      `SELECT id, status, duration_minutes, merged_into_episode_work_phase_id, work_phase_code
       FROM episode_work_phases
       WHERE visit_id = $1 AND episode_id = $2
       ORDER BY COALESCE(seq, pathway_order_index), pathway_order_index, id
       FOR UPDATE`,
      [visitId, episodeId]
    );
    const rows = phaseRows.rows as VisitPhaseRow[];
    const openPrimaries = rows.filter(
      (r) => !r.merged_into_episode_work_phase_id && (r.status === 'pending' || r.status === 'scheduled')
    );
    if (openPrimaries.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Az alkalomban nincs foglalható (nyitott) munkafázis', code: 'VISIT_NOT_BOOKABLE' },
        { status: 409 }
      );
    }
    // Ha egy tag már foglalt, az a blokk — a többi pending alá kerül.
    const primary = openPrimaries.find((r) => r.status === 'scheduled') ?? openPrimaries[0];
    const toMerge = openPrimaries.filter((r) => r.id !== primary.id && r.status === 'pending');

    let durationMinutes = Number(primary.duration_minutes ?? 30);
    if (toMerge.length > 0) {
      const mergeIds = toMerge.map((r) => r.id);
      await client.query(
        `UPDATE episode_work_phases SET merged_into_episode_work_phase_id = $1
         WHERE id = ANY($2) AND episode_id = $3`,
        [primary.id, mergeIds, episodeId]
      );
      // Láncolt merge lapítása: a beolvasztott sorok saját gyerekei is a
      // primary alá kerülnek (a merged_into lánc lapos marad).
      await client.query(
        `UPDATE episode_work_phases SET merged_into_episode_work_phase_id = $1
         WHERE merged_into_episode_work_phase_id = ANY($2) AND episode_id = $3 AND id <> $1`,
        [primary.id, mergeIds, episodeId]
      );
      for (const row of toMerge) {
        await insertWorkPhaseAudit(client, {
          episodeWorkPhaseId: row.id,
          episodeId,
          oldStatus: row.status,
          newStatus: row.status,
          changedBy: auth.email ?? auth.userId ?? 'unknown',
          changeType: 'merge',
          reason: `Egy időpontra vonva a(z) ${primary.work_phase_code} fázissal (alkalom foglalása)`,
        });
      }
      const addedMinutes = toMerge.reduce((acc, r) => acc + Number(r.duration_minutes ?? 0), 0);
      const newDuration = plannedDuration ?? durationMinutes + addedMinutes;
      if (newDuration > 0 && newDuration !== durationMinutes) {
        await client.query(`UPDATE episode_work_phases SET duration_minutes = $1 WHERE id = $2`, [
          newDuration,
          primary.id,
        ]);
        await insertWorkPhaseAudit(client, {
          episodeWorkPhaseId: primary.id,
          episodeId,
          oldStatus: primary.status,
          newStatus: primary.status,
          changedBy: auth.email ?? auth.userId ?? 'unknown',
          changeType: 'timing_change',
          reason: `Időzítés módosítva: időtartam ${durationMinutes}→${newDuration} perc (alkalom egy blokkban)`,
        });
        durationMinutes = newDuration;
      }
      didChange = true;
    } else if (plannedDuration != null && plannedDuration !== durationMinutes) {
      await client.query(`UPDATE episode_work_phases SET duration_minutes = $1 WHERE id = $2`, [
        plannedDuration,
        primary.id,
      ]);
      await insertWorkPhaseAudit(client, {
        episodeWorkPhaseId: primary.id,
        episodeId,
        oldStatus: primary.status,
        newStatus: primary.status,
        changedBy: auth.email ?? auth.userId ?? 'unknown',
        changeType: 'timing_change',
        reason: `Időzítés módosítva: időtartam ${durationMinutes}→${plannedDuration} perc (alkalom tervezett hossza)`,
      });
      durationMinutes = plannedDuration;
      didChange = true;
    }

    await client.query('COMMIT');

    if (didChange) {
      try {
        await projectRemainingSteps(episodeId);
      } catch {
        /* non-blocking — a projektor a következő releváns eseménynél újrafut */
      }
      try {
        await emitSchedulingEvent('episode', episodeId, 'steps_merged');
      } catch {
        /* non-blocking */
      }
    }

    return NextResponse.json({
      primaryWorkPhaseId: primary.id,
      mergedCount: toMerge.length,
      durationMinutes,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});

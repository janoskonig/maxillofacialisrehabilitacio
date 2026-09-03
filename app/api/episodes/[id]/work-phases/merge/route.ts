import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { getFullWorkPhaseQuery } from '@/lib/episode-work-phase-select';
import { insertWorkPhaseAudit } from '@/lib/work-phase-audit';
import { createEpisodeVisit } from '@/lib/episode-visits';

export const dynamic = 'force-dynamic';

/**
 * POST /api/episodes/:id/work-phases/merge
 * Merge multiple steps into one group (same appointment slot).
 * Body: { stepIds: string[] } — at least 2. First ID becomes the "primary" step.
 * Child rows keep their pathway offset in DB, but scheduling (slot-intent projector, worklist) ignores
 * merged children so pathway anchor does not advance once per merged step.
 */
export const POST = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const body = await req.json();
  const { stepIds } = body;

  if (!Array.isArray(stepIds) || stepIds.length < 2) {
    return NextResponse.json({ error: 'Legalább 2 munkafázis szükséges az összevonáshoz' }, { status: 400 });
  }

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const stepsResult = await client.query(
      `SELECT es.id, es.episode_id, es.work_phase_code, es.status, es.merged_into_episode_work_phase_id, pe.status as ep_status
       FROM episode_work_phases es
       JOIN patient_episodes pe ON es.episode_id = pe.id
       WHERE es.episode_id = $1 AND es.id = ANY($2)
       FOR UPDATE OF es`,
      [episodeId, stepIds]
    );

    if (stepsResult.rows.length !== stepIds.length) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Nem minden munkafázis tartozik ehhez az epizódhoz' }, { status: 400 });
    }

    const epStatus = stepsResult.rows[0].ep_status;
    if (epStatus !== 'open') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Csak aktív epizód munkafázisai vonhatók össze' }, { status: 400 });
    }

    for (const row of stepsResult.rows) {
      if (row.status === 'completed') {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Befejezett munkafázis nem vonható össze' }, { status: 400 });
      }
      if (row.merged_into_episode_work_phase_id) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Már összevont munkafázis nem vonható újra össze' }, { status: 400 });
      }
    }

    const primaryId = stepIds[0];
    const secondaryIds = stepIds.slice(1);

    await client.query(
      `UPDATE episode_work_phases SET merged_into_episode_work_phase_id = $1 WHERE id = ANY($2) AND episode_id = $3`,
      [primaryId, secondaryIds, episodeId]
    );

    // Láncolt merge LAPÍTÁSA (review-javítás): ha egy secondary maga is
    // csoport-primary volt (vannak rá mutató gyerekek), a gyerekei átkerülnek
    // az ÚJ primary alá — a merged_into lánc mindig lapos marad (gyerek →
    // csoport-primary, sosem gyerek → gyerek), és lentebb a vizit-tagságuk is
    // a primary vizitjébe költözik. E nélkül a csoport két vizitre esne szét.
    const reparented = await client.query(
      `UPDATE episode_work_phases
       SET merged_into_episode_work_phase_id = $1
       WHERE merged_into_episode_work_phase_id = ANY($2) AND episode_id = $3 AND id <> $1
       RETURNING id, status`,
      [primaryId, secondaryIds, episodeId]
    );
    const reparentedRows = reparented.rows as Array<{ id: string; status: string }>;
    // A vizit-mozgatás a secondarykre ÉS az átcsoportosított gyerekeikre is.
    const movedIds: string[] = [...secondaryIds, ...reparentedRows.map((r) => r.id)];

    // WP-4.1a: a merge vizit-tagságot is jelent — a gyerekek a primary
    // vizitjébe kerülnek. A merged_into mező írása változatlanul megmarad
    // (kompatibilitás). Ha a primarynek (backfill előtti sor) még nincs
    // vizitje, kap egyet.
    const primaryVisitRow = await client.query(
      `SELECT visit_id, default_days_offset FROM episode_work_phases WHERE id = $1`,
      [primaryId]
    );
    let primaryVisitId: string | null = primaryVisitRow.rows[0]?.visit_id ?? null;
    if (!primaryVisitId) {
      const visit = await createEpisodeVisit(client, {
        episodeId,
        daysOffset: primaryVisitRow.rows[0]?.default_days_offset ?? null,
      });
      primaryVisitId = visit.id;
      await client.query(`UPDATE episode_work_phases SET visit_id = $1 WHERE id = $2`, [
        primaryVisitId,
        primaryId,
      ]);
    }

    const oldVisitRows = await client.query(
      `SELECT DISTINCT visit_id FROM episode_work_phases
       WHERE id = ANY($1) AND visit_id IS NOT NULL AND visit_id <> $2`,
      [movedIds, primaryVisitId]
    );
    await client.query(
      `UPDATE episode_work_phases SET visit_id = $1 WHERE id = ANY($2) AND episode_id = $3`,
      [primaryVisitId, movedIds, episodeId]
    );
    // Puzzle v2: az üres alkalom NEM tűnik el automatikusan (a felhasználó
    // kérése) — a kiürült alkalmak megmaradnak, kézzel törölhetők.
    void oldVisitRows;

    // WP-2.1: az összevonás naplózása — soronként a másodlagos (beolvasztott)
    // fázisokon; a reason az elsődleges fázis kódját hordozza.
    const rowById = new Map(
      (stepsResult.rows as Array<{ id: string; work_phase_code: string; status: string }>).map(
        (r) => [r.id, r]
      )
    );
    const primaryCode = rowById.get(primaryId)?.work_phase_code ?? primaryId;
    for (const secondaryId of secondaryIds as string[]) {
      const row = rowById.get(secondaryId);
      await insertWorkPhaseAudit(client, {
        episodeWorkPhaseId: secondaryId,
        episodeId,
        oldStatus: row?.status ?? null,
        newStatus: row?.status ?? null,
        changedBy: auth.email ?? auth.userId ?? 'unknown',
        changeType: 'merge',
        reason: `Összevonva a(z) ${primaryCode} fázis alá`,
      });
    }
    // A lapításnál átcsoportosított (korábbi csoport-gyerek) sorok is kapnak
    // napló-sort — ők nem szerepeltek a kérés stepIds-ében.
    for (const child of reparentedRows) {
      await insertWorkPhaseAudit(client, {
        episodeWorkPhaseId: child.id,
        episodeId,
        oldStatus: child.status,
        newStatus: child.status,
        changedBy: auth.email ?? auth.userId ?? 'unknown',
        changeType: 'merge',
        reason: `Átcsoportosítva a(z) ${primaryCode} fázis alá (láncolt összevonás lapítása)`,
      });
    }

    await client.query('COMMIT');

    try {
      await emitSchedulingEvent('episode', episodeId, 'steps_merged');
    } catch { /* non-blocking */ }

    const allPhases = await getFullWorkPhaseQuery(pool, episodeId);
    return NextResponse.json({ workPhases: allPhases.rows, primaryWorkPhaseId: primaryId });
  } catch (txError) {
    await client.query('ROLLBACK');
    throw txError;
  } finally {
    client.release();
  }
});

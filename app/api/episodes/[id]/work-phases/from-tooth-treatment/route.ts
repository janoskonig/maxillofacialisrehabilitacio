import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { getFullWorkPhaseQuery } from '@/lib/episode-work-phase-select';
import { insertWorkPhaseAudit } from '@/lib/work-phase-audit';
import { createEpisodeVisit } from '@/lib/episode-visits';
import { DEFAULT_VISIT_GAP_DAYS } from '@/lib/visit-plan-constants';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';
import { renumberPhasesByVisitOrder, syncVisitAppointment } from '@/lib/visit-appointment-sync';

export const dynamic = 'force-dynamic';

/**
 * POST /api/episodes/:id/work-phases/from-tooth-treatment
 * Add a linked tooth treatment as a step in the episode's pathway.
 * Body: { toothTreatmentId: string, visitId?: string }
 *
 * Puzzle v2: `visitId` → a fog-fázis a megadott, meglévő alkalomba születik
 * (egy kérés); különben új alkalom a lista végére, DEFAULT_VISIT_GAP_DAYS
 * lépésközzel. Válasz: { workPhases, workPhaseId, visit } — a `visit` az új
 * alkalom metaadata (meglévőbe szúrásnál null).
 */
export const POST = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const body = await req.json();
  const { toothTreatmentId, visitId: rawVisitId } = body;

  if (!toothTreatmentId || typeof toothTreatmentId !== 'string') {
    return NextResponse.json({ error: 'toothTreatmentId kötelező' }, { status: 400 });
  }
  if (rawVisitId != null && typeof rawVisitId !== 'string') {
    return NextResponse.json({ error: 'A visitId string azonosító legyen' }, { status: 400 });
  }
  const targetVisitId: string | null = typeof rawVisitId === 'string' ? rawVisitId : null;

  const pool = getDbPool();

  const epRow = await pool.query(
    `SELECT id, status FROM patient_episodes WHERE id = $1`,
    [episodeId]
  );
  if (epRow.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }
  if (epRow.rows[0].status !== 'open') {
    return NextResponse.json({ error: 'Csak aktív epizódhoz adható munkafázis' }, { status: 400 });
  }

  const ttRow = await pool.query(
    `SELECT tt.id, tt.episode_id, tt.treatment_code, tt.tooth_number, tt.status,
            ttc.label_hu as "labelHu"
     FROM tooth_treatments tt
     JOIN tooth_treatment_catalog ttc ON tt.treatment_code = ttc.code
     WHERE tt.id = $1`,
    [toothTreatmentId]
  );

  if (ttRow.rows.length === 0) {
    return NextResponse.json({ error: 'Fogkezelés nem található' }, { status: 404 });
  }

  const tt = ttRow.rows[0];

  if (tt.episode_id !== episodeId) {
    return NextResponse.json({ error: 'A fogkezelés nem ehhez az epizódhoz tartozik' }, { status: 400 });
  }
  // 'pending' is elfogadott (WP-0.7): a fog-fázis törlése a tooth_treatments
  // sort 'pending'-re állítja vissza, hogy a fog-szinkron ne tegye vissza
  // automatikusan — a kézi újra-hozzáadás itt továbbra is lehetséges, és a
  // sort újra 'episode_linked'-re állítja.
  if (tt.status !== 'episode_linked' && tt.status !== 'pending') {
    return NextResponse.json({ error: 'Csak epizódhoz kapcsolt fogkezelés adható a munkafázis-sorhoz' }, { status: 400 });
  }

  const alreadyExists = await pool.query(
    `SELECT 1 FROM episode_work_phases WHERE episode_id = $1 AND tooth_treatment_id = $2`,
    [episodeId, toothTreatmentId]
  );
  if (alreadyExists.rows.length > 0) {
    return NextResponse.json({ error: 'Ez a fogkezelés már a munkafázis-sorban van' }, { status: 409 });
  }

  const maxSeqRow = await pool.query(
    `SELECT COALESCE(MAX(seq), -1) as max_seq FROM episode_work_phases WHERE episode_id = $1`,
    [episodeId]
  );
  const nextSeq = (maxSeqRow.rows[0].max_seq ?? -1) + 1;

  const maxIdxRow = await pool.query(
    `SELECT COALESCE(MAX(pathway_order_index), -1) as max_idx FROM episode_work_phases WHERE episode_id = $1`,
    [episodeId]
  );
  const nextIdx = (maxIdxRow.rows[0].max_idx ?? -1) + 1;

  const workPhaseCode = `tooth_${tt.treatment_code}`;
  const customLabel = `${tt.labelHu} – ${tt.tooth_number}`;

  // A fázis-INSERT és a tooth_treatments.status visszaállítása EGY
  // tranzakcióban fut: külön commitolva egy közbeeső hiba kétállapotú
  // invariáns-sértést hagyna (van fog-fázis, de a sor 'pending' maradt — a
  // fog-szinkron szűrője és a Fogkezelés fül nézete szétcsúszna).
  let insertedId: string | null = null;
  let createdVisit: {
    id: string;
    seq: number;
    label: string | null;
    daysOffset: number | null;
    plannedDurationMinutes: number | null;
  } | null = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let visitIdToUse: string;
    if (targetVisitId) {
      const target = await client.query(
        `SELECT id FROM episode_visits WHERE id = $1 AND episode_id = $2 FOR UPDATE`,
        [targetVisitId, episodeId]
      );
      if (target.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'A cél-alkalom nem található ebben az epizódban', code: 'VISIT_NOT_FOUND' },
          { status: 404 }
        );
      }
      visitIdToUse = targetVisitId;
    } else {
      // WP-4.1a invariáns: minden új fázis vizitbe születik — új alkalom a
      // vizit-lista végére, a vizit-alap lépésközzel (7 nap).
      const visit = await createEpisodeVisit(client, { episodeId, daysOffset: DEFAULT_VISIT_GAP_DAYS });
      visitIdToUse = visit.id;
      createdVisit = {
        id: visit.id,
        seq: visit.seq,
        label: null,
        daysOffset: DEFAULT_VISIT_GAP_DAYS,
        plannedDurationMinutes: null,
      };
    }
    const inserted = await client.query(
      `INSERT INTO episode_work_phases (episode_id, work_phase_code, pathway_order_index, pool, duration_minutes, default_days_offset, seq, tooth_treatment_id, custom_label, visit_id)
       VALUES ($1, $2, $3, 'work', 30, $8, $4, $5, $6, $7)
       RETURNING id`,
      [episodeId, workPhaseCode, nextIdx, nextSeq, toothTreatmentId, customLabel, visitIdToUse, DEFAULT_VISIT_GAP_DAYS]
    );
    insertedId = String(inserted.rows[0].id);
    if (targetVisitId) {
      // Fázis-seq az alkalom-sorrend szerint (a friss sor az alkalmán belül utolsó),
      // majd a blokk/időpont-invariánsok (egy alkalom = egy időpont).
      await renumberPhasesByVisitOrder(client, episodeId, insertedId);
      await syncVisitAppointment(client, episodeId, targetVisitId, auth.email ?? auth.userId ?? 'unknown');
    }

    // WP-2.1: a fogkezelésből létrehozott fázis is naplózódik.
    await insertWorkPhaseAudit(client, {
      episodeWorkPhaseId: inserted.rows[0].id,
      episodeId,
      oldStatus: null,
      newStatus: 'pending',
      changedBy: auth.email ?? auth.userId ?? 'unknown',
      changeType: 'create',
      reason: `Fogkezelésből hozzáadva: ${tt.labelHu} – ${tt.tooth_number}`,
    });

    if (tt.status === 'pending') {
      await client.query(`UPDATE tooth_treatments SET status = 'episode_linked' WHERE id = $1`, [toothTreatmentId]);
    }

    await client.query('COMMIT');
  } catch (txError) {
    await client.query('ROLLBACK').catch(() => {});
    throw txError;
  } finally {
    client.release();
  }

  if (targetVisitId) {
    try {
      await projectRemainingSteps(episodeId);
    } catch {
      /* non-blocking */
    }
  }
  try {
    await emitSchedulingEvent('episode', episodeId, 'step_added');
  } catch { /* non-blocking */ }

  const allPhases = await getFullWorkPhaseQuery(pool, episodeId);

  return NextResponse.json(
    { workPhases: allPhases.rows, workPhaseId: insertedId, visit: createdVisit },
    { status: 201 }
  );
});

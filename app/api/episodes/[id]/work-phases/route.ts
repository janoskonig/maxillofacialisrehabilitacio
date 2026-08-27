import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { getFullWorkPhaseQuery } from '@/lib/episode-work-phase-select';
import {
  autoRepairSchedulingIntegrity,
  getLostAppointmentWorkPhaseIds,
} from '@/lib/scheduling-integrity';
import { insertWorkPhaseAudit } from '@/lib/work-phase-audit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/episodes/:id/work-phases — a kezelési terv olvasása (WP-0.7).
 *
 * A terv-kártya (EpisodeStepsManager) korábban a mutáló POST .../generate-tel
 * "olvasott" — a kártya megnyitása írhatott a DB-be, és a törölt fázisokat
 * visszatette. Az olvasás mostantól ez a mellékhatás-mentes GET; a generate
 * explicit, írásra szánt művelet maradt.
 *
 * WP-1.2 kivétel a mellékhatás-mentesség alól: a JAVÍTHATÓ integritás-
 * sérüléseket (stale foglalás-link, step_code eltérés) a rendszer itt,
 * olvasáskor magától rendbe teszi — idempotensen, auditáltan, kérdezés
 * nélkül (lib/scheduling-integrity.ts). Ez szándékosan NEM a generate-féle
 * destruktív írás: nem hoz létre és nem támaszt fel sorokat, csak a hibás
 * hivatkozásokat takarítja, és ha nincs mit javítani, nem ír semmit.
 * A `lostAppointmentWorkPhaseIds` a karton sor-szintű, klinikai jelzéséhez
 * kell: „ehhez a lépéshez már nincs élő időpont — foglaljon újat".
 */
export const GET = authedHandler(async (_req, { auth, params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  const epRow = await pool.query(`SELECT id FROM patient_episodes WHERE id = $1`, [episodeId]);
  if (epRow.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }

  const autoRepair = await autoRepairSchedulingIntegrity(pool, episodeId, {
    changedBy: `auto-repair (${auth.email ?? auth.userId ?? 'ismeretlen'})`,
    trigger: 'work-phases GET',
  });

  const allPhases = await getFullWorkPhaseQuery(pool, episodeId);
  const lostAppointmentWorkPhaseIds = await getLostAppointmentWorkPhaseIds(
    pool,
    episodeId
  );

  return NextResponse.json({
    workPhases: allPhases.rows,
    lostAppointmentWorkPhaseIds,
    autoRepair: autoRepair
      ? {
          danglingCleared: autoRepair.danglingCleared,
          mismatchRepaired: autoRepair.mismatchRepaired,
        }
      : null,
  });
});

/**
 * POST /api/episodes/:id/work-phases — add a work phase (from catalog or ad-hoc).
 * Body: { workPhaseCode?, stepCode? (legacy), pool?, durationMinutes?, defaultDaysOffset?, label? }
 */
export const POST = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const body = await req.json();
  const {
    workPhaseCode: rawWp,
    stepCode: legacyCode,
    pool: rawPool,
    durationMinutes: rawDuration,
    defaultDaysOffset: rawOffset,
    label,
  } = body;

  const rawWorkPhaseCode = typeof rawWp === 'string' ? rawWp : typeof legacyCode === 'string' ? legacyCode : '';

  const pool = getDbPool();

  const epRow = await pool.query(`SELECT id, status FROM patient_episodes WHERE id = $1`, [episodeId]);
  if (epRow.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }
  if (epRow.rows[0].status !== 'open') {
    return NextResponse.json({ error: 'Csak aktív epizódhoz adható munkafázis' }, { status: 400 });
  }

  const validPools = ['consult', 'work', 'control'];
  const phasePool = typeof rawPool === 'string' && validPools.includes(rawPool) ? rawPool : 'work';
  const durationMinutes = typeof rawDuration === 'number' && rawDuration > 0 ? rawDuration : 30;
  const defaultDaysOffset = typeof rawOffset === 'number' && rawOffset >= 0 ? rawOffset : 7;

  let workPhaseCode: string;
  let customLabel: string | null = null;
  let createdVia: string;

  if (rawWorkPhaseCode.trim().length > 0) {
    workPhaseCode = rawWorkPhaseCode.trim();
    createdVia = 'katalógusból';
    const catalogRow = await pool.query(
      `SELECT work_phase_code FROM work_phase_catalog WHERE work_phase_code = $1 AND is_active = true`,
      [workPhaseCode]
    );
    if (catalogRow.rows.length === 0 && typeof label === 'string' && label.trim().length > 0) {
      customLabel = label.trim();
    }
  } else {
    const prefix = `adhoc_${Date.now().toString(36)}`;
    workPhaseCode = prefix;
    createdVia = 'szabadszövegesen';
    if (typeof label === 'string' && label.trim().length > 0) {
      customLabel = label.trim();
    } else {
      return NextResponse.json({ error: 'Ad-hoc munkafázishoz label kötelező' }, { status: 400 });
    }
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

  // A fázis-INSERT és a 'create' audit sor (WP-2.1) EGY tranzakcióban fut,
  // hogy a napló ne maradhasson le a létrehozásról.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO episode_work_phases (episode_id, work_phase_code, pathway_order_index, pool, duration_minutes, default_days_offset, seq, custom_label, source_episode_pathway_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
       RETURNING id`,
      [episodeId, workPhaseCode, nextIdx, phasePool, durationMinutes, defaultDaysOffset, nextSeq, customLabel]
    );
    await insertWorkPhaseAudit(client, {
      episodeWorkPhaseId: inserted.rows[0].id,
      episodeId,
      oldStatus: null,
      newStatus: 'pending',
      changedBy: auth.email ?? auth.userId ?? 'unknown',
      changeType: 'create',
      reason: `Munkafázis hozzáadva (${createdVia})`,
    });
    await client.query('COMMIT');
  } catch (txError) {
    await client.query('ROLLBACK').catch(() => {});
    throw txError;
  } finally {
    client.release();
  }

  try {
    await emitSchedulingEvent('episode', episodeId, 'step_added');
  } catch {
    /* non-blocking */
  }

  const allPhases = await getFullWorkPhaseQuery(pool, episodeId);
  const added = allPhases.rows[allPhases.rows.length - 1];

  return NextResponse.json({ workPhase: added }, { status: 201 });
});

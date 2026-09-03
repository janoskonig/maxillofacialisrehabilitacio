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
import { createEpisodeVisit, listEpisodeVisits } from '@/lib/episode-visits';
import { DEFAULT_VISIT_GAP_DAYS } from '@/lib/visit-plan-constants';
import { probeColumnExists } from '@/lib/schema-probe';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';
import {
  listUnattachedAppointments,
  renumberPhasesByVisitOrder,
  syncVisitAppointment,
} from '@/lib/visit-appointment-sync';

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
  // WP-4.1a: vizit-metaadatok — a WP-4.3 alkalom-kártyás UI erre épül.
  const visits = await listEpisodeVisits(pool, episodeId);
  // Puzzle v2 (094): a vázhoz rendelhető, alkalom nélküli foglalt időpontok.
  const hasVisitAppointment = await probeColumnExists(pool, 'episode_visits', 'appointment_id');
  const unattachedAppointments = hasVisitAppointment
    ? await listUnattachedAppointments(pool, episodeId)
    : [];

  return NextResponse.json({
    workPhases: allPhases.rows,
    visits,
    unattachedAppointments,
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
 * Body: { workPhaseCode?, stepCode? (legacy), pool?, durationMinutes?, defaultDaysOffset?, label?,
 *         visitId?, daysOffset? }
 *
 * Vizit-alapú terv (puzzle v2):
 *   • `visitId` → a fázis a megadott, MEGLÉVŐ alkalomba születik, egy kérésben
 *     (a korábbi POST + PATCH visitId kettős kör kivezetve); a fázis-seq az
 *     alkalom-sorrend szerint átszámozódik, a friss sor az alkalom végére kerül.
 *   • különben ÚJ alkalom a lista végére, lépésköze `daysOffset`
 *     (alap: DEFAULT_VISIT_GAP_DAYS = 7 nap).
 *   A munkafázisnak nincs saját várakozási ideje — az EWP `default_days_offset`
 *   csak legacy fallback (vizit nélküli sorok), a lánc a vizit offsetjén jár.
 *   Katalógus-elemnél a 091-es paletta-alapértékek (időtartam, pool) töltik a
 *   meg nem adott mezőket.
 *
 * Válasz: { workPhase, visit } — a `visit` az újonnan létrehozott alkalom
 * metaadata (meglévő alkalomba szúrásnál null), hogy a kliens újratöltés
 * nélkül frissíthesse a tábláját.
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
    visitId: rawVisitId,
    daysOffset: rawVisitGap,
  } = body;

  const rawWorkPhaseCode = typeof rawWp === 'string' ? rawWp : typeof legacyCode === 'string' ? legacyCode : '';

  if (rawVisitId != null && typeof rawVisitId !== 'string') {
    return NextResponse.json({ error: 'A visitId string azonosító legyen' }, { status: 400 });
  }
  if (rawVisitGap != null && (!Number.isInteger(rawVisitGap) || rawVisitGap < 0)) {
    return NextResponse.json({ error: 'A daysOffset nem-negatív egész nap legyen' }, { status: 400 });
  }
  const targetVisitId: string | null = typeof rawVisitId === 'string' ? rawVisitId : null;
  // Az új alkalom lépésköze: explicit `daysOffset`; különben a legacy
  // `defaultDaysOffset` mező (a régi kliensek „a lépés eltolása" értelemben
  // küldik — a vizit-modellben ez az alkalom eltolása); különben 7 nap.
  const visitGapDays: number =
    Number.isInteger(rawVisitGap) && rawVisitGap >= 0
      ? rawVisitGap
      : typeof rawOffset === 'number' && Number.isInteger(rawOffset) && rawOffset >= 0
        ? rawOffset
        : DEFAULT_VISIT_GAP_DAYS;

  const pool = getDbPool();

  const epRow = await pool.query(`SELECT id, status FROM patient_episodes WHERE id = $1`, [episodeId]);
  if (epRow.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }
  if (epRow.rows[0].status !== 'open') {
    return NextResponse.json({ error: 'Csak aktív epizódhoz adható munkafázis' }, { status: 400 });
  }

  const validPools = ['consult', 'work', 'control'];
  let phasePool: string | null =
    typeof rawPool === 'string' && validPools.includes(rawPool) ? rawPool : null;
  let durationMinutes: number | null =
    typeof rawDuration === 'number' && rawDuration > 0 ? rawDuration : null;
  // Legacy fallback-oszlop: a vizit lépésközét tükrözi, a láncban nem játszik,
  // amíg a sornak van vizitje.
  const defaultDaysOffset = typeof rawOffset === 'number' && rawOffset >= 0 ? rawOffset : visitGapDays;

  let workPhaseCode: string;
  let customLabel: string | null = null;
  let createdVia: string;

  if (rawWorkPhaseCode.trim().length > 0) {
    workPhaseCode = rawWorkPhaseCode.trim();
    createdVia = 'katalógusból';
    const hasPalette = await probeColumnExists(pool, 'work_phase_catalog', 'palette_order');
    const catalogRow = await pool.query(
      `SELECT work_phase_code${hasPalette ? ', default_duration_minutes, default_pool' : ''}
       FROM work_phase_catalog WHERE work_phase_code = $1 AND is_active = true`,
      [workPhaseCode]
    );
    if (catalogRow.rows.length === 0) {
      if (typeof label === 'string' && label.trim().length > 0) {
        customLabel = label.trim();
      }
    } else if (hasPalette) {
      const cat = catalogRow.rows[0] as {
        default_duration_minutes: number | null;
        default_pool: string | null;
      };
      if (durationMinutes == null && cat.default_duration_minutes != null && cat.default_duration_minutes > 0) {
        durationMinutes = Number(cat.default_duration_minutes);
      }
      if (phasePool == null && cat.default_pool && validPools.includes(cat.default_pool)) {
        phasePool = cat.default_pool;
      }
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
  phasePool ??= 'work';
  durationMinutes ??= 30;

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
      // vizit-lista végére, lépésköze a vizit-alap (7 nap) vagy a kért érték.
      const visit = await createEpisodeVisit(client, {
        episodeId,
        daysOffset: visitGapDays,
      });
      visitIdToUse = visit.id;
      createdVisit = {
        id: visit.id,
        seq: visit.seq,
        label: null,
        daysOffset: visitGapDays,
        plannedDurationMinutes: null,
      };
    }
    const inserted = await client.query(
      `INSERT INTO episode_work_phases (episode_id, work_phase_code, pathway_order_index, pool, duration_minutes, default_days_offset, seq, custom_label, source_episode_pathway_id, visit_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9)
       RETURNING id`,
      [episodeId, workPhaseCode, nextIdx, phasePool, durationMinutes, defaultDaysOffset, nextSeq, customLabel, visitIdToUse]
    );
    insertedId = String(inserted.rows[0].id);
    if (targetVisitId) {
      // A sorrend igazsága az EWP COALESCE(seq, pathway_order_index) — meglévő
      // alkalomba szúrva a fázis-seq az alkalom-sorrendet kövesse (a friss sor
      // az alkalmán belül utolsó), különben a megjelenített alkalom-sorrend és
      // a motor/becslés/lánc némán széttartana.
      await renumberPhasesByVisitOrder(client, episodeId, insertedId);
      // Puzzle v2 (094): egy alkalom = egy időpont — a friss fázis a blokkba
      // kerül; ha az alkalomnak már van időpontja, a tartalom rácsúszik.
      await syncVisitAppointment(client, episodeId, targetVisitId, auth.email ?? auth.userId ?? 'unknown');
    }
    await insertWorkPhaseAudit(client, {
      episodeWorkPhaseId: insertedId,
      episodeId,
      oldStatus: null,
      newStatus: 'pending',
      changedBy: auth.email ?? auth.userId ?? 'unknown',
      changeType: 'create',
      reason: `Munkafázis hozzáadva (${createdVia}${targetVisitId ? ', meglévő alkalomba' : ', új alkalom'})`,
    });
    await client.query('COMMIT');
  } catch (txError) {
    await client.query('ROLLBACK').catch(() => {});
    throw txError;
  } finally {
    client.release();
  }

  if (targetVisitId) {
    // Seq-átszámozás után az intent-kulcsok (step_code, step_seq) elmozdultak.
    try {
      await projectRemainingSteps(episodeId);
    } catch {
      /* non-blocking — a projektor a következő releváns eseménynél újrafut */
    }
  }
  try {
    await emitSchedulingEvent('episode', episodeId, 'step_added');
  } catch {
    /* non-blocking */
  }

  const allPhases = await getFullWorkPhaseQuery(pool, episodeId);
  const added =
    allPhases.rows.find((r: { id: string }) => String(r.id) === insertedId) ??
    allPhases.rows[allPhases.rows.length - 1];

  return NextResponse.json({ workPhase: added, visit: createdVisit }, { status: 201 });
});

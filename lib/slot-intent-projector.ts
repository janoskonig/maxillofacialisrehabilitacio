/**
 * Slot intent projector: projects remaining pathway steps as demand signals (slot_intents).
 * Uses advisory lock per episode, batch UPSERT, and pathway hash for drift detection.
 */

import type { PoolClient } from 'pg';
import { getDbPool } from './db';
import { computeStepWindow } from './step-window';
import { slotPoolForStep, type PathwayWorkPhaseTemplate } from './next-step-engine';
import { normalizePathwayWorkPhaseArray } from './pathway-work-phases-for-episode';
import { groupProjectionUnits } from './slot-intent-projection-units';

const BUDAPEST_TZ = 'Europe/Budapest';

function getBudapestHourMinute(d: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUDAPEST_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  return {
    hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0),
    minute: Number(parts.find((p) => p.type === 'minute')?.value ?? 0),
  };
}

/** Build a UTC Date that represents `localHour:localMinute` in Budapest on the given date. */
function budapestLocalToUTC(dateISO: string, localHour: number, localMinute: number): Date {
  for (const offset of [1, 2]) {
    const utcH = localHour - offset;
    const candidate = new Date(`${dateISO}T${String(utcH).padStart(2, '0')}:${String(localMinute).padStart(2, '0')}:00Z`);
    const check = getBudapestHourMinute(candidate);
    if (check.hour === localHour && check.minute === localMinute) return candidate;
  }
  return new Date(`${dateISO}T${String(localHour - 1).padStart(2, '0')}:${String(localMinute).padStart(2, '0')}:00Z`);
}

/**
 * Run a query that may legitimately fail (probing for an optional table/column)
 * inside a SAVEPOINT. Without this, a failed statement inside our transaction would
 * poison the whole transaction ("current transaction is aborted") instead of being
 * locally tolerated — the behaviour the old autocommit pool.query() calls relied on.
 * Returns the fn result, or `fallback` if the statement errored.
 */
async function withSavepoint<T>(
  client: PoolClient,
  name: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  await client.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    return fallback;
  }
}

export interface ProjectionResult {
  projected: number;
  pathwayHash?: string;
  reason?: string;
}

export async function projectRemainingSteps(episodeId: string): Promise<ProjectionResult> {
  const pool = getDbPool();
  // Dedicated client: BEGIN/COMMIT and pg_advisory_xact_lock are connection-scoped,
  // so every statement of this transaction must run on the SAME connection. Issuing
  // them via pool.query() would scatter them across arbitrary pooled connections,
  // turning the "transaction" into a series of autocommits and making the advisory
  // lock a no-op (it would release the instant its throwaway connection returned).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [episodeId]);

    // Sequential (not Promise.all): a single connection runs one statement at a time,
    // and both reads must share this transaction's lock and snapshot.
    const episodeRow =
      (await withSavepoint(
        client,
        'sp_episode_cols',
        () =>
          client.query(
            `SELECT opened_at, plan_start_date FROM patient_episodes WHERE id = $1 FOR SHARE`,
            [episodeId]
          ),
        null,
      )) ??
      // plan_start_date column may predate migration 039 — fall back without it.
      (await client.query(`SELECT opened_at FROM patient_episodes WHERE id = $1 FOR SHARE`, [episodeId]));
    const apptsRow = await client.query(
      `SELECT a.step_code, a.step_seq, a.work_phase_id,
              COALESCE(a.start_time, ats.start_time) AS start_time,
              a.appointment_status
       FROM appointments a
       LEFT JOIN available_time_slots ats ON a.time_slot_id = ats.id
       WHERE a.episode_id = $1 AND a.step_code IS NOT NULL
         AND (a.appointment_status IS NULL OR a.appointment_status = 'completed')
       ORDER BY a.step_seq ASC`,
      [episodeId]
    );

    if (!episodeRow.rows[0]) {
      await client.query('COMMIT');
      return { projected: 0, reason: 'NO_EPISODE' };
    }

    // Multi-pathway: merge steps from all episode_pathways, fall back to legacy care_pathway_id
    let steps: PathwayWorkPhaseTemplate[] = [];
    let pathwayHash = '';
    await client.query('SAVEPOINT sp_multipw');
    try {
      const multiPwRow = await client.query(
        `SELECT cp.work_phases_json, cp.steps_json
         FROM episode_pathways ep
         JOIN care_pathways cp ON ep.care_pathway_id = cp.id
         WHERE ep.episode_id = $1 ORDER BY ep.ordinal`,
        [episodeId]
      );
      if (multiPwRow.rows.length > 0) {
        const allJson: unknown[] = [];
        for (const row of multiPwRow.rows) {
          const chunk =
            normalizePathwayWorkPhaseArray(row.work_phases_json) ??
            normalizePathwayWorkPhaseArray(row.steps_json);
          if (chunk) {
            steps.push(...chunk);
            allJson.push(chunk);
          }
        }
        const hashRow = await client.query(
          `SELECT encode(digest($1::text, 'sha256'), 'hex') as h`,
          [JSON.stringify(allJson)]
        );
        pathwayHash = hashRow.rows[0]?.h ?? '';
      }
      await client.query('RELEASE SAVEPOINT sp_multipw');
    } catch {
      // episode_pathways table might not exist
      await client.query('ROLLBACK TO SAVEPOINT sp_multipw');
    }
    if (steps.length === 0) {
      const pathwayRow = await client.query(
        `SELECT cp.work_phases_json, cp.steps_json,
                encode(digest(COALESCE(cp.work_phases_json::text, cp.steps_json::text, '[]'), 'sha256'), 'hex') as pathway_hash
         FROM patient_episodes pe
         JOIN care_pathways cp ON pe.care_pathway_id = cp.id
         WHERE pe.id = $1`,
        [episodeId]
      );
      if (!pathwayRow.rows[0]) {
        await client.query('COMMIT');
        return { projected: 0, reason: 'NO_PATHWAY' };
      }
      const row = pathwayRow.rows[0];
      steps =
        normalizePathwayWorkPhaseArray(row.work_phases_json) ??
        normalizePathwayWorkPhaseArray(row.steps_json) ??
        [];
      pathwayHash = pathwayRow.rows[0].pathway_hash;
    }

    if (!steps || steps.length === 0) {
      await client.query('COMMIT');
      return { projected: 0, reason: 'NO_PATHWAY' };
    }
    const epRow = episodeRow.rows[0];
    const openedAt = new Date(epRow.opened_at);
    const planStartDate = epRow.plan_start_date ? new Date(epRow.plan_start_date) : null;

    const pathwayByCode = new Map<string, PathwayWorkPhaseTemplate>();
    for (const s of steps) pathwayByCode.set(s.work_phase_code, s);

    // WP-4.2: a lefedettség work_phase_id-elsődleges. A step_code halmazokba
    // CSAK a work_phase_id NÉLKÜLI (legacy) foglalás-sorok kerülnek —
    // duplikált work_phase_code-nál (két állcsont / több fog) a csupasz
    // kód-kulcs a TESTVÉR fázist is lefedettnek mutatná / járatná le.
    const completedStepCodes = new Set<string>();
    const bookedStepCodes = new Set<string>();
    const completedWpIds = new Set<string>();
    const bookedWpIds = new Set<string>();
    let lastHardAnchor = planStartDate ?? openedAt;
    for (const a of apptsRow.rows) {
      const startTime = a.start_time ? new Date(a.start_time) : null;
      if (a.appointment_status === 'completed') {
        if (a.work_phase_id) completedWpIds.add(a.work_phase_id);
        else completedStepCodes.add(a.step_code);
        if (startTime && startTime > lastHardAnchor) lastHardAnchor = startTime;
      } else {
        if (a.work_phase_id) bookedWpIds.add(a.work_phase_id);
        else bookedStepCodes.add(a.step_code);
        if (startTime && startTime > lastHardAnchor) lastHardAnchor = startTime;
      }
    }

    // Episode steps: authoritative source for which steps exist, their order, and completion status
    interface EwpRow {
      id: string;
      work_phase_code: string;
      step_seq: number;
      status: string;
      completed_at: Date | null;
      default_days_offset?: number | null;
      duration_minutes?: number | null;
      /** Puzzle v2: a sor vizitje — a vetítés egysége. */
      visit_id?: string | null;
      /** Puzzle v2: a vizit days_offset-je; NULL → a fázis offsetje a fallback. */
      visit_days_offset?: number | null;
    }
    let episodeWorkPhaseRows: EwpRow[] | null = null;
    await client.query('SAVEPOINT sp_ewp');
    try {
      // Összevont (child) sorok kihagyása — ugyanarra az időpontra tartoznak a primary-hoz; különben az anchor-lánc
      // minden gyerekre külön lépdel, és az offsetek összeadódnának (next-step-engine / worklist már így szűr).
      let mergedIntoFilter = '';
      const col = await withSavepoint(
        client,
        'sp_ewp_col',
        () =>
          client.query(
            `SELECT 1 FROM information_schema.columns
             WHERE table_name = 'episode_work_phases' AND column_name = 'merged_into_episode_work_phase_id' LIMIT 1`
          ),
        null,
      );
      if (col && col.rows.length > 0) mergedIntoFilter = ' AND e.merged_into_episode_work_phase_id IS NULL';
      // Puzzle v2: vizit-tagság + vizit-szintű days_offset — egy alkalom
      // fázisai egy vetítési egység (közös ablak, a horgony egyszer lép).
      // A 089 előtti sémán elmarad; a sorok egyfős egységek maradnak.
      let visitCols = '';
      let visitJoin = '';
      const visitCol = await withSavepoint(
        client,
        'sp_ewp_visit_col',
        () =>
          client.query(
            `SELECT 1 FROM information_schema.columns
             WHERE table_name = 'episode_work_phases' AND column_name = 'visit_id' LIMIT 1`
          ),
        null,
      );
      if (visitCol && visitCol.rows.length > 0) {
        visitCols = ', e.visit_id, v.days_offset AS visit_days_offset';
        visitJoin = ' LEFT JOIN episode_visits v ON e.visit_id = v.id';
      }
      const esResult = await client.query(
        `SELECT e.id, e.work_phase_code, COALESCE(e.seq, e.pathway_order_index) as step_seq, e.status, e.completed_at,
                e.default_days_offset, e.duration_minutes${visitCols}
         FROM episode_work_phases e${visitJoin}
         WHERE e.episode_id = $1${mergedIntoFilter}
         ORDER BY COALESCE(e.seq, e.pathway_order_index)`,
        [episodeId]
      );
      if (esResult.rows.length > 0) episodeWorkPhaseRows = esResult.rows as EwpRow[];
      await client.query('RELEASE SAVEPOINT sp_ewp');
    } catch {
      /* table may not exist */
      await client.query('ROLLBACK TO SAVEPOINT sp_ewp');
    }

    if (episodeWorkPhaseRows) {
      for (const es of episodeWorkPhaseRows) {
        if (es.status === 'completed' || es.status === 'skipped') {
          // WP-4.2: a teljesült/kihagyott sor a SAJÁT id-jával fed le — a
          // csupasz kód a duplikált testvért is elnyomná.
          completedWpIds.add(es.id);
          if (es.completed_at) {
            const t = new Date(es.completed_at);
            if (t > lastHardAnchor) lastHardAnchor = t;
          }
        }
      }
    }

    // Stale intent lejáratás — work_phase_id-elsődlegesen (WP-4.2): a
    // wp-linkelt nyitott intent akkor jár le, ha a SAJÁT fázisa lefedett;
    // a legacy (work_phase_id NULL) intentre a régi, kód-alapú (konzervatív)
    // szabály marad. Hash-eltérés mindkettőt lejáratja.
    const coveredWpIds = [...Array.from(completedWpIds), ...Array.from(bookedWpIds)];
    const legacyCoveredCodes = [...Array.from(completedStepCodes), ...Array.from(bookedStepCodes)];
    if (coveredWpIds.length > 0 || legacyCoveredCodes.length > 0 || pathwayHash) {
      await client.query(
        `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP
         WHERE episode_id = $1
           AND state = 'open'
           AND (
             (work_phase_id IS NOT NULL AND work_phase_id = ANY($2::uuid[]))
             OR (work_phase_id IS NULL AND step_code = ANY($3::text[]))
             OR (source_pathway_hash IS NOT NULL AND source_pathway_hash IS DISTINCT FROM $4)
           )`,
        [episodeId, coveredWpIds, legacyCoveredCodes, pathwayHash]
      );
    }

    interface Projection {
      stepCode: string; stepSeq: number; pool: string;
      workPhaseId: string | null;
      durationMinutes: number; windowStart: Date; windowEnd: Date; expiresAt: Date;
      suggestedStart: Date | null; suggestedEnd: Date | null;
    }
    const projections: Projection[] = [];

    // Use episode_work_phases when available (authoritative list); fall back to pathway indices
    const stepsToProject: Array<{
      stepCode: string; stepSeq: number; workPhaseId: string | null; offset: number;
      durationMinutes: number; pool: string;
      visitId: string | null; visitDaysOffset: number | null;
    }> = [];

    if (episodeWorkPhaseRows) {
      for (const es of episodeWorkPhaseRows) {
        if (es.status !== 'pending' && es.status !== 'scheduled') continue;
        // WP-4.2: a lefedettség sor-szintű — a SAJÁT fázis foglalása/teljesítése
        // nyom el; a legacy (wp-link nélküli) appointment kód szerint fed
        // (nem tudjuk, melyik testvérhez tartozik — konzervatív).
        if (completedWpIds.has(es.id) || bookedWpIds.has(es.id)) continue;
        if (completedStepCodes.has(es.work_phase_code)) continue;
        if (bookedStepCodes.has(es.work_phase_code)) continue;
        const pw = pathwayByCode.get(es.work_phase_code);
        const ewpDur = es.duration_minutes != null ? Number(es.duration_minutes) : null;
        stepsToProject.push({
          stepCode: es.work_phase_code,
          stepSeq: es.step_seq,
          workPhaseId: es.id,
          offset: (es.default_days_offset ?? pw?.default_days_offset) ?? 14,
          durationMinutes:
            ewpDur != null && ewpDur > 0 ? ewpDur : (pw?.duration_minutes ?? 30),
          pool: pw ? slotPoolForStep(pw) : 'work',
          visitId: es.visit_id ?? null,
          visitDaysOffset: es.visit_days_offset ?? null,
        });
      }
    } else {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (completedStepCodes.has(step.work_phase_code)) continue;
        if (bookedStepCodes.has(step.work_phase_code)) continue;
        stepsToProject.push({
          stepCode: step.work_phase_code,
          stepSeq: i,
          workPhaseId: null,
          offset: step.default_days_offset ?? 14,
          durationMinutes: step.duration_minutes ?? 30,
          pool: slotPoolForStep(step),
          visitId: null,
          visitDaysOffset: null,
        });
      }
    }

    // Determine the Budapest local time-of-day from the anchor (e.g. 12:30 Budapest)
    const anchorLocal = getBudapestHourMinute(lastHardAnchor);

    // Puzzle v2: vizit-tudatos lánc — egy alkalom fázisai EGY egység: közös
    // ablak és javasolt kezdés, a horgony csak az egység után lép; a vizitek
    // között a vizit days_offset-je a lépésköz (fallback: az első tag fázis-
    // offsetje). Vizit nélküli sor egyfős egység — a korábbi működés.
    let anchor = lastHardAnchor;
    for (const unit of groupProjectionUnits(stepsToProject)) {
      const { windowStart, windowEnd } = computeStepWindow(anchor, unit.offset);
      const expiresAt = new Date(windowEnd);
      expiresAt.setDate(expiresAt.getDate() + 30);

      // Compute target date (anchor + offset days), then place at the same Budapest local time
      const rawDate = new Date(anchor);
      rawDate.setDate(rawDate.getDate() + unit.offset);
      const dateISO = rawDate.toISOString().slice(0, 10);
      const suggestedStart = budapestLocalToUTC(dateISO, anchorLocal.hour, anchorLocal.minute);

      for (const sp of unit.members) {
        const suggestedEnd = new Date(suggestedStart.getTime() + sp.durationMinutes * 60 * 1000);
        projections.push({
          stepCode: sp.stepCode, stepSeq: sp.stepSeq, pool: sp.pool,
          workPhaseId: sp.workPhaseId,
          durationMinutes: sp.durationMinutes,
          windowStart, windowEnd, expiresAt,
          suggestedStart, suggestedEnd,
        });
      }

      // Chain anchor: the next unit anchors from this unit's expected date
      anchor = suggestedStart;
    }

    // Árva nyitott intentek lejáratása — az UPSERT ELŐTT (WP-4.2): olyan
    // nyitott sor, aminek (step_code, step_seq) kulcsa nincs a projekcióban,
    // vagy work_phase_id-je más kulcs alá tartozik (pl. reorder után elmozdult
    // seq). Az előre-lejáratás nélkül az idx_slot_intents_unique_open_work_phase
    // partiális unique (work_phase_id, state='open') 23505-tel buktatná az
    // INSERT-et, mielőtt a régi utó-takarítás sorra kerülne.
    const projByKey = new Map(projections.map((p) => [`${p.stepCode}:${p.stepSeq}`, p]));
    const keyByWpId = new Map(
      projections.filter((p) => p.workPhaseId).map((p) => [p.workPhaseId as string, `${p.stepCode}:${p.stepSeq}`])
    );
    const openRows = await client.query(
      `SELECT id, step_code, step_seq, work_phase_id FROM slot_intents
       WHERE episode_id = $1 AND state = 'open'`,
      [episodeId]
    );
    const orphanIds = openRows.rows
      .filter((r: { step_code: string; step_seq: number; work_phase_id: string | null }) => {
        const key = `${r.step_code}:${r.step_seq}`;
        const proj = projByKey.get(key);
        if (!proj) return true;
        // Kulcs-egyezés, de a wp-hozzárendelés máshova mutat → árva.
        if (r.work_phase_id && proj.workPhaseId && r.work_phase_id !== proj.workPhaseId) return true;
        // A projekció wp-je egy MÁSIK nyitott sor kulcsán ül → azt az orphan
        // ág (proj hiánya) fogja meg; itt nincs teendő.
        if (r.work_phase_id && keyByWpId.get(r.work_phase_id) !== key) return true;
        return false;
      })
      .map((r: { id: string }) => r.id);
    if (orphanIds.length > 0) {
      await client.query(
        `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1::uuid[])`,
        [orphanIds]
      );
    }

    // Batch UPSERT: reopens expired intents, does NOT touch converted or cancelled.
    // WP-4.2: a work_phase_id-t is írjuk (a 025-ös migráció eredeti szándéka) —
    // az újranyitás is kitölti, így a konverzió wp-elsődleges guardjai élnek.
    if (projections.length > 0) {
      const values: string[] = [];
      const params: unknown[] = [episodeId, pathwayHash];
      let paramIdx = 3;

      for (const p of projections) {
        values.push(
          `($1, $${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, 'open', $2, $${paramIdx+6}, $${paramIdx+7}, $${paramIdx+8}, $${paramIdx+9})`
        );
        params.push(p.stepCode, p.stepSeq, p.pool, p.durationMinutes,
                     p.windowStart, p.windowEnd, p.expiresAt, p.suggestedStart, p.suggestedEnd,
                     p.workPhaseId);
        paramIdx += 10;
      }

      await client.query(
        `INSERT INTO slot_intents
           (episode_id, step_code, step_seq, pool, duration_minutes,
            window_start, window_end, state, source_pathway_hash, expires_at, suggested_start, suggested_end,
            work_phase_id)
         VALUES ${values.join(', ')}
         ON CONFLICT (episode_id, step_code, step_seq) DO UPDATE SET
           window_start = EXCLUDED.window_start,
           window_end = EXCLUDED.window_end,
           source_pathway_hash = EXCLUDED.source_pathway_hash,
           expires_at = EXCLUDED.expires_at,
           suggested_start = EXCLUDED.suggested_start,
           suggested_end = EXCLUDED.suggested_end,
           work_phase_id = EXCLUDED.work_phase_id,
           state = 'open',
           updated_at = CURRENT_TIMESTAMP
         WHERE slot_intents.state IN ('open', 'expired')`,
        params
      );
    }

    await client.query('COMMIT');
    return { projected: projections.length, pathwayHash };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

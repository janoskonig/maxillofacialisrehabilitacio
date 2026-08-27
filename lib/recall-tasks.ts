/**
 * Kezelési tervtől független gondozási (recall) feladatok.
 *
 * Auto-generálás: az epizód első STAGE_6 (átadás) eseménye után indul, a
 * rizikószint (patient_episodes.recall_risk_level, NULL → 'low') szerinti
 * kadenciával. A HORGONY nem (csak) a STAGE_6 esemény: a recall az epizód
 * utolsó teljesült kezeléséhez/kontrolljához (legutóbbi completed
 * appointment / munkafázis) képest indul, így a rövid távú (1-3 hetes)
 * visszarendelés is fogalmilag belefér; ha ilyen nincs, az első STAGE_6
 * esemény időpontja a horgony. A tényleges időpont a control poolba foglalható.
 *
 * A kézi (source='manual') sorokhoz az auto-generálás SOHA nem nyúl: nem
 * írja felül és nem duplikálja őket (az ON CONFLICT csak az auto sorok
 * partiális unique indexét célozza, és azonos intervallumú kézi sor mellé
 * ÚJ auto sor nem is szúródik be). A már létező auto sor horgony-frissítését
 * a kézi ikersor nem nyomja el.
 */

import type { Pool, PoolClient } from 'pg';
import { getDbPool } from './db';
import { RECALL_CADENCE_DAYS, recallCadenceForRisk, recallLabelForInterval } from './recall-cadence';

/**
 * @deprecated A rizikó-alapú kadencia váltotta ki (lib/recall-cadence.ts);
 * a 'low' szint felel meg a korábbi fix 6/12 hónapos viselkedésnek.
 */
export const RECALL_SCHEDULE_DAYS = RECALL_CADENCE_DAYS.low;

type Queryable = Pick<Pool | PoolClient, 'query'>;

/** DST-től független, naptári nap alapú recall-határidő. */
export function recallDueAt(anchorAt: Date, intervalDays: number): Date {
  const dueAt = new Date(anchorAt);
  dueAt.setUTCDate(dueAt.getUTCDate() + intervalDays);
  return dueAt;
}

/**
 * Idempotensen létrehozza/javítja az epizód auto-generált recall-sorait a
 * rizikószint szerinti kadenciával. A határidő horgonya az utolsó teljesült
 * kezelés/kontroll (fallback: az első STAGE_6 esemény), nem az ensure futási
 * időpontja. Már foglalt vagy teljesített sorhoz nem nyúl; kézi sort nem ír
 * felül és nem duplikál.
 */
export async function ensureRecallTasksForEpisode(
  episodeId: string,
  db: Queryable = getDbPool(),
): Promise<number> {
  const episodeResult = await db.query(
    `SELECT pe.id,
            pe.recall_risk_level,
            (SELECT MIN(se.at)
               FROM stage_events se
              WHERE se.episode_id = pe.id AND se.stage_code = 'STAGE_6') AS stage6_at,
            GREATEST(
              (SELECT MAX(a.start_time)
                 FROM appointments a
                WHERE a.episode_id = pe.id
                  AND a.appointment_status = 'completed'),
              (SELECT MAX(COALESCE(pa.start_time, ewp.completed_at))
                 FROM episode_work_phases ewp
                 LEFT JOIN appointments pa ON pa.id = ewp.appointment_id
                WHERE ewp.episode_id = pe.id
                  AND ewp.status = 'completed')
            ) AS last_completed_at
       FROM patient_episodes pe
       JOIN patients p ON p.id = pe.patient_id
      WHERE pe.id = $1
        AND pe.status = 'open'
        AND p.halal_datum IS NULL`,
    [episodeId],
  );
  if (episodeResult.rows.length === 0 || !episodeResult.rows[0].stage6_at) return 0;

  const row = episodeResult.rows[0];
  // Horgony: az utolsó teljesült kezelés/kontroll; ha (még) nincs, a STAGE_6.
  const anchorAt = new Date(row.last_completed_at ?? row.stage6_at);
  const intervals = [...recallCadenceForRisk(row.recall_risk_level)];
  const dueDates = intervals.map((days) => recallDueAt(anchorAt, days));
  const labels = intervals.map((days) => recallLabelForInterval(days));

  // Egyetlen UPSERT: párhuzamos hívásnál sincs duplikáció, félbemaradt régi
  // létrehozásnál a hiányzó sor önjavítóan létrejön, horgony-eltolódásnál
  // (pl. újabb teljesült kontroll) csak a még nem foglalt/teljesített sor
  // határideje korrigálódik. A kézi-őr csak az ÚJ auto sor beszúrását fogja
  // meg (azonos intervallumú KÉZI sor mellé nem születik auto ikersor); ha az
  // auto sor MÁR LÉTEZIK, az EXISTS-ág átengedi, így a horgony-frissítése
  // (ON CONFLICT DO UPDATE) kézi ikersor mellett is lefut.
  const result = await db.query(
    `INSERT INTO episode_tasks (episode_id, task_type, due_at, recall_interval_days, source, label)
     SELECT $1, 'recall_due', s.due_at, s.interval_days, 'auto', s.label
       FROM UNNEST($2::int[], $3::timestamptz[], $4::text[]) AS s(interval_days, due_at, label)
      WHERE NOT EXISTS (
        SELECT 1
          FROM episode_tasks m
         WHERE m.episode_id = $1
           AND m.task_type = 'recall_due'
           AND m.source = 'manual'
           AND m.recall_interval_days = s.interval_days
      )
      OR EXISTS (
        SELECT 1
          FROM episode_tasks e
         WHERE e.episode_id = $1
           AND e.task_type = 'recall_due'
           AND e.source = 'auto'
           AND e.recall_interval_days = s.interval_days
      )
     ON CONFLICT (episode_id, recall_interval_days)
       WHERE task_type = 'recall_due' AND recall_interval_days IS NOT NULL AND source = 'auto'
     DO UPDATE SET due_at = EXCLUDED.due_at,
                   label = COALESCE(episode_tasks.label, EXCLUDED.label)
       WHERE episode_tasks.completed_at IS NULL
         AND episode_tasks.appointment_id IS NULL
     RETURNING id`,
    [episodeId, intervals, dueDates, labels],
  );

  return result.rowCount ?? result.rows.length;
}

export interface ObsoleteAutoRecallTask {
  id: string;
  intervalDays: number;
  label: string | null;
  dueAt: Date | string;
}

export interface RecallRiskSyncResult {
  /** Az ensure által létrehozott/frissített auto sorok száma. */
  ensuredCount: number;
  /**
   * A kadenciából kikerült, még nem foglalt és nem teljesített auto sorok —
   * törlésre FELAJÁNLVA a hívónak/UI-nak, de NEM törölve.
   */
  obsoleteAutoTasks: ObsoleteAutoRecallTask[];
}

/**
 * Rizikószint-váltás utáni szinkron: az új kadencia hiányzó auto sorait
 * létrehozza (ensure), a kadenciából kikerült auto sorokat pedig csak
 * MEGJELÖLI a válaszban. Nem töröl semmit, kézi sort nem érint, foglalást
 * nem mond le — a tényleges törlés a felhasználó külön döntése.
 */
export async function syncRecallTasksForRiskChange(
  episodeId: string,
  db: Queryable = getDbPool(),
): Promise<RecallRiskSyncResult> {
  const ensuredCount = await ensureRecallTasksForEpisode(episodeId, db);

  const riskResult = await db.query(
    `SELECT recall_risk_level FROM patient_episodes WHERE id = $1`,
    [episodeId],
  );
  const cadence = [...recallCadenceForRisk(riskResult.rows[0]?.recall_risk_level)];

  const obsoleteResult = await db.query(
    `SELECT id,
            recall_interval_days AS "intervalDays",
            label,
            due_at AS "dueAt"
       FROM episode_tasks
      WHERE episode_id = $1
        AND task_type = 'recall_due'
        AND source = 'auto'
        AND recall_interval_days IS NOT NULL
        AND NOT (recall_interval_days = ANY($2::int[]))
        AND completed_at IS NULL
        AND appointment_id IS NULL
      ORDER BY due_at`,
    [episodeId, cadence],
  );

  return { ensuredCount, obsoleteAutoTasks: obsoleteResult.rows };
}

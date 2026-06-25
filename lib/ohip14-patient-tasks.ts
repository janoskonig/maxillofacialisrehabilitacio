import { getDbPool } from '@/lib/db';
import { insertUserTask } from '@/lib/user-tasks';
import { sendPushNotification } from '@/lib/push-notifications';
import { logger } from '@/lib/logger';
import type { OHIP14Timepoint } from '@/lib/types';

/**
 * OHIP-14 beteg-oldali, többcsatornás nudge segédfüggvényei.
 *
 * Az e-mailes emlékeztetők mellé:
 *  - in-app feladat a betegnek (a `/patient-portal/tasks` listában látszik),
 *  - Web Push, ha a betegnek van portál-fiókja + feliratkozása,
 *  - eszkaláció a kezelőorvoshoz, ha a beteg több emlékeztető után sem tölt ki.
 *
 * A feladat kitöltéskor automatikusan lezárul (`closeOpenOhipPatientTasks`).
 */

type Pool = ReturnType<typeof getDbPool>;

const OHIP_TASK_SOURCE = 'ohip14_reminder';
/** Ennyi (heti) emlékeztető után a kezelőorvost is bevonjuk a beteg ösztönzésébe. */
export const OHIP_ESCALATION_AFTER = 3;

/** Nyitott OHIP beteg-feladat(ok) lezárása — kitöltéskor / pótláskor hívandó. */
export async function closeOpenOhipPatientTasks(patientId: string): Promise<number> {
  const pool = getDbPool();
  const res = await pool.query(
    `UPDATE user_tasks
        SET status = 'done', completed_at = NOW()
      WHERE task_type = 'ohip14'
        AND assignee_kind = 'patient'
        AND assignee_patient_id = $1
        AND status = 'open'`,
    [patientId],
  );
  return res.rowCount ?? 0;
}

/** Fire-and-forget burkoló a beküldő route-hoz — sosem dob, csak logol. */
export function closeOpenOhipPatientTasksSilent(patientId: string): void {
  closeOpenOhipPatientTasks(patientId).catch((err) =>
    logger.error(`[ohip-tasks] feladat-zárás hiba (${patientId}):`, err),
  );
}

/** A beteg portál-fiókjának user-id-ja (e-mail egyezés alapján), ha van. */
async function resolvePatientPortalUserId(pool: Pool, patientId: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT u.id
       FROM patients p
       JOIN users u
         ON lower(btrim(u.email)) = lower(btrim(p.email))
        AND u.active IS NOT FALSE
      WHERE p.id = $1 AND p.email IS NOT NULL AND btrim(p.email) <> ''
      LIMIT 1`,
    [patientId],
  );
  return r.rows[0]?.id ?? null;
}

/**
 * Egy érvényes `created_by_user_id` a beteg-feladathoz (a kapcsolat NOT NULL):
 * a felelős kezelőorvos, vagy ha nincs, az első admin.
 */
async function resolveTaskCreator(pool: Pool, patientId: string): Promise<string | null> {
  const k = await pool.query(`SELECT kezeleoorvos_user_id FROM patients WHERE id = $1`, [patientId]);
  const kid = k.rows[0]?.kezeleoorvos_user_id as string | null | undefined;
  if (kid) return kid;
  const a = await pool.query(
    `SELECT id FROM users WHERE role = 'admin' AND active IS NOT FALSE ORDER BY created_at ASC LIMIT 1`,
  );
  return a.rows[0]?.id ?? null;
}

/**
 * Nyitott OHIP beteg-feladat biztosítása (idempotens: betegenként egy nyitott).
 * Visszatérés: true, ha most jött létre.
 */
export async function ensurePatientOhipTask(
  pool: Pool,
  patientId: string,
  timepoint: OHIP14Timepoint,
): Promise<boolean> {
  const existing = await pool.query(
    `SELECT 1 FROM user_tasks
      WHERE task_type = 'ohip14'
        AND assignee_kind = 'patient'
        AND assignee_patient_id = $1
        AND status = 'open'
      LIMIT 1`,
    [patientId],
  );
  if (existing.rows.length > 0) return false;

  const creator = await resolveTaskCreator(pool, patientId);
  if (!creator) return false; // nincs kihez kötni a created_by-t — kihagyjuk

  await insertUserTask({
    assigneeKind: 'patient',
    assigneeUserId: null,
    assigneePatientId: patientId,
    patientId,
    taskType: 'ohip14',
    title: `OHIP-14 kérdőív kitöltése (${timepoint})`,
    description: 'Kérjük, töltse ki az életminőség-kérdőívet a betegportálon.',
    metadata: { source: OHIP_TASK_SOURCE, timepoint },
    createdByUserId: creator,
  });
  return true;
}

/** Web Push a betegnek (best-effort; portál-fiók + feliratkozás esetén). */
export async function pushPatientOhipReminder(
  pool: Pool,
  patientId: string,
  timepoint: OHIP14Timepoint,
): Promise<void> {
  try {
    const uid = await resolvePatientPortalUserId(pool, patientId);
    if (!uid) return;
    await sendPushNotification(uid, {
      title: 'OHIP-14 kérdőív',
      body: `Kérjük, töltse ki a(z) ${timepoint} életminőség-kérdőívet.`,
      icon: '/icon-192x192.png',
      tag: `ohip14-${timepoint}`,
      data: { url: '/patient-portal/ohip14', type: 'reminder' },
    });
  } catch (err) {
    logger.error(`[ohip-tasks] push hiba (${patientId}):`, err);
  }
}

/**
 * Eszkaláció a kezelőorvoshoz, ha a beteg `OHIP_ESCALATION_AFTER`+ emlékeztető
 * után sem töltött ki. A felelős kezelőorvos kap egy `missing_data` feladatot,
 * hogy személyesen ösztönözze a beteget. Idempotens (egy nyitott eszkalációs
 * feladat per beteg+orvos). Visszatérés: true, ha most jött létre.
 */
export async function escalateOhipToKezeloorvos(
  pool: Pool,
  patientId: string,
  patientName: string | null,
  timepoint: OHIP14Timepoint,
  priorReminderCount: number,
): Promise<boolean> {
  if (priorReminderCount < OHIP_ESCALATION_AFTER) return false;

  const k = await pool.query(
    `SELECT u.id, COALESCE(u.doktor_neve, u.email) AS name
       FROM patients p
       JOIN users u ON u.id = p.kezeleoorvos_user_id AND u.active IS NOT FALSE
      WHERE p.id = $1
      LIMIT 1`,
    [patientId],
  );
  const doc = k.rows[0];
  if (!doc) return false;

  const existing = await pool.query(
    `SELECT 1 FROM user_tasks
      WHERE task_type = 'missing_data'
        AND status = 'open'
        AND patient_id = $1
        AND assignee_user_id = $2
        AND metadata->>'source' = 'ohip_escalation'
      LIMIT 1`,
    [patientId, doc.id],
  );
  if (existing.rows.length > 0) return false;

  const label = patientName?.trim() || 'beteg';
  await insertUserTask({
    assigneeKind: 'staff',
    assigneeUserId: doc.id,
    assigneePatientId: null,
    patientId,
    taskType: 'missing_data',
    title: `Beteg személyes megkérése – OHIP-14 (${timepoint}) – ${label}`,
    description: `A beteg ${priorReminderCount} emlékeztető után sem töltötte ki a(z) ${timepoint} OHIP-14 kérdőívet. Kérjük, személyesen ösztönözze a kitöltésre.`,
    metadata: { source: 'ohip_escalation', timepoint },
    createdByUserId: doc.id,
  });
  return true;
}

/**
 * Consent request + weekly reminder delivery ("önjáró" nyilatkoztatás).
 *
 * - triggerConsentRequest(): best-effort single-patient send at registration.
 * - sendConsentReminders(): heti nudge minden NYITOTT EPIZÓDÚ betegnek, aki
 *   még tartozik nyilatkozattal (adatkezelési tudomásulvétel és/vagy kutatási
 *   döntés): e-mail + portál-feladat + Web Push. Határidő nincs — a nudge
 *   addig ismétlődik hetente, amíg a beteg nem nyilatkozik. Az admin csak a
 *   konfliktussal találkozik (lib/consent-conflict).
 *
 * Idempotency mirrors lib/ohip14-reminders.ts: every send writes a
 * consent_reminder_log row, and the cooldown is checked against that table.
 */

import type { Pool, PoolClient } from 'pg';
import { getDbPool } from '@/lib/db';
import { sendConsentRequestEmail } from '@/lib/email';
import { noticeAcknowledgedSql } from '@/lib/consent-obligations';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@/lib/legal/policy-version';
import { insertUserTask } from '@/lib/user-tasks';
import {
  resolvePatientPortalUserId,
  resolveTaskCreator,
} from '@/lib/ohip14-patient-tasks';
import { sendPushNotification } from '@/lib/push-notifications';
import { logger } from '@/lib/logger';

type Db = Pool | PoolClient;

/** Heti ütem: egy betegnek 7 naponta legfeljebb egy consent-nudge. */
const REMINDER_COOLDOWN_DAYS = 7;
const CONSENT_TASK_SOURCE = 'consent_nudge';

interface ReminderResult {
  sent: number;
  skipped: number;
  errors: number;
}

async function logConsentReminder(
  db: Db,
  patientId: string,
  email: string,
  needsNoticeAck: boolean,
  needsResearch: boolean
): Promise<void> {
  await db.query(
    `INSERT INTO consent_reminder_log (patient_id, email_to, needs_gdpr, needs_research)
     VALUES ($1, $2, $3, $4)`,
    [patientId, email, needsNoticeAck, needsResearch]
  );
}

/**
 * Send the initial declaration request to a single patient right after registration.
 * Best-effort: never throws (caller should not let this break registration).
 */
export async function triggerConsentRequest(
  patient: { id: string; email: string | null; nev: string | null; nem: string | null },
  needs: { needsNoticeAck: boolean; needsResearch: boolean },
  pool?: Db
): Promise<void> {
  if (!patient.email) return;
  if (!needs.needsNoticeAck && !needs.needsResearch) return;
  const db = pool ?? getDbPool();
  try {
    await sendConsentRequestEmail(patient.email, patient.nev, patient.nem, needs, {
      patientId: patient.id,
      sentBy: 'system',
      isReminder: false,
    });
    await logConsentReminder(db, patient.id, patient.email, needs.needsNoticeAck, needs.needsResearch);
  } catch (err) {
    console.error(`[consent-reminders] Failed initial request for patient ${patient.id}:`, err);
  }
}

/**
 * Heti cron: minden nyitott epizódú, nyilatkozattal tartozó beteg nudge-olása
 * (e-mail + portál-feladat + push). Idempotent via consent_reminder_log
 * (7 napos cooldown → hetente legfeljebb egy e-mail betegenként; a cron
 * továbbra is naponta hívható, a cooldown véd).
 */
export async function sendConsentReminders(): Promise<ReminderResult> {
  const pool = getDbPool();
  const result: ReminderResult = { sent: 0, skipped: 0, errors: 0 };

  const ack = noticeAcknowledgedSql('p', '$1');
  const res = await pool.query(
    `
    SELECT p.id AS patient_id,
           p.nev,
           p.nem,
           p.email,
           COALESCE(p.consent_status, 'unknown') AS research_status,
           ${ack} AS notice_acknowledged
    FROM patients p
    WHERE p.email IS NOT NULL AND p.email <> ''
      AND p.halal_datum IS NULL
      AND EXISTS (
        SELECT 1 FROM patient_episodes pe
        WHERE pe.patient_id = p.id AND pe.status = 'open'
      )
      AND (
        NOT (${ack})
        OR COALESCE(p.consent_status, 'unknown') IN ('unknown', 'pending')
      )
      AND NOT EXISTS (
        SELECT 1 FROM consent_reminder_log crl
        WHERE crl.patient_id = p.id
          AND crl.sent_at > NOW() - INTERVAL '${REMINDER_COOLDOWN_DAYS} days'
      )
    ORDER BY p.id
  `,
    [CURRENT_PRIVACY_POLICY_VERSION]
  );

  for (const row of res.rows) {
    try {
      const needsNoticeAck = row.notice_acknowledged !== true;
      const needsResearch = ['unknown', 'pending'].includes(row.research_status as string);
      if (!needsNoticeAck && !needsResearch) {
        result.skipped++;
        continue;
      }

      // Portál-feladat + push a heti e-mail mellé (a portálra belépő beteg
      // e-mail nélkül is látja a teendőt).
      const taskCreated = await ensureConsentNudgeTask(pool as Pool, row.patient_id as string);
      if (taskCreated) {
        await pushConsentReminder(pool as Pool, row.patient_id as string);
      }

      await sendConsentRequestEmail(
        row.email as string,
        row.nev as string | null,
        row.nem as string | null,
        { needsNoticeAck, needsResearch },
        { patientId: row.patient_id as string, sentBy: 'system', isReminder: true }
      );

      await logConsentReminder(pool, row.patient_id as string, row.email as string, needsNoticeAck, needsResearch);
      result.sent++;
    } catch (err) {
      console.error(`[consent-reminders] Error for patient ${row.patient_id}:`, err);
      result.errors++;
    }
  }

  // Rendezett betegek nyitott nudge-feladatainak lezárása (heti reconcile).
  try {
    const openTasks = await pool.query(
      `SELECT DISTINCT patient_id FROM user_tasks
        WHERE task_type = 'manual' AND status = 'open'
          AND metadata->>'source' = $1
          AND patient_id IS NOT NULL`,
      [CONSENT_TASK_SOURCE]
    );
    for (const t of openTasks.rows) {
      await closeConsentNudgeTasksIfSettled(t.patient_id as string, pool);
    }
  } catch (err) {
    logger.error('[consent-reminders] reconcile hiba:', err);
  }

  return result;
}

/** Nyitott consent-nudge feladat biztosítása (betegenként egy). */
async function ensureConsentNudgeTask(pool: Pool, patientId: string): Promise<boolean> {
  const existing = await pool.query(
    `SELECT 1 FROM user_tasks
      WHERE task_type = 'manual'
        AND assignee_kind = 'patient'
        AND assignee_patient_id = $1
        AND status = 'open'
        AND metadata->>'source' = $2
      LIMIT 1`,
    [patientId, CONSENT_TASK_SOURCE]
  );
  if (existing.rows.length > 0) return false;

  const creator = await resolveTaskCreator(pool, patientId);
  if (!creator) return false;

  await insertUserTask({
    assigneeKind: 'patient',
    assigneeUserId: null,
    assigneePatientId: patientId,
    patientId,
    taskType: 'manual',
    title: 'Nyilatkozat szükséges (adatkezelés / kutatás)',
    description:
      'Kérjük, tegye meg nyilatkozatait a betegportál Adataim oldalán — csak néhány kattintás.',
    metadata: { source: CONSENT_TASK_SOURCE },
    createdByUserId: creator,
  });
  return true;
}

/** Web Push a betegnek (best-effort). */
async function pushConsentReminder(pool: Pool, patientId: string): Promise<void> {
  try {
    const uid = await resolvePatientPortalUserId(pool, patientId);
    if (!uid) return;
    await sendPushNotification(uid, {
      title: 'Nyilatkozat szükséges',
      body: 'Kérjük, tegye meg adatkezelési / kutatási nyilatkozatát a betegportálon.',
      icon: '/icon-192x192.png',
      tag: 'consent-nudge',
      data: { url: '/patient-portal/profile', type: 'reminder' },
    }, { patientId });
  } catch (err) {
    logger.error(`[consent-reminders] push hiba (${patientId}):`, err);
  }
}

/**
 * A beteg consent-nudge feladatának lezárása, ha MINDKÉT nyilatkozat rendezett
 * (tudomásulvétel megvan ÉS a kutatási státusz nem unknown/pending). A consent-
 * mutációs útvonalak (grant/decline/withdraw) és a heti reconcile hívja.
 */
export async function closeConsentNudgeTasksIfSettled(
  patientId: string,
  pool?: Db
): Promise<number> {
  const db = pool ?? getDbPool();
  const ack = noticeAcknowledgedSql('p', '$2');
  const state = await db.query(
    `SELECT ${ack} AS notice_acknowledged,
            COALESCE(p.consent_status, 'unknown') AS research_status
       FROM patients p WHERE p.id = $1`,
    [patientId, CURRENT_PRIVACY_POLICY_VERSION]
  );
  const row = state.rows[0];
  if (!row) return 0;
  const settled =
    row.notice_acknowledged === true &&
    !['unknown', 'pending'].includes(row.research_status as string);
  if (!settled) return 0;

  const closed = await db.query(
    `UPDATE user_tasks
        SET status = 'done', completed_at = NOW()
      WHERE task_type = 'manual'
        AND assignee_kind = 'patient'
        AND assignee_patient_id = $1
        AND status = 'open'
        AND metadata->>'source' = $2`,
    [patientId, CONSENT_TASK_SOURCE]
  );
  return closed.rowCount ?? 0;
}

/** Fire-and-forget burkoló a consent-mutációs útvonalakhoz. */
export function closeConsentNudgeTasksIfSettledSilent(patientId: string): void {
  closeConsentNudgeTasksIfSettled(patientId).catch((err) => {
    logger.error(`[consent-reminders] feladat-lezárás hiba (${patientId}):`, err);
  });
}

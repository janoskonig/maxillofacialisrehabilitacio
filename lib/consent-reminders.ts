/**
 * Consent request + daily reminder delivery.
 *
 * - triggerConsentRequest(): best-effort single-patient send at registration.
 * - sendConsentReminders(): daily cron that re-notifies every patient who still
 *   owes a declaration (privacy-notice acknowledgement and/or research decision)
 *   and hasn't been reminded in the last ~20h.
 *
 * Idempotency mirrors lib/ohip14-reminders.ts: every send writes a
 * consent_reminder_log row, and the cooldown is checked against that table.
 */

import type { Pool, PoolClient } from 'pg';
import { getDbPool } from '@/lib/db';
import { sendConsentRequestEmail } from '@/lib/email';
import { noticeAcknowledgedSql } from '@/lib/consent-obligations';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@/lib/legal/policy-version';

type Db = Pool | PoolClient;

const REMINDER_COOLDOWN_HOURS = 20;

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
 * Daily cron: re-notify every patient with an outstanding declaration.
 * Idempotent via consent_reminder_log (~20h cooldown → at most one per day).
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
      AND (
        NOT (${ack})
        OR COALESCE(p.consent_status, 'unknown') IN ('unknown', 'pending')
      )
      AND NOT EXISTS (
        SELECT 1 FROM consent_reminder_log crl
        WHERE crl.patient_id = p.id
          AND crl.sent_at > NOW() - INTERVAL '${REMINDER_COOLDOWN_HOURS} hours'
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

  return result;
}

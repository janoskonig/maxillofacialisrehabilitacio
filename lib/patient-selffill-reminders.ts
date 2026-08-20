import { getDbPool } from '@/lib/db';
import { getPatientDataCompleteness, type MissingItem } from '@/lib/patient-data-completeness';
import { insertUserTask } from '@/lib/user-tasks';
import {
  resolvePatientPortalUserId,
  resolveTaskCreator,
} from '@/lib/ohip14-patient-tasks';
import { sendPushNotification } from '@/lib/push-notifications';
import { sendEmail, getBaseUrlForEmail } from '@/lib/email';
import { logger } from '@/lib/logger';

/**
 * Beteg-önkitöltési nudge (az "önjáró adatgyűjtés" beteg-oldali ága).
 *
 * A beteg által önkitölthető, hiányzó mezőkről (életmód-anamnézis,
 * fogpótlás-elégedettség — lásd PATIENT_FILLABLE_KEYS) a rendszer a BETEGET
 * emlékezteti az OHIP-mintára: portál-feladat + Web Push + heti e-mail.
 * Az orvosokat ezek a hiányok nem terhelik. A feladat automatikusan lezárul,
 * ha a beteg pótolta az adatokat.
 */

const SELFFILL_TASK_SOURCE = 'patient_selffill';
const REMINDER_COOLDOWN_DAYS = 7;

/** Az OHIP-nak saját folyama van — itt a többi önkitölthető mező megy. */
const SELFFILL_KEYS: ReadonlySet<string> = new Set([
  'dohanyzas',
  'alkohol',
  'felsoFogpotlasElegedett',
  'alsoFogpotlasElegedett',
]);

export interface SelfFillReminderResult {
  patientsWithMissing: number;
  tasksCreated: number;
  tasksClosed: number;
  emailsSent: number;
  skipped: number;
  errors: number;
}

export async function sendPatientSelfFillReminders(): Promise<SelfFillReminderResult> {
  const pool = getDbPool();
  const result: SelfFillReminderResult = {
    patientsWithMissing: 0,
    tasksCreated: 0,
    tasksClosed: 0,
    emailsSent: 0,
    skipped: 0,
    errors: 0,
  };

  // Csak nyitott epizódú betegeket nudge-olunk (lezárt ellátásnál nem).
  const openRes = await pool.query(
    `SELECT DISTINCT pe.patient_id
       FROM patient_episodes pe
       JOIN patients p ON p.id = pe.patient_id
      WHERE pe.status = 'open'
        AND p.halal_datum IS NULL`,
  );
  const openIds = new Set<string>(openRes.rows.map((r: any) => r.patient_id));
  if (openIds.size === 0) return result;

  // Egyetlen forrás-igazság: a completeness-riport (a hiány + N/A logika közös).
  const report = await getPatientDataCompleteness();
  const baseUrl = getBaseUrlForEmail();

  for (const row of report.patients) {
    try {
      if (!openIds.has(row.patientId)) continue;
      const selfFillMissing = row.researchMissing.filter((m) => SELFFILL_KEYS.has(m.key));

      if (selfFillMissing.length === 0) {
        result.tasksClosed += await closeOpenSelfFillTasks(row.patientId);
        continue;
      }
      result.patientsWithMissing += 1;

      const created = await ensureSelfFillTask(row.patientId, selfFillMissing);
      if (created) {
        result.tasksCreated += 1;
        await pushSelfFillReminder(row.patientId, selfFillMissing);
      }

      // Heti e-mail cooldown.
      const emailRes = await pool.query(
        `SELECT p.email FROM patients p
          WHERE p.id = $1 AND p.email IS NOT NULL AND btrim(p.email) <> ''`,
        [row.patientId],
      );
      const email: string | undefined = emailRes.rows[0]?.email;
      if (!email) {
        result.skipped += 1;
        continue;
      }
      const recent = await pool.query(
        `SELECT 1 FROM patient_selffill_reminder_log
          WHERE patient_id = $1
            AND sent_at > NOW() - INTERVAL '${REMINDER_COOLDOWN_DAYS} days'
          LIMIT 1`,
        [row.patientId],
      );
      if (recent.rows.length > 0) {
        result.skipped += 1;
        continue;
      }

      await sendEmail({
        to: email,
        subject: 'Kérjük, egészítse ki egészségi adatait — Maxillofaciális Rehabilitáció',
        html: selfFillEmailHtml(row.patientName, selfFillMissing, `${baseUrl}/patient-portal/profile`),
        patientId: row.patientId,
      });
      await pool.query(
        `INSERT INTO patient_selffill_reminder_log (patient_id, email_to, missing_keys)
         VALUES ($1, $2, $3)`,
        [row.patientId, email, selfFillMissing.map((m) => m.key)],
      );
      result.emailsSent += 1;
    } catch (err) {
      logger.error(`[selffill-reminders] hiba (${row.patientId}):`, err);
      result.errors += 1;
    }
  }

  return result;
}

/** Nyitott önkitöltési feladat biztosítása (betegenként egy). */
async function ensureSelfFillTask(patientId: string, missing: MissingItem[]): Promise<boolean> {
  const pool = getDbPool();
  const existing = await pool.query(
    `SELECT 1 FROM user_tasks
      WHERE task_type = 'missing_data'
        AND assignee_kind = 'patient'
        AND assignee_patient_id = $1
        AND status = 'open'
        AND metadata->>'source' = $2
      LIMIT 1`,
    [patientId, SELFFILL_TASK_SOURCE],
  );
  if (existing.rows.length > 0) return false;

  const creator = await resolveTaskCreator(pool, patientId);
  if (!creator) return false;

  await insertUserTask({
    assigneeKind: 'patient',
    assigneeUserId: null,
    assigneePatientId: patientId,
    patientId,
    taskType: 'missing_data',
    title: 'Egészségi adatok kiegészítése',
    description: `Kérjük, egészítse ki a betegportálon: ${missing.map((m) => m.label).join(', ')}.`,
    metadata: { source: SELFFILL_TASK_SOURCE, missingKeys: missing.map((m) => m.key) },
    createdByUserId: creator,
  });
  return true;
}

/** A beteg önkitöltési feladatainak lezárása, ha már nincs hiány. */
export async function closeOpenSelfFillTasks(patientId: string): Promise<number> {
  const pool = getDbPool();
  const res = await pool.query(
    `UPDATE user_tasks
        SET status = 'done', completed_at = NOW()
      WHERE task_type = 'missing_data'
        AND assignee_kind = 'patient'
        AND assignee_patient_id = $1
        AND status = 'open'
        AND metadata->>'source' = $2`,
    [patientId, SELFFILL_TASK_SOURCE],
  );
  return res.rowCount ?? 0;
}

/** Web Push a betegnek (best-effort). */
async function pushSelfFillReminder(patientId: string, missing: MissingItem[]): Promise<void> {
  const pool = getDbPool();
  try {
    const uid = await resolvePatientPortalUserId(pool, patientId);
    if (!uid) return;
    await sendPushNotification(uid, {
      title: 'Egészségi adatok kiegészítése',
      body: `Kérjük, egészítse ki: ${missing.map((m) => m.label).join(', ')}.`,
      icon: '/icon-192x192.png',
      tag: 'patient-selffill',
      data: { url: '/patient-portal/profile', type: 'reminder' },
    }, { patientId });
  } catch (err) {
    logger.error(`[selffill-reminders] push hiba (${patientId}):`, err);
  }
}

function selfFillEmailHtml(name: string | null, missing: MissingItem[], portalUrl: string): string {
  const items = missing.map((m) => `<li>${m.label}</li>`).join('');
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #0f766e;">Kedves ${name ?? 'Betegünk'}!</h2>
      <p>A kezelése kapcsán néhány adat még hiányzik, amelyet Ön tud a legpontosabban megadni:</p>
      <ul>${items}</ul>
      <p>Kérjük, egészítse ki a betegportálon — csak néhány percet vesz igénybe:</p>
      <p style="margin: 24px 0;">
        <a href="${portalUrl}" style="background: #0f766e; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: bold;">
          Adataim kiegészítése
        </a>
      </p>
      <p style="color: #6b7280; font-size: 13px;">
        Ezek az adatok a kezelés eredményességének értékeléséhez szükségesek. Köszönjük a segítségét!
      </p>
    </div>
  `;
}

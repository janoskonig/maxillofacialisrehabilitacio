import { getDbPool } from '@/lib/db';
import { sendMissingDataReminderEmail } from '@/lib/email';
import { queueAdminNotification } from '@/lib/email/admin-notification-queue';
import { insertUserTask } from '@/lib/user-tasks';
import {
  getPatientDataCompleteness,
  type MissingItem,
  type PatientCompletenessRow,
} from '@/lib/patient-data-completeness';
import { logger } from '@/lib/logger';

/**
 * Hiányzó betegadat-emlékeztetők az érintett orvosoknak.
 *
 * Minden olyan betegnél, akinek hiányzó klinikai vagy kutatási adata van,
 * értesítjük (e-mailben + feladatként):
 *  - a beutaló orvost (ha a `patient_referral.beutalo_orvos` név egy
 *    `beutalo_orvos` szerepű felhasználóra illeszthető — ha nem, kihagyjuk), és
 *  - a legutóbbi fogpótlástanászt, akinél a betegnek időpontja volt.
 *
 * Idempotens / ismétlődő: a `missing_data_reminder_log` garantálja, hogy egy
 * (beteg, címzett) párnak 7 naponta legfeljebb egy e-mail menjen ki. Ha egy hét
 * után is hiányzik az adat, a következő futás új ("ismételt") értesítőt küld.
 * Ha az adat pótlásra kerül, a nyitott `missing_data` feladatokat lezárjuk.
 */

const REMINDER_COOLDOWN_DAYS = 7;
const PROSTHODONTIST_ROLE = 'fogpótlástanász';
const REFERRER_ROLE = 'beutalo_orvos';

export interface MissingDataReminderResult {
  patientsWithMissing: number;
  emailsSent: number;
  tasksCreated: number;
  tasksClosed: number;
  skipped: number;
  errors: number;
}

type Recipient = {
  userId: string;
  email: string;
  name: string | null;
  role: typeof REFERRER_ROLE | typeof PROSTHODONTIST_ROLE;
};

/** Az érintett orvosok deduplikálása user-id alapján (egy orvos egyszer kap értesítőt). */
export function dedupeRecipients(recipients: (Recipient | null)[]): Recipient[] {
  const byId = new Map<string, Recipient>();
  for (const r of recipients) {
    if (r && r.email && !byId.has(r.userId)) byId.set(r.userId, r);
  }
  return Array.from(byId.values());
}

/** A hiányzó tételek rövid, ember által olvasható összegzése (logoláshoz / feladat-leíráshoz). */
export function formatMissingSummary(items: MissingItem[]): string {
  return items.map((i) => i.label).join(', ');
}

function missingItemsOf(row: PatientCompletenessRow): MissingItem[] {
  return [...row.clinicalMissing, ...row.researchMissing];
}

export async function sendMissingDataReminders(): Promise<MissingDataReminderResult> {
  const pool = getDbPool();
  const result: MissingDataReminderResult = {
    patientsWithMissing: 0,
    emailsSent: 0,
    tasksCreated: 0,
    tasksClosed: 0,
    skipped: 0,
    errors: 0,
  };

  const report = await getPatientDataCompleteness();

  const incomplete = report.patients.filter((p) => missingItemsOf(p).length > 0);
  const completeIds = report.patients
    .filter((p) => missingItemsOf(p).length === 0)
    .map((p) => p.patientId);

  result.patientsWithMissing = incomplete.length;

  // 1) Ha egy betegnél már minden adat megvan, a hozzá tartozó nyitott
  //    'missing_data' feladatokat automatikusan lezárjuk.
  if (completeIds.length > 0) {
    const closed = await pool.query(
      `UPDATE user_tasks
          SET status = 'done', completed_at = NOW()
        WHERE task_type = 'missing_data'
          AND status = 'open'
          AND patient_id = ANY($1::uuid[])`,
      [completeIds]
    );
    result.tasksClosed = closed.rowCount ?? 0;
  }

  // 2) Hiányos betegenként az érintett orvosok értesítése.
  for (const row of incomplete) {
    const patientId = row.patientId;
    try {
      const missingItems = missingItemsOf(row);
      const summary = formatMissingSummary(missingItems);

      const recipients = dedupeRecipients([
        await resolveReferrer(pool, patientId),
        await resolveLatestProsthodontist(pool, patientId),
      ]);

      if (recipients.length === 0) {
        result.skipped++;
        continue;
      }

      for (const recipient of recipients) {
        // Folyamatban lévő emlékeztető? (7 napon belül már küldtünk ennek a párnak)
        const recent = await pool.query(
          `SELECT 1 FROM missing_data_reminder_log
            WHERE patient_id = $1 AND recipient_user_id = $2
              AND sent_at > NOW() - INTERVAL '${REMINDER_COOLDOWN_DAYS} days'
            LIMIT 1`,
          [patientId, recipient.userId]
        );

        // Nyitott feladat biztosítása (a cooldowntól függetlenül), hogy a
        // teendő látható maradjon, amíg a hiány fennáll.
        const taskCreated = await ensureMissingDataTask(
          pool,
          patientId,
          row.patientName,
          recipient,
          summary
        );
        if (taskCreated) result.tasksCreated++;

        if (recent.rows.length > 0) {
          // Még tart a heti cooldown — feladat megvan, e-mailt most nem küldünk.
          result.skipped++;
          continue;
        }

        // Volt-e korábbi értesítő ehhez a párhoz? (akkor ez "ismételt" emlékeztető)
        const prior = await pool.query(
          `SELECT 1 FROM missing_data_reminder_log
            WHERE patient_id = $1 AND recipient_user_id = $2 LIMIT 1`,
          [patientId, recipient.userId]
        );
        const isFollowUp = prior.rows.length > 0;

        await sendMissingDataReminderEmail({
          to: recipient.email,
          recipientName: recipient.name,
          patientName: row.patientName,
          patientId,
          missingItems,
          isFollowUp,
        });

        await pool.query(
          `INSERT INTO missing_data_reminder_log
             (patient_id, recipient_user_id, recipient_role, email_to, missing_summary)
           VALUES ($1, $2, $3, $4, $5)`,
          [patientId, recipient.userId, recipient.role, recipient.email, summary]
        );

        await queueAdminNotification(
          'missing_data_reminder_sent',
          `${row.patientName ?? 'Beteg'} — ${recipient.name ?? recipient.email} (${recipient.role})`,
          { patientId, recipientUserId: recipient.userId, role: recipient.role, missing: summary }
        ).catch(() => {});

        result.emailsSent++;
      }
    } catch (err) {
      logger.error(`[missing-data-reminders] Hiba a(z) ${patientId} betegnél:`, err);
      result.errors++;
    }
  }

  return result;
}

/**
 * A beutaló orvos feloldása felhasználói fiókra. A `patient_referral.beutalo_orvos`
 * csak szabad szöveges név, ezért normalizált (kisbetűs, trimmelt) névegyezést
 * keresünk a `beutalo_orvos` szerepű felhasználók között. Ha nincs egyértelmű
 * találat, `null` (a beutaló orvost kihagyjuk).
 */
async function resolveReferrer(
  pool: ReturnType<typeof getDbPool>,
  patientId: string
): Promise<Recipient | null> {
  const res = await pool.query(
    `SELECT u.id, u.email, u.doktor_neve
       FROM patient_referral pr
       JOIN users u
         ON u.role = $2
        AND u.active IS NOT FALSE
        AND lower(btrim(u.doktor_neve)) = lower(btrim(pr.beutalo_orvos))
      WHERE pr.patient_id = $1
        AND pr.beutalo_orvos IS NOT NULL
        AND btrim(pr.beutalo_orvos) <> ''
      LIMIT 1`,
    [patientId, REFERRER_ROLE]
  );
  const r = res.rows[0];
  if (!r || !r.email) return null;
  return { userId: r.id, email: r.email, name: r.doktor_neve ?? null, role: REFERRER_ROLE };
}

/**
 * A legutóbbi fogpótlástanász, akinél a betegnek időpontja volt. Az
 * `appointments.dentist_email` alapján joinolunk a `fogpótlástanász` szerepű
 * felhasználókra, a lemondott / elutasított időpontokat kihagyva.
 */
async function resolveLatestProsthodontist(
  pool: ReturnType<typeof getDbPool>,
  patientId: string
): Promise<Recipient | null> {
  const res = await pool.query(
    `SELECT u.id, u.email, u.doktor_neve
       FROM appointments a
       JOIN users u
         ON lower(btrim(u.email)) = lower(btrim(a.dentist_email))
        AND u.role = $2
        AND u.active IS NOT FALSE
      WHERE a.patient_id = $1
        AND (a.appointment_status IS NULL
             OR a.appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient'))
        AND (a.approval_status IS NULL OR a.approval_status <> 'rejected')
      ORDER BY a.start_time DESC NULLS LAST
      LIMIT 1`,
    [patientId, PROSTHODONTIST_ROLE]
  );
  const r = res.rows[0];
  if (!r || !r.email) return null;
  return { userId: r.id, email: r.email, name: r.doktor_neve ?? null, role: PROSTHODONTIST_ROLE };
}

/**
 * Nyitott 'missing_data' feladat biztosítása az adott (beteg, címzett) párra.
 * Ha már van nyitott ilyen feladat, nem hozunk létre újat. Visszatérés: `true`,
 * ha most jött létre feladat.
 */
async function ensureMissingDataTask(
  pool: ReturnType<typeof getDbPool>,
  patientId: string,
  patientName: string | null,
  recipient: Recipient,
  summary: string
): Promise<boolean> {
  const existing = await pool.query(
    `SELECT 1 FROM user_tasks
      WHERE task_type = 'missing_data'
        AND status = 'open'
        AND patient_id = $1
        AND assignee_user_id = $2
      LIMIT 1`,
    [patientId, recipient.userId]
  );
  if (existing.rows.length > 0) return false;

  const betegLabel = patientName?.trim() ? patientName.trim() : 'beteg';
  await insertUserTask({
    assigneeKind: 'staff',
    assigneeUserId: recipient.userId,
    assigneePatientId: null,
    patientId,
    taskType: 'missing_data',
    title: `Hiányzó betegadatok pótlása – ${betegLabel}`,
    description: summary ? `Hiányzó adatok: ${summary}` : null,
    metadata: { source: 'missing_data_reminder', role: recipient.role },
    createdByUserId: recipient.userId,
  });
  return true;
}

import { getDbPool } from '@/lib/db';
import { sendMissingDataReminderEmail, sendEmail, getBaseUrlForEmail } from '@/lib/email';
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
/**
 * A kezelőorvos a betegadat-teljességért felelős EGYETLEN személy. Ez nem
 * DB-szerep, hanem címzett-címke: a kezelőorvos technikailag fogpótlástanász
 * vagy admin, de az emlékeztetők szempontjából külön, elsődleges felelős.
 */
const KEZELOORVOS_ROLE = 'kezeloorvos';

/**
 * Ennyi (heti) emlékeztető után az érintett orvost már nem nyaggatjuk tovább:
 * a beteget az adminhoz eszkaláljuk (a feladat nyitva marad).
 */
export const ESCALATION_AFTER = 3;

/** Eszkaláljunk-e? — az orvosnak eddig küldött emlékeztetők száma alapján. */
export function shouldEscalate(priorReminderCount: number): boolean {
  return priorReminderCount >= ESCALATION_AFTER;
}

export interface MissingDataReminderResult {
  patientsWithMissing: number;
  emailsSent: number;
  tasksCreated: number;
  tasksClosed: number;
  escalations: number;
  /** Hiányos betegek kijelölt kezelőorvos nélkül (adminhoz jelezve). */
  noOwner: number;
  skipped: number;
  errors: number;
}

type RecipientRole =
  | typeof KEZELOORVOS_ROLE
  | typeof REFERRER_ROLE
  | typeof PROSTHODONTIST_ROLE
  | 'admin';

export type Recipient = {
  userId: string;
  email: string;
  name: string | null;
  role: RecipientRole;
};

/**
 * Az elsődleges címzettek eldöntése (tiszta, DB-mentes — így unit-tesztelhető).
 * A kezelőorvos az EGYETLEN rendes felelős; ha nincs kijelölve, a beutaló orvos
 * + legutóbbi fogpótlástanász a fallback, és `noOwner=true` (admin-jelzés).
 */
export function resolvePrimaryRecipients(
  kezeloorvos: Recipient | null,
  fallback: (Recipient | null)[]
): { recipients: Recipient[]; noOwner: boolean } {
  if (kezeloorvos) return { recipients: [kezeloorvos], noOwner: false };
  return { recipients: dedupeRecipients(fallback), noOwner: true };
}

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

/**
 * A páciens által kitöltendő tételek, amelyekről az orvosok NEM kapnak
 * értesítőt / feladatot — ezeket a beteg a portálon pótolja (külön
 * emlékeztetőkkel, pl. OHIP-14). A kulcsok a getPatientDataCompleteness()
 * MissingItem.key értékeivel egyeznek.
 */
export const PATIENT_FILLABLE_KEYS: ReadonlySet<string> = new Set([
  'ohipT0',
  // Életmód-anamnézis + fogpótlás-elégedettség: a beteg a hiteles forrás,
  // a portálon tölti ki (lib/patient-selffill-reminders nudge-olja).
  'dohanyzas',
  'alkohol',
  'felsoFogpotlasElegedett',
  'alsoFogpotlasElegedett',
]);

/**
 * Az orvosi intézkedést igénylő hiányok: a teljes hiánylistából kiszűrve a
 * páciens által kitöltendő tételeket.
 */
export function doctorActionableMissing(row: PatientCompletenessRow): MissingItem[] {
  return [...row.clinicalMissing, ...row.researchMissing].filter(
    (i) => !PATIENT_FILLABLE_KEYS.has(i.key)
  );
}

/**
 * A beutaló orvos által pótolható tételek: a beutalás-kori klinikai adatok
 * (indoklás, műtét, szövettan) és a kódolás (BNO, TNM). Ezekről elsődlegesen
 * a beutaló orvos kap emlékeztetőt — a kezelőorvosra csak akkor szállnak
 * vissza, ha a beutaló ESCALATION_AFTER emlékeztető után sem pótolta, vagy
 * nincs feloldható beutaló orvos.
 */
export const REFERRER_FILLABLE_KEYS: ReadonlySet<string> = new Set([
  'beutaloIndokolas',
  'mutetLeiras',
  'mutetIdeje',
  'szovettan',
  'bno',
  'tnmStaging',
]);

/**
 * Hiánylista felosztása felelős szerint (tiszta, DB-mentes — unit-tesztelhető).
 */
export function splitByResponsible(items: MissingItem[]): {
  referrerItems: MissingItem[];
  kezeloItems: MissingItem[];
} {
  return {
    referrerItems: items.filter((i) => REFERRER_FILLABLE_KEYS.has(i.key)),
    kezeloItems: items.filter((i) => !REFERRER_FILLABLE_KEYS.has(i.key)),
  };
}

export async function sendMissingDataReminders(): Promise<MissingDataReminderResult> {
  const pool = getDbPool();
  const result: MissingDataReminderResult = {
    patientsWithMissing: 0,
    emailsSent: 0,
    tasksCreated: 0,
    tasksClosed: 0,
    escalations: 0,
    noOwner: 0,
    skipped: 0,
    errors: 0,
  };

  const report = await getPatientDataCompleteness();

  // Csak az orvosi intézkedést igénylő hiányokat vesszük figyelembe — a páciens
  // által kitöltendő tételek (pl. OHIP-14) nem váltanak ki orvosi értesítőt.
  const incomplete = report.patients.filter((p) => doctorActionableMissing(p).length > 0);
  const completeIds = report.patients
    .filter((p) => doctorActionableMissing(p).length === 0)
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
  //    A beutaló orvos által pótolható tételek (REFERRER_FILLABLE_KEYS)
  //    elsődlegesen a BEUTALÓHOZ kerülnek (heti összesített e-mail); a
  //    kezelőorvosra csak eszkalációként vagy feloldhatatlan beutalónál
  //    szállnak vissza. Minden más tétel a kezelőorvosé marad.
  const referrerDigests = new Map<
    string,
    {
      recipient: Recipient;
      entries: { patientId: string; patientName: string | null; items: MissingItem[] }[];
    }
  >();

  for (const row of incomplete) {
    const patientId = row.patientId;
    try {
      const allMissing = doctorActionableMissing(row);
      const { referrerItems, kezeloItems: baseKezeloItems } = splitByResponsible(allMissing);
      let kezeloItems = baseKezeloItems;

      // --- Beutaló-ág ---
      if (referrerItems.length > 0) {
        const referrer = await resolveReferrer(pool, patientId);
        if (!referrer) {
          // Nincs feloldható beutaló → a kezelőorvos örökli a tételeket.
          kezeloItems = [...kezeloItems, ...referrerItems];
        } else {
          const priorCount = await reminderCount(pool, patientId, referrer.userId);
          if (shouldEscalate(priorCount)) {
            // A beutalót eleget emlékeztettük — visszaszáll a kezelőorvosra
            // (a beutaló nyitott feladata megmarad, de több levelet nem kap).
            kezeloItems = [...kezeloItems, ...referrerItems];
            result.escalations++;
          } else {
            const refSummary = formatMissingSummary(referrerItems);
            const taskCreated = await ensureMissingDataTask(
              pool,
              patientId,
              row.patientName,
              referrer,
              refSummary
            );
            if (taskCreated) result.tasksCreated++;
            // Az e-mail NEM itt megy ki: beutalónként EGY heti összesítőt
            // küldünk a ciklus után (betegenkénti cooldownnal).
            const digest = referrerDigests.get(referrer.userId) ?? { recipient: referrer, entries: [] };
            digest.entries.push({ patientId, patientName: row.patientName, items: referrerItems });
            referrerDigests.set(referrer.userId, digest);
          }
        }
      } else {
        // A beutaló-tételek rendben → a beutaló nyitott feladatai lezárhatók.
        result.tasksClosed += await closeRoleTasks(pool, patientId, REFERRER_ROLE);
      }

      if (kezeloItems.length === 0) {
        // A kezelőorvosnak nincs teendője ennél a betegnél — a nyitott
        // kezelőorvosi feladatait lezárjuk, e-mailt nem kap.
        result.tasksClosed += await closeRoleTasks(pool, patientId, KEZELOORVOS_ROLE);
        continue;
      }

      const missingItems = kezeloItems;
      const summary = formatMissingSummary(missingItems);

      // A kezelőorvos az elsődleges és EGYETLEN rendes felelős. Ha ki van
      // jelölve, csak ő kapja az emlékeztetőt (a beutaló orvost / fogpótlás-
      // tanászt nem nyaggatjuk — egy beteg = egy számon kérhető felelős).
      // Ha NINCS kezelőorvos, ez maga is elszámoltathatósági hiba: jelezzük az
      // adminnak (kezelőorvost kell kijelölni), és visszaesünk a beutaló orvosra
      // + legutóbbi fogpótlástanászra, hogy az adat addig is gazdára találjon.
      const kezeloorvos = await resolveKezeloorvos(pool, patientId);
      // A fallback címzetteket csak akkor oldjuk fel, ha nincs kezelőorvos
      // (rövidre zárás — kezelőorvossal nincs felesleges DB-hívás).
      const fallback = kezeloorvos
        ? []
        : [
            await resolveReferrer(pool, patientId),
            await resolveLatestProsthodontist(pool, patientId),
          ];
      const { recipients, noOwner } = resolvePrimaryRecipients(kezeloorvos, fallback);

      if (noOwner) {
        await flagNoOwner(pool, patientId, row.patientName, summary, result);
      }

      if (recipients.length === 0) {
        result.skipped++;
        continue;
      }

      let needsEscalation = false;
      for (const recipient of recipients) {
        // Nyitott feladat biztosítása (a cooldown / eszkaláció előtt), hogy a
        // teendő látható maradjon, amíg a hiány fennáll.
        const taskCreated = await ensureMissingDataTask(
          pool,
          patientId,
          row.patientName,
          recipient,
          summary
        );
        if (taskCreated) result.tasksCreated++;

        // Eddig hány emlékeztetőt küldtünk ennek az orvosnak erről a betegről?
        const priorCount = await reminderCount(pool, patientId, recipient.userId);

        if (shouldEscalate(priorCount)) {
          // Az orvost már elégszer (>= ESCALATION_AFTER) emlékeztettük — nem
          // nyaggatjuk tovább; a feladata nyitva marad, a beteget eszkaláljuk.
          needsEscalation = true;
          result.skipped++;
          continue;
        }

        const sent = await sendReminderEmailWithCooldown(
          pool,
          patientId,
          row.patientName,
          recipient,
          missingItems,
          summary,
          priorCount,
          false,
        );
        if (sent) result.emailsSent++;
        else result.skipped++;
      }

      // Eszkaláció az adminokhoz, ha valamelyik orvos elérte a küszöböt.
      if (needsEscalation) {
        const admins = await resolveAdmins(pool);
        for (const admin of admins) {
          const taskCreated = await ensureMissingDataTask(
            pool,
            patientId,
            row.patientName,
            admin,
            summary
          );
          if (taskCreated) result.tasksCreated++;

          const priorCount = await reminderCount(pool, patientId, admin.userId);
          const sent = await sendReminderEmailWithCooldown(
            pool,
            patientId,
            row.patientName,
            admin,
            missingItems,
            summary,
            priorCount,
            true,
          );
          if (sent) result.escalations++;
          else result.skipped++;
        }
      }
    } catch (err) {
      logger.error(`[missing-data-reminders] Hiba a(z) ${patientId} betegnél:`, err);
      result.errors++;
    }
  }

  // 3) Beutalónkénti heti összesítő e-mail (betegenkénti cooldownnal: csak
  //    azok a betegek kerülnek a levélbe, akikről 7 napja nem ment értesítő).
  for (const digest of Array.from(referrerDigests.values())) {
    try {
      const due: typeof digest.entries = [];
      for (const entry of digest.entries) {
        const recent = await hasRecentReminder(pool, entry.patientId, digest.recipient.userId);
        if (recent) result.skipped++;
        else due.push(entry);
      }
      if (due.length === 0) continue;

      await sendEmail({
        to: digest.recipient.email,
        subject: `Pótlandó beutalási adatok — ${due.length} beteg (heti összesítő)`,
        html: buildReferrerDigestHtml(digest.recipient.name, due),
        emailType: 'missing_data_referrer_digest',
        metadata: { recipientUserId: digest.recipient.userId, patientCount: due.length },
      });
      for (const entry of due) {
        await pool.query(
          `INSERT INTO missing_data_reminder_log
             (patient_id, recipient_user_id, recipient_role, email_to, missing_summary)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            entry.patientId,
            digest.recipient.userId,
            REFERRER_ROLE,
            digest.recipient.email,
            formatMissingSummary(entry.items),
          ]
        );
      }
      result.emailsSent++;

      await queueAdminNotification(
        'missing_data_reminder_sent',
        `Beutalói összesítő — ${digest.recipient.name ?? digest.recipient.email} (${due.length} beteg)`,
        { recipientUserId: digest.recipient.userId, role: REFERRER_ROLE, patientCount: due.length }
      ).catch(() => {});
    } catch (err) {
      logger.error(
        `[missing-data-reminders] Beutalói összesítő hiba (${digest.recipient.email}):`,
        err
      );
      result.errors++;
    }
  }

  return result;
}

/**
 * Egy adott szerep-címkéjű címzett nyitott 'missing_data' feladatainak lezárása
 * egy betegnél — akkor hívjuk, ha az adott felelős tétel-listája kiürült.
 */
async function closeRoleTasks(
  pool: ReturnType<typeof getDbPool>,
  patientId: string,
  role: RecipientRole
): Promise<number> {
  const res = await pool.query(
    `UPDATE user_tasks
        SET status = 'done', completed_at = NOW()
      WHERE task_type = 'missing_data'
        AND status = 'open'
        AND patient_id = $1
        AND metadata->>'role' = $2`,
    [patientId, role]
  );
  return res.rowCount ?? 0;
}

/** Volt-e e-mail ennek a (beteg, címzett) párnak a cooldown-ablakon belül? */
async function hasRecentReminder(
  pool: ReturnType<typeof getDbPool>,
  patientId: string,
  recipientUserId: string
): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM missing_data_reminder_log
      WHERE patient_id = $1 AND recipient_user_id = $2
        AND sent_at > NOW() - INTERVAL '${REMINDER_COOLDOWN_DAYS} days'
      LIMIT 1`,
    [patientId, recipientUserId]
  );
  return res.rows.length > 0;
}

/** A beutalói heti összesítő e-mail tartalma (beteg + hiányzó mezők + karton-link). */
function buildReferrerDigestHtml(
  recipientName: string | null,
  entries: { patientId: string; patientName: string | null; items: MissingItem[] }[]
): string {
  const baseUrl = getBaseUrlForEmail();
  const rows = entries
    .map(
      (e) => `
        <li style="margin-bottom: 10px;">
          <strong>${e.patientName ?? 'Név nélküli beteg'}</strong> —
          ${e.items.map((i) => i.label).join(', ')}
          &nbsp;<a href="${baseUrl}/patients/${e.patientId}/view">Karton megnyitása</a>
        </li>`
    )
    .join('');
  return `
    <div style="font-family: Arial, sans-serif;">
      <h2 style="color: #0f766e;">Kedves ${recipientName ?? 'Doktornő/Doktor Úr'}!</h2>
      <p>Az Ön által beutalt betegeknél az alábbi, a beutaláshoz kapcsolódó adatok
      hiányoznak (beutaló indoklás, műtéti adatok, szövettan, BNO/TNM kód):</p>
      <ul>${rows}</ul>
      <p style="color: #6b7280; font-size: 13px;">
        Ezeket az adatokat Ön ismeri a legpontosabban. A pótlás a beteg kartonján
        néhány percet vesz igénybe — köszönjük a segítségét!
      </p>
    </div>
  `;
}

/** Eddig hány emlékeztetőt logoltunk ennek a (beteg, címzett) párnak. */
async function reminderCount(
  pool: ReturnType<typeof getDbPool>,
  patientId: string,
  recipientUserId: string,
): Promise<number> {
  const res = await pool.query(
    `SELECT count(*)::int AS c FROM missing_data_reminder_log
      WHERE patient_id = $1 AND recipient_user_id = $2`,
    [patientId, recipientUserId],
  );
  return (res.rows[0]?.c as number) ?? 0;
}

/**
 * E-mail küldése a 7 napos cooldown betartásával + naplózás. Visszatérés: true,
 * ha most ténylegesen küldtünk e-mailt (false = cooldown miatt kihagyva).
 */
async function sendReminderEmailWithCooldown(
  pool: ReturnType<typeof getDbPool>,
  patientId: string,
  patientName: string | null,
  recipient: Recipient,
  missingItems: MissingItem[],
  summary: string,
  priorCount: number,
  escalation: boolean,
): Promise<boolean> {
  const recent = await pool.query(
    `SELECT 1 FROM missing_data_reminder_log
      WHERE patient_id = $1 AND recipient_user_id = $2
        AND sent_at > NOW() - INTERVAL '${REMINDER_COOLDOWN_DAYS} days'
      LIMIT 1`,
    [patientId, recipient.userId],
  );
  if (recent.rows.length > 0) return false; // még tart a heti cooldown

  await sendMissingDataReminderEmail({
    to: recipient.email,
    recipientName: recipient.name,
    patientName,
    patientId,
    missingItems,
    isFollowUp: priorCount > 0,
    escalation,
  });

  await pool.query(
    `INSERT INTO missing_data_reminder_log
       (patient_id, recipient_user_id, recipient_role, email_to, missing_summary)
     VALUES ($1, $2, $3, $4, $5)`,
    [patientId, recipient.userId, recipient.role, recipient.email, summary],
  );

  await queueAdminNotification(
    escalation ? 'missing_data_escalated' : 'missing_data_reminder_sent',
    `${patientName ?? 'Beteg'} — ${recipient.name ?? recipient.email} (${recipient.role})`,
    { patientId, recipientUserId: recipient.userId, role: recipient.role, missing: summary, escalation },
  ).catch(() => {});

  return true;
}

/** Aktív admin felhasználók (e-maillel) — az eszkaláció címzettjei. */
async function resolveAdmins(
  pool: ReturnType<typeof getDbPool>,
): Promise<Recipient[]> {
  const res = await pool.query(
    `SELECT id, email, doktor_neve
       FROM users
      WHERE role = 'admin' AND active IS NOT FALSE
        AND email IS NOT NULL AND btrim(email) <> ''`,
  );
  return res.rows.map((r) => ({
    userId: r.id as string,
    email: r.email as string,
    name: (r.doktor_neve as string) ?? null,
    role: 'admin' as const,
  }));
}

/**
 * A beutaló orvos feloldása felhasználói fiókra. A `patient_referral.beutalo_orvos`
 * csak szabad szöveges név, ezért normalizált (kisbetűs, trimmelt) névegyezést
 * keresünk a `beutalo_orvos` szerepű felhasználók között. Ha nincs egyértelmű
 * találat, `null` (a beutaló orvost kihagyjuk).
 */
/**
 * Egyetlen beteg orvosi intézkedést igénylő hiányai (a heti riporttal azonos
 * forrásból, hogy ne térjen el a logika). Üres tömb = nincs mit pótolniuk az
 * orvosoknak (a páciens-kitöltendő tételek, pl. OHIP-14, ki vannak szűrve).
 */
export async function getDoctorActionableMissingForPatient(
  patientId: string,
): Promise<MissingItem[]> {
  const report = await getPatientDataCompleteness({ patientId });
  const row = report.patients[0];
  if (!row) return [];
  return doctorActionableMissing(row);
}

/**
 * A beteghez tartozó nyitott 'missing_data' feladatok lezárása, AMINT a hiányzó
 * adat bekerült (bárki — staff vagy maga a beteg — pótolta). Így a feladat nem
 * csak kézi kipipálással szűnik meg. Visszatérés: a lezárt feladatok száma.
 */
export async function reconcileMissingDataTasks(patientId: string): Promise<number> {
  const missing = await getDoctorActionableMissingForPatient(patientId);
  if (missing.length > 0) return 0;

  const pool = getDbPool();
  const closed = await pool.query(
    `UPDATE user_tasks
        SET status = 'done', completed_at = NOW()
      WHERE task_type = 'missing_data'
        AND status = 'open'
        AND patient_id = $1`,
    [patientId],
  );
  return closed.rowCount ?? 0;
}

/**
 * Fire-and-forget burkoló a betegadat-mentési útvonalakhoz — sosem dob, csak
 * logol (a `recomputeKezeleoorvosSilent` mintájára). A hívó tranzakció
 * commitja UTÁN hívd, hogy a friss adatot lássa.
 */
export function reconcileMissingDataTasksSilent(patientId: string): void {
  reconcileMissingDataTasks(patientId).catch((err) => {
    logger.error(`[missing-data-reminders] reconcile hiba (${patientId}):`, err);
  });
}

/**
 * A beteg kijelölt kezelőorvosa (`patients.kezeleoorvos_user_id`) mint elsődleges
 * felelős. Csak aktív, e-mail-címmel rendelkező felhasználót ad vissza; ha nincs
 * kijelölve vagy nincs e-mailje, `null` (ekkor a hívó no-owner ágra esik).
 */
async function resolveKezeloorvos(
  pool: ReturnType<typeof getDbPool>,
  patientId: string
): Promise<Recipient | null> {
  const res = await pool.query(
    `SELECT u.id, u.email, u.doktor_neve
       FROM patients p
       JOIN users u
         ON u.id = p.kezeleoorvos_user_id
        AND u.active IS NOT FALSE
      WHERE p.id = $1
      LIMIT 1`,
    [patientId]
  );
  const r = res.rows[0];
  if (!r || !r.email) return null;
  return { userId: r.id, email: r.email, name: r.doktor_neve ?? null, role: KEZELOORVOS_ROLE };
}

/**
 * Kezelőorvos nélküli, hiányos beteg jelzése az adminoknak: a napi összegző
 * digestbe (`missing_data_no_owner`) + nyitott admin-feladatként, hogy a
 * vezetés kijelölhessen egy felelős kezelőorvost. Idempotens: betegenként és
 * adminonként legfeljebb egy nyitott no-owner feladat.
 */
async function flagNoOwner(
  pool: ReturnType<typeof getDbPool>,
  patientId: string,
  patientName: string | null,
  summary: string,
  result: MissingDataReminderResult
): Promise<void> {
  result.noOwner++;

  await queueAdminNotification(
    'missing_data_no_owner',
    `${patientName ?? 'Beteg'} — nincs kijelölt kezelőorvos (hiányzó adat: ${summary})`,
    { patientId, missing: summary }
  ).catch(() => {});

  const betegLabel = patientName?.trim() ? patientName.trim() : 'beteg';
  const admins = await resolveAdmins(pool);
  for (const admin of admins) {
    const existing = await pool.query(
      `SELECT 1 FROM user_tasks
        WHERE task_type = 'missing_data'
          AND status = 'open'
          AND patient_id = $1
          AND assignee_user_id = $2
          AND metadata->>'source' = 'missing_data_no_owner'
        LIMIT 1`,
      [patientId, admin.userId]
    );
    if (existing.rows.length > 0) continue;

    await insertUserTask({
      assigneeKind: 'staff',
      assigneeUserId: admin.userId,
      assigneePatientId: null,
      patientId,
      taskType: 'missing_data',
      title: `Kezelőorvos kijelölése szükséges – ${betegLabel}`,
      description: summary ? `Hiányos beteg felelős nélkül. Hiányzó adatok: ${summary}` : 'Hiányos beteg kijelölt kezelőorvos nélkül.',
      metadata: { source: 'missing_data_no_owner' },
      createdByUserId: admin.userId,
    });
    result.tasksCreated++;
  }
}

async function resolveReferrer(
  pool: ReturnType<typeof getDbPool>,
  patientId: string
): Promise<Recipient | null> {
  // Elsődlegesen a feloldott FK (megbízható); ha nincs, visszaesünk a
  // normalizált név-egyezésre (régi, FK nélküli rekordokra).
  const res = await pool.query(
    `SELECT u.id, u.email, u.doktor_neve
       FROM patient_referral pr
       JOIN users u
         ON u.role = $2
        AND u.active IS NOT FALSE
        AND (
          u.id = pr.beutalo_orvos_user_id
          OR (
            pr.beutalo_orvos_user_id IS NULL
            AND pr.beutalo_orvos IS NOT NULL
            AND btrim(pr.beutalo_orvos) <> ''
            AND lower(btrim(u.doktor_neve)) = lower(btrim(pr.beutalo_orvos))
          )
        )
      WHERE pr.patient_id = $1
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

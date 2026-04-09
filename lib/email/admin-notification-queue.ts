import { getDbPool } from '../db';
import { sendEmail } from './config';
import { formatDateForEmail, formatDateForEmailShort } from './templates';

interface NotificationRow {
  id: number;
  notification_type: string;
  summary_text: string;
  created_at: Date;
}

/** Batch summary email: section order (unknown types append at end). */
const NOTIFICATION_SUMMARY_DISPLAY_ORDER: string[] = [
  'register',
  'login',
  'impersonate',
  'impersonate_patient',
  'patient_created',
  'patient_updated',
  'patients_list_viewed',
  'patient_search',
  'patient_documents_listed',
  'patient_document_downloaded',
  'patient_stage_created',
  'appointment_approved',
  'appointment_rejected',
  'appointment_modified',
  'appointment_cancelled',
  'appointment_cancelled_by_patient',
  'conditional_appointment',
  'new_appointment_request',
  'time_slot_freed',
  'message_sent',
  'message_sent_impersonated',
  'doctor_message_sent',
  'doctor_group_message_sent',
  'ohip14_created',
  'ohip14_updated',
  'ohip14_reminder_sent',
  'communication_log_created',
  'patient_portal_registered',
  'patient_login',
  'patient_document_deleted',
  'password_change',
  'password_reset_requested',
  'password_reset_completed',
  'password_reset_failed',
];

const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  // Auth & user management
  login: 'Bejelentkezés',
  register: 'Új felhasználó regisztráció',
  password_change: 'Jelszó módosítás',
  password_reset_requested: 'Jelszó-visszaállítás kérés',
  password_reset_completed: 'Jelszó-visszaállítás végrehajtva',
  password_reset_failed: 'Jelszó-visszaállítás sikertelen',
  impersonate: 'Imperszonálás (admin)',
  impersonate_patient: 'Beteg imperszonálás',

  // Patient management
  patient_created: 'Új beteg regisztrálva',
  patient_updated: 'Beteg adatok módosítva',
  patients_list_viewed: 'Beteglista megtekintés',
  patient_search: 'Beteg keresés',
  patient_documents_listed: 'Beteg dokumentumlista megtekintés',
  patient_document_downloaded: 'Beteg dokumentum letöltve',
  patient_stage_created: 'Beteg stádium módosítás',
  patient_document_deleted: 'Dokumentum törölve',

  // Appointments
  appointment_approved: 'Időpont elfogadva (páciens)',
  appointment_rejected: 'Időpont elvetve (páciens)',
  appointment_modified: 'Időpont módosítva',
  appointment_cancelled: 'Időpont lemondva',
  appointment_cancelled_by_patient: 'Időpont lemondva (páciens)',
  conditional_appointment: 'Feltételes időpontfoglalás',
  new_appointment_request: 'Új időpont kérése',
  time_slot_freed: 'Időpont felszabadult',

  // Messages
  message_sent: 'Üzenet küldve (betegnek)',
  message_sent_impersonated: 'Üzenet küldve (imperszonálva)',
  doctor_message_sent: 'Orvos-orvos üzenet',
  doctor_group_message_sent: 'Csoportos orvos üzenet',

  // Patient portal
  patient_portal_registered: 'Új beteg regisztráció (páciens portál)',
  patient_login: 'Beteg bejelentkezés (páciens portál)',

  // Clinical
  ohip14_created: 'OHIP-14 kitöltve',
  ohip14_updated: 'OHIP-14 módosítva',
  ohip14_reminder_sent: 'OHIP-14 emlékeztető (páciensnek kiküldve)',
  communication_log_created: 'Érintkezési napló bejegyzés',
};

let queueSchemaReady: Promise<void> | null = null;

async function ensureAdminNotificationQueueSchema(): Promise<void> {
  if (!queueSchemaReady) {
    queueSchemaReady = (async () => {
      const pool = getDbPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_notification_queue (
          id SERIAL PRIMARY KEY,
          notification_type VARCHAR(50) NOT NULL,
          summary_text TEXT NOT NULL,
          detail_json JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          processed BOOLEAN NOT NULL DEFAULT FALSE,
          processed_at TIMESTAMPTZ
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_admin_notif_queue_unprocessed
          ON admin_notification_queue (processed, created_at)
          WHERE processed = FALSE
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_notification_batch_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          last_sent_at TIMESTAMPTZ
        )
      `);
      await pool.query(`
        INSERT INTO admin_notification_batch_state (id, last_sent_at)
        VALUES (1, NULL)
        ON CONFLICT (id) DO NOTHING
      `);
    })().catch((error) => {
      // Allow retry on next call if initialization fails once.
      queueSchemaReady = null;
      throw error;
    });
  }

  await queueSchemaReady;
}

function notificationTypeLabel(type: string): string {
  return NOTIFICATION_TYPE_LABELS[type] || type;
}

function escapeHtmlForEmail(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Aktív admin + opcionális SMTP_REPLY_TO — értesítésekhez (digest, BCC). */
export async function getAdminNotificationRecipients(): Promise<string[]> {
  const pool = getDbPool();
  const { rows: admins } = await pool.query<{ email: string }>(
    "SELECT email FROM users WHERE role = 'admin' AND active = true"
  );
  const fallbackRecipient = process.env.SMTP_REPLY_TO?.trim().toLowerCase();
  return Array.from(
    new Set(
      [
        ...admins.map((a) => a.email.trim().toLowerCase()).filter(Boolean),
        ...(fallbackRecipient ? [fallbackRecipient] : []),
      ]
    )
  );
}

function renderSingleAdminNotificationHtml(
  notificationType: string,
  summaryText: string,
  createdAt: Date
): string {
  const label = notificationTypeLabel(notificationType);
  const time = formatDateForEmailShort(createdAt);
  const safeSummary = escapeHtmlForEmail(summaryText);
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb; margin-bottom: 4px;">${escapeHtmlForEmail(label)}</h2>
      <p style="color: #6b7280; font-size: 14px; margin-top: 0;">${time}</p>
      <p>Kedves adminisztrátor,</p>
      <p style="color: #374151; font-size: 15px;">${safeSummary}</p>
      <p style="margin-top: 24px; color: #6b7280; font-size: 13px;">
        Ez egy automatikus értesítés. A részletekért kérjük, jelentkezzen be a rendszerbe.
      </p>
    </div>
  `;
}

function adminNotificationImmediateEnabled(): boolean {
  const v = process.env.ADMIN_NOTIFICATION_IMMEDIATE?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Minimális idő két összegyűjtő admin email között (óra). 0 = nincs szünet. */
function adminNotificationBatchIntervalHours(): number {
  const raw = process.env.ADMIN_NOTIFICATION_BATCH_INTERVAL_HOURS?.trim();
  if (raw === '' || raw === undefined) return 3;
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n) || n < 0) return 3;
  return n;
}

/**
 * Alapértelmezés: minden típus csak az összegyűjtő batch emailben megy ki (min. 3 óra, lásd ADMIN_NOTIFICATION_BATCH_INTERVAL_HOURS).
 * Azonnali per-típus küldés: ADMIN_NOTIFICATION_IMMEDIATE=true (minden) vagy ADMIN_NOTIFICATION_IMMEDIATE_EXTRA (vesszővel típusok).
 */
const DEFAULT_IMMEDIATE_NOTIFICATION_TYPES = new Set<string>();

function adminNotificationTypeSendsImmediately(notificationType: string): boolean {
  if (adminNotificationImmediateEnabled()) {
    return true;
  }
  const typeNorm = notificationType.trim().toLowerCase();
  if (DEFAULT_IMMEDIATE_NOTIFICATION_TYPES.has(typeNorm)) {
    return true;
  }
  const extra = process.env.ADMIN_NOTIFICATION_IMMEDIATE_EXTRA?.trim();
  if (!extra) {
    return false;
  }
  const extraSet = new Set(
    extra
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  return extraSet.has(typeNorm);
}

/**
 * Sorba írja az eseményt. Alapból csak batch (/api/admin/daily-summary, min. 3 óra); azonnali:
 * ADMIN_NOTIFICATION_IMMEDIATE vagy ADMIN_NOTIFICATION_IMMEDIATE_EXTRA.
 * Sikertelen azonnali küldésnél a sor marad feldolgozatlanul a batch számára.
 */
export async function queueAdminNotification(
  notificationType: string,
  summaryText: string,
  detailJson: Record<string, any> = {}
): Promise<void> {
  try {
    await ensureAdminNotificationQueueSchema();
    const pool = getDbPool();
    const { rows } = await pool.query<{ id: number; created_at: Date }>(
      `INSERT INTO admin_notification_queue (notification_type, summary_text, detail_json)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [notificationType, summaryText, JSON.stringify(detailJson)]
    );
    const row = rows[0];
    if (!row) {
      return;
    }

    if (!adminNotificationTypeSendsImmediately(notificationType)) {
      return;
    }

    const recipients = await getAdminNotificationRecipients();
    if (recipients.length === 0) {
      console.warn('[AdminNotifQueue] No admin recipients; notification left unprocessed for later batch.');
      return;
    }

    const label = notificationTypeLabel(notificationType);
    const html = renderSingleAdminNotificationHtml(
      notificationType,
      summaryText,
      new Date(row.created_at)
    );

    try {
      await sendEmail({
        to: recipients,
        subject: `${label} — Maxillofaciális Rehabilitáció`,
        html,
      });
      await pool.query(
        `UPDATE admin_notification_queue
         SET processed = TRUE, processed_at = NOW()
         WHERE id = $1`,
        [row.id]
      );
    } catch (sendErr) {
      console.error(
        '[AdminNotifQueue] Immediate email failed; row stays unprocessed for optional batch summary:',
        sendErr
      );
    }
  } catch (error) {
    console.error('[AdminNotifQueue] Failed to queue notification:', error);
  }
}

function renderNotificationGroup(type: string, items: NotificationRow[]): string {
  const label = notificationTypeLabel(type);
  const rows = items.map((item) => {
    const time = formatDateForEmailShort(new Date(item.created_at));
    const safeText = escapeHtmlForEmail(item.summary_text);
    return `<tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 13px; white-space: nowrap; vertical-align: top;">${time}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #374151; font-size: 14px;">${safeText}</td>
    </tr>`;
  }).join('');

  return `
    <div style="margin-bottom: 28px;">
      <h3 style="color: #1e40af; font-size: 16px; margin: 0 0 10px 0; padding-bottom: 6px; border-bottom: 2px solid #2563eb;">
        ${escapeHtmlForEmail(label)} <span style="color: #6b7280; font-weight: normal; font-size: 14px;">(${items.length})</span>
      </h3>
      <table style="width: 100%; border-collapse: collapse;">
        ${rows}
      </table>
    </div>
  `;
}

export type AdminDailySummaryResult = {
  sent: boolean;
  count: number;
  /** Üres sor, nincs címzett, sikeres küldés, vagy throttle — cron / manuális hívásnál diagnosztika */
  reason?: 'queue_empty' | 'no_recipients' | 'sent' | 'throttled';
};

export async function sendAdminDailySummary(
  options?: { bypassMinInterval?: boolean }
): Promise<AdminDailySummaryResult> {
  await ensureAdminNotificationQueueSchema();
  const pool = getDbPool();

  const { rows: notifications } = await pool.query<NotificationRow>(
    `SELECT id, notification_type, summary_text, created_at
     FROM admin_notification_queue
     WHERE processed = FALSE
     ORDER BY created_at ASC`
  );

  if (notifications.length === 0) {
    console.info('[DailySummary] No pending notifications (queue empty).');
    return { sent: false, count: 0, reason: 'queue_empty' };
  }

  const intervalH = adminNotificationBatchIntervalHours();
  if (!options?.bypassMinInterval && intervalH > 0) {
    const { rows: stateRows } = await pool.query<{ last_sent_at: Date | null }>(
      `SELECT last_sent_at FROM admin_notification_batch_state WHERE id = 1`
    );
    const lastSent = stateRows[0]?.last_sent_at;
    if (lastSent) {
      const minMs = intervalH * 60 * 60 * 1000;
      const elapsed = Date.now() - new Date(lastSent).getTime();
      if (elapsed < minMs) {
        console.info(
          `[DailySummary] Throttled (${intervalH}h interval): ${Math.round(elapsed / 60000)} min since last batch, pending ${notifications.length} items`
        );
        return { sent: false, count: notifications.length, reason: 'throttled' };
      }
    }
  }

  const recipients = await getAdminNotificationRecipients();

  if (recipients.length === 0) {
    console.warn('[DailySummary] No recipients (admin or SMTP_REPLY_TO), skipping.');
    return { sent: false, count: notifications.length, reason: 'no_recipients' };
  }

  const grouped: Record<string, NotificationRow[]> = {};
  for (const n of notifications) {
    if (!grouped[n.notification_type]) {
      grouped[n.notification_type] = [];
    }
    grouped[n.notification_type].push(n);
  }

  const sortedTypes = [
    ...NOTIFICATION_SUMMARY_DISPLAY_ORDER.filter((t) => grouped[t]),
    ...Object.keys(grouped).filter((t) => !NOTIFICATION_SUMMARY_DISPLAY_ORDER.includes(t)),
  ];

  const sectionsHtml = sortedTypes.map((type) => renderNotificationGroup(type, grouped[type])).join('');

  const oldest = new Date(notifications[0].created_at);
  const newest = new Date(notifications[notifications.length - 1].created_at);
  /** Fejléc: másodperces pontosság, hogy ugyanazon percen belüli események is megkülönböztethetők legyenek. */
  const periodText = `${formatDateForEmail(oldest)} – ${formatDateForEmail(newest)}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb; margin-bottom: 4px;">Összegyűjtött értesítések</h2>
      <p style="color: #6b7280; font-size: 14px; margin-top: 0;">
        <strong>Események ideje ebben a levélben</strong> (legrégebbi → legújabb sor a sorban):<br />
        ${periodText}
      </p>
      <p style="color: #64748b; font-size: 12px; margin-top: 6px; line-height: 1.45;">
        Ez <em>nem</em> a digest küldésének ütemezése, hanem annak az időnek a széle, amikor a most kiküldött események rögzítésre kerültek.
        Az összegyűjtő levél legfeljebb kb. minden ${intervalH} órában indulhat (cron + <code>ADMIN_NOTIFICATION_BATCH_INTERVAL_HOURS</code>).
      </p>
      <p style="color: #374151; font-size: 14px; background: #eff6ff; padding: 12px 14px; border-radius: 6px;">
        <strong>Megjegyzés:</strong> Az események típusonként vannak csoportosítva.
        Azonnali egyes típusok: <code>ADMIN_NOTIFICATION_IMMEDIATE</code> / <code>ADMIN_NOTIFICATION_IMMEDIATE_EXTRA</code>.
      </p>
      <p>Kedves adminisztrátor,</p>
      <p>Összesen <strong>${notifications.length}</strong> esemény szerepel ebben az összefoglalóban:</p>
      ${sectionsHtml}
      <p style="margin-top: 24px; color: #6b7280; font-size: 13px;">
        Ez egy automatikus összefoglaló. A részletekért kérjük, jelentkezzen be a rendszerbe.
      </p>
    </div>
  `;

  await sendEmail({
    to: recipients,
    subject: `Összegyűjtött értesítések (${notifications.length} esemény) — Maxillofaciális Rehabilitáció`,
    html,
  });

  await pool.query(`
    INSERT INTO admin_notification_batch_state (id, last_sent_at)
    VALUES (1, NOW())
    ON CONFLICT (id) DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at
  `);

  const ids = notifications.map((n) => n.id);
  await pool.query(
    `UPDATE admin_notification_queue
     SET processed = TRUE, processed_at = NOW()
     WHERE id = ANY($1)`,
    [ids]
  );

  return { sent: true, count: notifications.length, reason: 'sent' };
}

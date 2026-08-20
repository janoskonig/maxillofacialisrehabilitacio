import { getDbPool } from '../db';
import { sendEmail } from './config';
import { formatDateForEmail, formatDateForEmailShort, getBaseUrlForEmail } from './templates';
import {
  buildAdminDigestText,
  notificationTypeLabel,
  renderAdminDigestHtml,
  type DigestNotification,
} from './admin-digest-render';

type NotificationRow = DigestNotification;

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
    `SELECT id, notification_type, summary_text, created_at, detail_json
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

  const oldest = new Date(notifications[0].created_at);
  const newest = new Date(notifications[notifications.length - 1].created_at);
  /** Fejléc: a levélben szereplő események ideje (nem a küldés ütemezése). */
  const periodText = `${formatDateForEmail(oldest)} – ${formatDateForEmail(newest)}`;

  const html = renderAdminDigestHtml(notifications, {
    periodText,
    appUrl: getBaseUrlForEmail(),
  });
  const plainText = buildAdminDigestText(notifications, { periodText });

  await sendEmail({
    to: recipients,
    subject: `Aktivitás — ${notifications.length} esemény · Maxillofaciális Rehabilitáció`,
    html,
    text: plainText,
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

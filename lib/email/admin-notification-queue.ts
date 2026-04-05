import { getDbPool } from '../db';
import { sendEmail } from './config';
import { formatDateForEmail, formatDateForEmailShort } from './templates';

interface NotificationRow {
  id: number;
  notification_type: string;
  summary_text: string;
  detail_json: Record<string, any>;
  created_at: Date;
}

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
  patient_search: 'Beteg keresés',
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

async function getAdminNotificationRecipients(): Promise<string[]> {
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
  const label = NOTIFICATION_TYPE_LABELS[notificationType] || notificationType;
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

/**
 * Minden admin értesítésről azonnal email megy (nem napi összefoglalóban).
 * Ha az email küldése sikertelen, a sor feldolgozatlan marad — kézzel hívható
 * GET/POST /api/admin/daily-summary (összefoglaló) továbbra is kiküldi ezeket.
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

    const recipients = await getAdminNotificationRecipients();
    if (recipients.length === 0) {
      console.warn('[AdminNotifQueue] No admin recipients; notification left unprocessed for later batch.');
      return;
    }

    const label = NOTIFICATION_TYPE_LABELS[notificationType] || notificationType;
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
  const label = NOTIFICATION_TYPE_LABELS[type] || type;
  const rows = items.map((item) => {
    const time = formatDateForEmailShort(new Date(item.created_at));
    return `<tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 13px; white-space: nowrap; vertical-align: top;">${time}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #374151; font-size: 14px;">${item.summary_text}</td>
    </tr>`;
  }).join('');

  return `
    <div style="margin-bottom: 28px;">
      <h3 style="color: #1e40af; font-size: 16px; margin: 0 0 10px 0; padding-bottom: 6px; border-bottom: 2px solid #2563eb;">
        ${label} <span style="color: #6b7280; font-weight: normal; font-size: 14px;">(${items.length})</span>
      </h3>
      <table style="width: 100%; border-collapse: collapse;">
        ${rows}
      </table>
    </div>
  `;
}

export async function sendAdminDailySummary(): Promise<{ sent: boolean; count: number }> {
  await ensureAdminNotificationQueueSchema();
  const pool = getDbPool();

  const { rows: notifications } = await pool.query<NotificationRow>(
    `SELECT id, notification_type, summary_text, detail_json, created_at
     FROM admin_notification_queue
     WHERE processed = FALSE
     ORDER BY created_at ASC`
  );

  if (notifications.length === 0) {
    return { sent: false, count: 0 };
  }

  const recipients = await getAdminNotificationRecipients();

  if (recipients.length === 0) {
    console.warn('[DailySummary] No recipients (admin or SMTP_REPLY_TO), skipping.');
    return { sent: false, count: notifications.length };
  }

  const grouped: Record<string, NotificationRow[]> = {};
  for (const n of notifications) {
    if (!grouped[n.notification_type]) {
      grouped[n.notification_type] = [];
    }
    grouped[n.notification_type].push(n);
  }

  const displayOrder = [
    'register',
    'login',
    'impersonate',
    'impersonate_patient',
    'patient_created',
    'patient_updated',
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
    'communication_log_created',
    'patient_portal_registered',
    'patient_login',
    'patient_document_deleted',
    'password_change',
    'password_reset_requested',
    'password_reset_completed',
    'password_reset_failed',
  ];

  const sortedTypes = [
    ...displayOrder.filter((t) => grouped[t]),
    ...Object.keys(grouped).filter((t) => !displayOrder.includes(t)),
  ];

  const sectionsHtml = sortedTypes.map((type) => renderNotificationGroup(type, grouped[type])).join('');

  const oldest = new Date(notifications[0].created_at);
  const newest = new Date(notifications[notifications.length - 1].created_at);
  const periodText = `${formatDateForEmailShort(oldest)} – ${formatDateForEmailShort(newest)}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb; margin-bottom: 4px;">Napi összefoglaló (összegyűjtött események)</h2>
      <p style="color: #6b7280; font-size: 14px; margin-top: 0;">${periodText}</p>
      <p style="color: #374151; font-size: 14px; background: #eff6ff; padding: 12px 14px; border-radius: 6px;">
        <strong>Megjegyzés:</strong> Az új eseményekről ettől kezdve külön email érkezik. Ezt az összefoglalót csak a korábban sorba került,
        még kiküldetlen tételekre használjuk (pl. egyszeri lezárás vagy hálózati hiba után).
      </p>
      <p>Kedves adminisztrátor,</p>
      <p>Az elmúlt időszakban <strong>${notifications.length}</strong> esemény történt a rendszerben:</p>
      ${sectionsHtml}
      <p style="margin-top: 24px; color: #6b7280; font-size: 13px;">
        Ez egy automatikus összefoglaló. A részletekért kérjük, jelentkezzen be a rendszerbe.
      </p>
    </div>
  `;

  await sendEmail({
    to: recipients,
    subject: `Napi összefoglaló (${notifications.length} esemény) - Maxillofaciális Rehabilitáció`,
    html,
  });

  const ids = notifications.map((n) => n.id);
  await pool.query(
    `UPDATE admin_notification_queue
     SET processed = TRUE, processed_at = NOW()
     WHERE id = ANY($1)`,
    [ids]
  );

  return { sent: true, count: notifications.length };
}

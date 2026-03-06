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
  patient_created: 'Új beteg regisztrálva',
  appointment_booked: 'Új időpont foglalás',
  staff_registered: 'Új felhasználó regisztráció',
  patient_portal_registered: 'Új beteg regisztráció (páciens portál)',
  patient_login: 'Beteg bejelentkezés (páciens portál)',
  conditional_appointment: 'Feltételes időpontfoglalás',
  new_appointment_request: 'Új időpont kérése',
  time_slot_freed: 'Időpont felszabadult',
};

export async function queueAdminNotification(
  notificationType: string,
  summaryText: string,
  detailJson: Record<string, any> = {}
): Promise<void> {
  try {
    const pool = getDbPool();
    await pool.query(
      `INSERT INTO admin_notification_queue (notification_type, summary_text, detail_json)
       VALUES ($1, $2, $3)`,
      [notificationType, summaryText, JSON.stringify(detailJson)]
    );
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

  const { rows: admins } = await pool.query<{ email: string }>(
    "SELECT email FROM users WHERE role = 'admin' AND active = true"
  );

  if (admins.length === 0) {
    console.warn('[DailySummary] No active admins found, skipping.');
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
    'staff_registered',
    'patient_created',
    'appointment_booked',
    'conditional_appointment',
    'new_appointment_request',
    'time_slot_freed',
    'patient_portal_registered',
    'patient_login',
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
      <h2 style="color: #2563eb; margin-bottom: 4px;">Napi összefoglaló</h2>
      <p style="color: #6b7280; font-size: 14px; margin-top: 0;">${periodText}</p>
      <p>Kedves adminisztrátor,</p>
      <p>Az elmúlt időszakban <strong>${notifications.length}</strong> esemény történt a rendszerben:</p>
      ${sectionsHtml}
      <p style="margin-top: 24px; color: #6b7280; font-size: 13px;">
        Ez egy automatikus összefoglaló. A részletekért kérjük, jelentkezzen be a rendszerbe.
      </p>
    </div>
  `;

  const adminEmails = admins.map((a) => a.email);

  await sendEmail({
    to: adminEmails,
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

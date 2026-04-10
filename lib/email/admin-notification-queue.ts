import { getDbPool } from '../db';
import { sendEmail } from './config';
import { formatDateForEmail, formatDateForEmailShort } from './templates';

interface NotificationRow {
  id: number;
  notification_type: string;
  summary_text: string;
  created_at: Date;
  detail_json: Record<string, unknown>;
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

function parseDetailJson(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function strField(detail: Record<string, unknown>, key: string): string {
  const v = detail[key];
  return typeof v === 'string' ? v.trim() : '';
}

type DigestActorBucket = 'staff' | 'patient' | 'other';

/**
 * Digest-mátrix sorának kulcsa, címkéje és csoportja (staff vs páciens vs egyéb).
 */
function extractActorForDigest(detail: Record<string, unknown>): {
  key: string;
  display: string;
  bucket: DigestActorBucket;
} {
  const userEmail = strField(detail, 'userEmail');
  if (userEmail) {
    return { key: `u:${userEmail.toLowerCase()}`, display: userEmail, bucket: 'staff' };
  }

  const patientEmail = strField(detail, 'patientEmail');
  const patientName = strField(detail, 'patientName');
  if (patientEmail) {
    return {
      key: `p:${patientEmail.toLowerCase()}`,
      display: patientName ? `${patientName} (${patientEmail})` : patientEmail,
      bucket: 'patient',
    };
  }

  const emailTo = strField(detail, 'emailTo');
  if (emailTo) {
    return {
      key: `p:${emailTo.toLowerCase()}`,
      display: patientName ? `${patientName} (${emailTo})` : emailTo,
      bucket: 'patient',
    };
  }

  for (const k of ['deletedBy', 'createdBy'] as const) {
    const v = strField(detail, k);
    if (v && v.includes('@')) {
      return { key: `u:${v.toLowerCase()}`, display: v, bucket: 'staff' };
    }
  }

  if (patientName) {
    const norm = patientName.toLowerCase().replace(/\s+/g, ' ').trim();
    return {
      key: `pn:${norm}`,
      display: `Páciens: ${patientName}`,
      bucket: 'patient',
    };
  }

  return { key: '__other__', display: 'Egyéb / ismeretlen forrás', bucket: 'other' };
}

function sortActivityTypesPresent(types: Set<string>): string[] {
  const ordered = NOTIFICATION_SUMMARY_DISPLAY_ORDER.filter((t) => types.has(t));
  const rest = Array.from(types)
    .filter((t) => !NOTIFICATION_SUMMARY_DISPLAY_ORDER.includes(t))
    .sort();
  return [...ordered, ...rest];
}

type DigestMatrixCore = {
  actorKeys: string[];
  actorDisplay: Map<string, string>;
  types: string[];
  counts: Map<string, Map<string, number>>;
};

type SplitDigestResult = {
  staff: DigestMatrixCore;
  patient: DigestMatrixCore;
  otherSummaries: string[];
};

function bumpCount(
  counts: Map<string, Map<string, number>>,
  actorKey: string,
  notificationType: string
): void {
  if (!counts.has(actorKey)) {
    counts.set(actorKey, new Map());
  }
  const row = counts.get(actorKey)!;
  row.set(notificationType, (row.get(notificationType) ?? 0) + 1);
}

function finalizeDigestCore(
  counts: Map<string, Map<string, number>>,
  actorDisplay: Map<string, string>
): DigestMatrixCore {
  const types = new Set<string>();
  for (const row of Array.from(counts.values())) {
    for (const t of Array.from(row.keys())) {
      types.add(t);
    }
  }

  const actorTotals = new Map<string, number>();
  for (const [ak, row] of Array.from(counts.entries())) {
    let t = 0;
    for (const c of Array.from(row.values())) {
      t += c;
    }
    actorTotals.set(ak, t);
  }

  const actorKeys = Array.from(counts.keys()).sort((a, b) => {
    const tb = actorTotals.get(b) ?? 0;
    const ta = actorTotals.get(a) ?? 0;
    if (tb !== ta) return tb - ta;
    return (actorDisplay.get(a) ?? a).localeCompare(actorDisplay.get(b) ?? b, 'hu');
  });

  return {
    actorKeys,
    actorDisplay,
    types: sortActivityTypesPresent(types),
    counts,
  };
}

function buildSplitDigest(notifications: NotificationRow[]): SplitDigestResult {
  const staffCounts = new Map<string, Map<string, number>>();
  const patientCounts = new Map<string, Map<string, number>>();
  const staffDisplay = new Map<string, string>();
  const patientDisplay = new Map<string, string>();
  const otherSummaries: string[] = [];

  for (const n of notifications) {
    const detail = parseDetailJson(n.detail_json);
    const { key: actorKey, display, bucket } = extractActorForDigest(detail);

    if (bucket === 'other') {
      otherSummaries.push(n.summary_text);
      continue;
    }

    if (bucket === 'staff') {
      if (!staffDisplay.has(actorKey)) {
        staffDisplay.set(actorKey, display);
      }
      bumpCount(staffCounts, actorKey, n.notification_type);
    } else {
      if (!patientDisplay.has(actorKey)) {
        patientDisplay.set(actorKey, display);
      }
      bumpCount(patientCounts, actorKey, n.notification_type);
    }
  }

  return {
    staff: finalizeDigestCore(staffCounts, staffDisplay),
    patient: finalizeDigestCore(patientCounts, patientDisplay),
    otherSummaries,
  };
}

const DIGEST_TABLE_CELL =
  'padding:6px 8px;border:1px solid #e2e8f0;text-align:center;font-size:12px;color:#334155;';
const DIGEST_TABLE_HDR_STAFF =
  'padding:8px 6px;border:1px solid #cbd5e1;background:#1e40af;color:#fff;font-size:11px;font-weight:600;line-height:1.25;vertical-align:bottom;';
const DIGEST_TABLE_HDR_PATIENT =
  'padding:8px 6px;border:1px solid #5eead4;background:#0f766e;color:#fff;font-size:11px;font-weight:600;line-height:1.25;vertical-align:bottom;';
const DIGEST_TABLE_ROW_HDR =
  'padding:8px 10px;border:1px solid #e2e8f0;text-align:left;font-size:12px;color:#0f172a;max-width:220px;word-break:break-word;';

function renderDigestMatrixHtml(matrix: DigestMatrixCore, variant: 'staff' | 'patient'): string {
  const { actorKeys, actorDisplay, types, counts } = matrix;
  if (types.length === 0 || actorKeys.length === 0) {
    return '';
  }

  const hdr = variant === 'staff' ? DIGEST_TABLE_HDR_STAFF : DIGEST_TABLE_HDR_PATIENT;
  const title =
    variant === 'staff'
      ? 'Orvosi / rendszerfelhasználók aktivitása'
      : 'Páciensek aktivitása';
  const firstColLabel = variant === 'staff' ? 'Felhasználó' : 'Páciens';
  const blurb =
    variant === 'staff'
      ? 'Bejelentkezés, betegkezelés, üzenetek és egyéb orvosi/admin műveletek (email szerint).'
      : 'Portál, időpontválasz, OHIP-emlékeztető címzettje stb. (páciens-email vagy név szerint).';

  const headerCells = types
    .map(
      (t) =>
        `<th style="${hdr}">${escapeHtmlForEmail(notificationTypeLabel(t))}</th>`
    )
    .join('');
  const totalHdr = `<th style="${hdr}">Összesen</th>`;

  const bodyRows = actorKeys
    .map((ak) => {
      const row = counts.get(ak)!;
      let rowSum = 0;
      const cells = types
        .map((t) => {
          const n = row.get(t) ?? 0;
          rowSum += n;
          const inner =
            n === 0
              ? '<span style="color:#cbd5e1;">–</span>'
              : `<strong style="color:#0f172a;">${n}</strong>`;
          return `<td style="${DIGEST_TABLE_CELL}">${inner}</td>`;
        })
        .join('');
      const label = escapeHtmlForEmail(actorDisplay.get(ak) ?? ak);
      return `<tr>
        <td style="${DIGEST_TABLE_ROW_HDR}">${label}</td>
        ${cells}
        <td style="${DIGEST_TABLE_CELL}"><strong>${rowSum}</strong></td>
      </tr>`;
    })
    .join('');

  const colTotals = types.map((t) => {
    let s = 0;
    for (const ak of actorKeys) {
      s += counts.get(ak)?.get(t) ?? 0;
    }
    return `<td style="${DIGEST_TABLE_CELL}background:#f1f5f9;"><strong>${s}</strong></td>`;
  });
  const grandTotal = actorKeys.reduce((acc, ak) => {
    const row = counts.get(ak)!;
    let s = 0;
    for (const c of Array.from(row.values())) {
      s += c;
    }
    return acc + s;
  }, 0);

  const footerRow = `<tr>
    <td style="${DIGEST_TABLE_ROW_HDR}background:#f1f5f9;"><strong>Összesen</strong></td>
    ${colTotals.join('')}
    <td style="${DIGEST_TABLE_CELL}background:#e2e8f0;"><strong>${grandTotal}</strong></td>
  </tr>`;

  const titleColor = variant === 'staff' ? '#1e40af' : '#0f766e';
  return `
    <div style="margin: 20px 0;">
      <h3 style="color: ${titleColor}; font-size: 16px; margin: 0 0 10px 0;">${escapeHtmlForEmail(title)}</h3>
      <p style="color: #64748b; font-size: 12px; margin: 0 0 12px 0; line-height: 1.45;">
        ${escapeHtmlForEmail(blurb)} Oszlopok: eseménytípusok · Cellák: darabszám. Csak ebben a digestben előforduló típusok.
      </p>
      <div style="overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 0 -8px;">
        <table role="presentation" style="border-collapse: collapse; min-width: 100%; margin: 0 8px;">
          <thead>
            <tr>
              <th style="${hdr} text-align:left;">${escapeHtmlForEmail(firstColLabel)}</th>
              ${headerCells}
              ${totalHdr}
            </tr>
          </thead>
          <tbody>
            ${bodyRows}
            ${footerRow}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderOtherSummariesHtml(summaries: string[]): string {
  if (summaries.length === 0) return '';
  const items = summaries
    .map((s) => `<li style="margin: 4px 0; color: #374151; font-size: 13px;">${escapeHtmlForEmail(s)}</li>`)
    .join('');
  return `
    <div style="margin-bottom: 24px;">
      <h3 style="color: #1e40af; font-size: 15px; margin: 0 0 8px 0;">Nem sorolható események (részlet)</h3>
      <p style="color: #64748b; font-size: 12px; margin: 0 0 8px 0;">
        Az alábbiaknál nem volt egyértelmű felhasználói vagy páciens-azonosító a naplóban — ezek nem kerültek a táblázatokba.
      </p>
      <ul style="margin: 0; padding-left: 20px;">${items}</ul>
    </div>
  `;
}

function appendMatrixPlainText(
  lines: string[],
  sectionTitle: string,
  firstCol: string,
  matrix: DigestMatrixCore
): void {
  const { actorKeys, actorDisplay, types, counts } = matrix;
  if (types.length === 0 || actorKeys.length === 0) {
    return;
  }
  lines.push(sectionTitle, '');
  const header = [firstCol, ...types.map((t) => notificationTypeLabel(t)), 'Összesen'];
  lines.push(header.join('\t'));
  for (const ak of actorKeys) {
    const row = counts.get(ak)!;
    let sum = 0;
    const cells = types.map((t) => {
      const n = row.get(t) ?? 0;
      sum += n;
      return String(n);
    });
    lines.push([actorDisplay.get(ak) ?? ak, ...cells, String(sum)].join('\t'));
  }
  const colTotals = types.map((t) => {
    let s = 0;
    for (const ak of actorKeys) {
      s += counts.get(ak)?.get(t) ?? 0;
    }
    return String(s);
  });
  let sectionGrand = 0;
  for (const ak of actorKeys) {
    const row = counts.get(ak)!;
    for (const c of Array.from(row.values())) {
      sectionGrand += c;
    }
  }
  lines.push(['Összesen', ...colTotals, String(sectionGrand)].join('\t'), '');
}

function buildDigestPlainText(notifications: NotificationRow[], split: SplitDigestResult): string {
  const lines: string[] = [
    'Összegyűjtött értesítések — összesítő táblázatok (TSV: első oszlop + típusonkénti darabszám + sorösszeg)',
    '',
  ];

  appendMatrixPlainText(
    lines,
    '--- Orvosi / rendszerfelhasználók ---',
    'Felhasználó',
    split.staff
  );
  appendMatrixPlainText(
    lines,
    '--- Páciensek ---',
    'Páciens',
    split.patient
  );

  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  const grand = notifications.length;
  lines.push('', `Összes esemény a digestben: ${grand}`);

  if (split.otherSummaries.length > 0) {
    lines.push('', 'Nem sorolható események:');
    for (const s of split.otherSummaries) {
      lines.push(`- ${s}`);
    }
  }
  return lines.join('\n');
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

  const split = buildSplitDigest(notifications);
  const staffHtml = renderDigestMatrixHtml(split.staff, 'staff');
  const patientHtml = renderDigestMatrixHtml(split.patient, 'patient');
  const matrixParts = [staffHtml, patientHtml].filter(Boolean);
  const matrixHtml =
    matrixParts.length > 0
      ? matrixParts.join('')
      : '<p style="color:#64748b;font-size:14px;">Nincs megjeleníthető táblázatos összesítés (minden esemény „nem sorolható” kategóriába esett).</p>';
  const otherHtml = renderOtherSummariesHtml(split.otherSummaries);

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
        <strong>Megjegyzés:</strong> Az események két összesítő táblázatban jelennek meg: orvosi/rendszerfelhasználók és páciensek külön (szereplő × típus).
        Azonnali egyes típusok: <code>ADMIN_NOTIFICATION_IMMEDIATE</code> / <code>ADMIN_NOTIFICATION_IMMEDIATE_EXTRA</code>.
      </p>
      <p>Kedves adminisztrátor,</p>
      <p>Összesen <strong>${notifications.length}</strong> esemény szerepel ebben az összefoglalóban.</p>
      ${matrixHtml}
      ${otherHtml}
      <p style="margin-top: 24px; color: #6b7280; font-size: 13px;">
        Ez egy automatikus összefoglaló. A részletekért kérjük, jelentkezzen be a rendszerbe.
      </p>
    </div>
  `;

  const plainText = buildDigestPlainText(notifications, split);

  await sendEmail({
    to: recipients,
    subject: `Összegyűjtött értesítések (${notifications.length} esemény) — Maxillofaciális Rehabilitáció`,
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

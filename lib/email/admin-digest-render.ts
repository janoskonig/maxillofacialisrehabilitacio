/**
 * Admin aktivitás-digest ("Összegyűjtött értesítések") e-mail tartalma.
 *
 * Tiszta, DB-mentes modul: unit-tesztelhető és előnézetben renderelhető
 * (`npx tsx scripts/preview-admin-digest.ts`).
 *
 * Tervezési elvek (2026-08, mobil-olvashatóság):
 * - egyetlen oszlop, VÍZSZINTES GÖRGETÉS NÉLKÜL (a régi szereplő × típus mátrix
 *   két egymásra pakolt `overflow-x` táblázat volt, mobilon olvashatatlan),
 * - minimum 13px betűméret, tartalom 14-15px,
 * - előre a lényeg: kiemelt események → típus-összesítés → szereplők,
 *   a hosszú farok összecsukva ("+N további"),
 * - semmi env-változó / működés-magyarázat a levéltörzsben.
 */

export interface DigestNotification {
  id: number;
  notification_type: string;
  summary_text: string;
  created_at: Date;
  detail_json: Record<string, unknown>;
}

export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
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
  missing_data_reminder_sent: 'Hiányzó betegadat emlékeztető (kezelőorvosnak)',
  missing_data_escalated: 'Hiányzó betegadat eszkaláció (adminhoz)',
  missing_data_no_owner: 'Hiányos beteg kezelőorvos nélkül (admin teendő)',
};

/**
 * Ezek egyesével is érdekesek (biztonság, visszafordíthatatlan vagy beteget
 * érintő lépés) — a digest tetején tételesen listázzuk. A többi csak számként.
 */
const HIGHLIGHT_TYPES = new Set<string>([
  'register',
  'impersonate',
  'impersonate_patient',
  'password_reset_requested',
  'password_reset_completed',
  'password_reset_failed',
  'patient_document_deleted',
  'patient_created',
  'patient_portal_registered',
  'appointment_cancelled',
  'appointment_cancelled_by_patient',
  'appointment_rejected',
  'new_appointment_request',
  'conditional_appointment',
  'missing_data_escalated',
  'missing_data_no_owner',
]);

const HIGHLIGHT_LIMIT = 8;
const TYPE_LIMIT = 8;
const ACTOR_LIMIT = 8;
const ACTOR_TYPE_LIMIT = 4;
const OTHER_LIMIT = 5;
const SUMMARY_MAX_CHARS = 140;

const C = {
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  faint: '#94a3b8',
  line: '#e2e8f0',
  hair: '#f1f5f9',
  soft: '#f8fafc',
  blue: '#2563eb',
  teal: '#0f766e',
  amber: '#b45309',
  amberSoft: '#fffbeb',
  track: '#e8edf4',
};

export function notificationTypeLabel(type: string): string {
  return NOTIFICATION_TYPE_LABELS[type] || type;
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(text: string, max = SUMMARY_MAX_CHARS): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function timeOnly(date: Date): string {
  return new Intl.DateTimeFormat('hu-HU', {
    timeZone: 'Europe/Budapest',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
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

/** A digest-sor kulcsa, címkéje és csoportja (staff vs páciens vs egyéb). */
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
    return { key: `pn:${norm}`, display: `Páciens: ${patientName}`, bucket: 'patient' };
  }

  return { key: '__other__', display: 'Egyéb / ismeretlen forrás', bucket: 'other' };
}

type ActorSummary = {
  display: string;
  total: number;
  /** Típus-bontás darabszám szerint csökkenően. */
  types: Array<{ type: string; count: number }>;
};

export type DigestModel = {
  total: number;
  from: Date;
  to: Date;
  staff: ActorSummary[];
  patient: ActorSummary[];
  staffTotal: number;
  patientTotal: number;
  /** Típus-összesítés az egész digestre, darabszám szerint csökkenően. */
  typeTotals: Array<{ type: string; count: number }>;
  highlights: Array<{ type: string; summary: string; createdAt: Date }>;
  otherSummaries: string[];
};

function toActorSummaries(
  counts: Map<string, Map<string, number>>,
  display: Map<string, string>
): ActorSummary[] {
  const list: ActorSummary[] = [];
  for (const [key, row] of Array.from(counts.entries())) {
    const types = Array.from(row.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || notificationTypeLabel(a.type).localeCompare(notificationTypeLabel(b.type), 'hu'));
    const total = types.reduce((acc, t) => acc + t.count, 0);
    list.push({ display: display.get(key) ?? key, total, types });
  }
  return list.sort((a, b) => b.total - a.total || a.display.localeCompare(b.display, 'hu'));
}

export function buildDigestModel(notifications: DigestNotification[]): DigestModel {
  const staffCounts = new Map<string, Map<string, number>>();
  const patientCounts = new Map<string, Map<string, number>>();
  const staffDisplay = new Map<string, string>();
  const patientDisplay = new Map<string, string>();
  const typeCounts = new Map<string, number>();
  const otherSummaries: string[] = [];
  const highlights: DigestModel['highlights'] = [];

  const bump = (counts: Map<string, Map<string, number>>, key: string, type: string) => {
    if (!counts.has(key)) counts.set(key, new Map());
    const row = counts.get(key)!;
    row.set(type, (row.get(type) ?? 0) + 1);
  };

  for (const n of notifications) {
    const detail = parseDetailJson(n.detail_json);
    const { key, display, bucket } = extractActorForDigest(detail);

    typeCounts.set(n.notification_type, (typeCounts.get(n.notification_type) ?? 0) + 1);

    if (HIGHLIGHT_TYPES.has(n.notification_type)) {
      highlights.push({
        type: n.notification_type,
        summary: n.summary_text,
        createdAt: new Date(n.created_at),
      });
    }

    if (bucket === 'other') {
      // A kiemelt eseményeket fent már tételesen kiírjuk — ne ismétlődjenek itt.
      if (!HIGHLIGHT_TYPES.has(n.notification_type)) {
        otherSummaries.push(n.summary_text);
      }
      continue;
    }
    if (bucket === 'staff') {
      if (!staffDisplay.has(key)) staffDisplay.set(key, display);
      bump(staffCounts, key, n.notification_type);
    } else {
      if (!patientDisplay.has(key)) patientDisplay.set(key, display);
      bump(patientCounts, key, n.notification_type);
    }
  }

  const staff = toActorSummaries(staffCounts, staffDisplay);
  const patient = toActorSummaries(patientCounts, patientDisplay);

  return {
    total: notifications.length,
    from: new Date(notifications[0]?.created_at ?? Date.now()),
    to: new Date(notifications[notifications.length - 1]?.created_at ?? Date.now()),
    staff,
    patient,
    staffTotal: staff.reduce((a, s) => a + s.total, 0),
    patientTotal: patient.reduce((a, s) => a + s.total, 0),
    typeTotals: Array.from(typeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || notificationTypeLabel(a.type).localeCompare(notificationTypeLabel(b.type), 'hu')),
    highlights,
    otherSummaries,
  };
}

/* ------------------------------- HTML ---------------------------------- */

function sectionTitle(text: string, color: string, note?: string): string {
  return `
    <tr><td style="padding:22px 0 8px;">
      <div style="font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${color};">${esc(text)}</div>
      ${note ? `<div style="font-size:12px;color:${C.faint};padding-top:2px;line-height:1.4;">${esc(note)}</div>` : ''}
    </td></tr>`;
}

function moreRow(text: string): string {
  return `<tr><td style="padding:10px 0 0;font-size:13px;color:${C.faint};">${esc(text)}</td></tr>`;
}

function statCell(value: number, label: string, color: string): string {
  return `
    <td width="32%" style="background:${C.soft};border:1px solid ${C.line};border-radius:8px;padding:12px 6px;text-align:center;">
      <div style="font-size:22px;font-weight:700;line-height:1.1;color:${color};">${value}</div>
      <div style="font-size:12px;line-height:1.3;color:${C.muted};padding-top:3px;">${esc(label)}</div>
    </td>`;
}

function renderHighlights(model: DigestModel): string {
  if (model.highlights.length === 0) return '';
  const shown = model.highlights.slice(0, HIGHLIGHT_LIMIT);
  const rows = shown
    .map(
      (h) => `
      <tr><td style="padding:10px 12px;border-left:3px solid ${C.amber};background:${C.amberSoft};border-radius:0 6px 6px 0;">
        <div style="font-size:14px;font-weight:600;line-height:1.35;color:${C.ink};">${esc(notificationTypeLabel(h.type))}</div>
        <div style="font-size:13px;line-height:1.5;color:${C.body};padding-top:2px;word-break:break-word;">${esc(truncate(h.summary))}</div>
        <div style="font-size:12px;line-height:1.4;color:${C.faint};padding-top:2px;">${esc(timeOnly(h.createdAt))}</div>
      </td></tr>
      <tr><td style="height:6px;font-size:0;line-height:6px;">&nbsp;</td></tr>`
    )
    .join('');
  const rest = model.highlights.length - shown.length;
  return (
    sectionTitle('Kiemelt események', C.amber) +
    `<tr><td><table role="presentation" width="100%" style="width:100%;border-collapse:collapse;">${rows}</table></td></tr>` +
    (rest > 0 ? moreRow(`+ ${rest} további kiemelt esemény`) : '')
  );
}

function renderTypeTotals(model: DigestModel): string {
  if (model.typeTotals.length === 0) return '';
  const shown = model.typeTotals.slice(0, TYPE_LIMIT);
  const max = shown[0]?.count || 1;
  const rows = shown
    .map((t) => {
      const pct = Math.max(3, Math.round((t.count / max) * 100));
      return `
      <tr><td style="padding:7px 0 9px;">
        <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="font-size:14px;line-height:1.4;color:${C.body};word-break:break-word;">${esc(notificationTypeLabel(t.type))}</td>
            <td align="right" width="44" style="font-size:14px;font-weight:700;color:${C.ink};white-space:nowrap;">${t.count}</td>
          </tr>
          <tr><td colspan="2" style="padding-top:5px;">
            <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;table-layout:fixed;"><tr>
              <td width="${pct}%" style="background:${C.blue};font-size:0;line-height:4px;height:4px;border-radius:2px;">&nbsp;</td>
              <td style="background:${C.track};font-size:0;line-height:4px;height:4px;">&nbsp;</td>
            </tr></table>
          </td></tr>
        </table>
      </td></tr>`;
    })
    .join('');
  const restTypes = model.typeTotals.slice(TYPE_LIMIT);
  const restCount = restTypes.reduce((a, t) => a + t.count, 0);
  return (
    sectionTitle('Mi történt', C.blue) +
    `<tr><td><table role="presentation" width="100%" style="width:100%;border-collapse:collapse;">${rows}</table></td></tr>` +
    (restTypes.length > 0
      ? moreRow(`+ ${restTypes.length} további típus (${restCount} esemény)`)
      : '')
  );
}

function renderActorSection(
  actors: ActorSummary[],
  title: string,
  color: string,
  note: string
): string {
  if (actors.length === 0) return '';
  const shown = actors.slice(0, ACTOR_LIMIT);
  const rows = shown
    .map((a) => {
      const types = a.types.slice(0, ACTOR_TYPE_LIMIT);
      const restTypes = a.types.length - types.length;
      const breakdown = [
        ...types.map((t) => `${notificationTypeLabel(t.type)} ×${t.count}`),
        ...(restTypes > 0 ? [`+${restTypes} egyéb`] : []),
      ].join(' · ');
      return `
      <tr><td style="padding:11px 0;border-bottom:1px solid ${C.hair};">
        <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="font-size:15px;font-weight:600;line-height:1.35;color:${C.ink};word-break:break-word;">${esc(a.display)}</td>
            <td align="right" width="44" style="font-size:15px;font-weight:700;color:${color};white-space:nowrap;">${a.total}</td>
          </tr>
          <tr><td colspan="2" style="padding-top:3px;font-size:13px;line-height:1.55;color:${C.muted};word-break:break-word;">${esc(breakdown)}</td></tr>
        </table>
      </td></tr>`;
    })
    .join('');
  const rest = actors.slice(ACTOR_LIMIT);
  const restCount = rest.reduce((a, s) => a + s.total, 0);
  return (
    sectionTitle(title, color, note) +
    `<tr><td><table role="presentation" width="100%" style="width:100%;border-collapse:collapse;">${rows}</table></td></tr>` +
    (rest.length > 0 ? moreRow(`+ ${rest.length} további (${restCount} esemény)`) : '')
  );
}

function renderOther(model: DigestModel): string {
  if (model.otherSummaries.length === 0) return '';
  const shown = model.otherSummaries.slice(0, OTHER_LIMIT);
  const items = shown
    .map(
      (s) =>
        `<tr><td style="padding:6px 0;font-size:13px;line-height:1.5;color:${C.body};word-break:break-word;">• ${esc(truncate(s))}</td></tr>`
    )
    .join('');
  const rest = model.otherSummaries.length - shown.length;
  return (
    sectionTitle('Egyéb', C.muted, 'Nem volt egyértelmű felhasználó- vagy páciens-azonosító a naplóban.') +
    `<tr><td><table role="presentation" width="100%" style="width:100%;border-collapse:collapse;">${items}</table></td></tr>` +
    (rest > 0 ? moreRow(`+ ${rest} további esemény`) : '')
  );
}

export function renderAdminDigestHtml(
  notifications: DigestNotification[],
  opts: { periodText: string; appUrl?: string }
): string {
  const model = buildDigestModel(notifications);

  const stats = `
    <tr><td style="padding:4px 0 2px;">
      <table role="presentation" width="100%" style="width:100%;border-collapse:separate;border-spacing:0;">
        <tr>
          ${statCell(model.staff.length, 'munkatárs', C.blue)}
          <td width="2%" style="font-size:0;line-height:0;">&nbsp;</td>
          ${statCell(model.patient.length, 'páciens', C.teal)}
          <td width="2%" style="font-size:0;line-height:0;">&nbsp;</td>
          ${statCell(model.highlights.length, 'kiemelt', C.amber)}
        </tr>
      </table>
    </td></tr>`;

  const cta = opts.appUrl
    ? `<tr><td style="padding:24px 0 4px;">
         <a href="${esc(opts.appUrl)}" style="display:inline-block;background:${C.blue};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:11px 20px;border-radius:6px;">Megnyitás a rendszerben</a>
       </td></tr>`
    : '';

  return `
<table role="presentation" width="100%" style="width:100%;border-collapse:collapse;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;">
  <tr><td style="padding:0 0 2px;">
    <div style="font-size:20px;font-weight:700;line-height:1.3;color:${C.ink};">Aktivitás — ${model.total} esemény</div>
    <div style="font-size:13px;line-height:1.5;color:${C.muted};padding:4px 0 16px;">${esc(opts.periodText)}</div>
  </td></tr>
  ${stats}
  ${renderHighlights(model)}
  ${renderTypeTotals(model)}
  ${renderActorSection(model.staff, 'Munkatársak', C.blue, 'Orvosi és rendszerfelhasználók e-mail szerint.')}
  ${renderActorSection(model.patient, 'Páciensek', C.teal, 'Portál, időpontválasz, kiküldött emlékeztető címzettje.')}
  ${renderOther(model)}
  ${cta}
  <tr><td style="padding:20px 0 0;border-top:1px solid ${C.line};margin-top:12px;">
    <div style="font-size:12px;line-height:1.5;color:${C.faint};padding-top:16px;">Automatikus összefoglaló. A teljes napló a rendszerben érhető el.</div>
  </td></tr>
</table>`.trim();
}

/* ---------------------------- Plain text -------------------------------- */

function textActorSection(actors: ActorSummary[], title: string, lines: string[]): void {
  if (actors.length === 0) return;
  lines.push('', `${title.toUpperCase()} (${actors.length})`);
  for (const a of actors.slice(0, ACTOR_LIMIT)) {
    const types = a.types.slice(0, ACTOR_TYPE_LIMIT);
    const restTypes = a.types.length - types.length;
    const breakdown = [
      ...types.map((t) => `${notificationTypeLabel(t.type)} x${t.count}`),
      ...(restTypes > 0 ? [`+${restTypes} egyéb`] : []),
    ].join(', ');
    lines.push(`- ${a.display} — ${a.total} (${breakdown})`);
  }
  const rest = actors.slice(ACTOR_LIMIT);
  if (rest.length > 0) {
    const restCount = rest.reduce((acc, s) => acc + s.total, 0);
    lines.push(`  + ${rest.length} további (${restCount} esemény)`);
  }
}

export function buildAdminDigestText(
  notifications: DigestNotification[],
  opts: { periodText: string }
): string {
  const model = buildDigestModel(notifications);
  const lines: string[] = [
    `AKTIVITÁS — ${model.total} esemény`,
    opts.periodText,
  ];

  if (model.highlights.length > 0) {
    lines.push('', `KIEMELT ESEMÉNYEK (${model.highlights.length})`);
    for (const h of model.highlights.slice(0, HIGHLIGHT_LIMIT)) {
      lines.push(`- ${timeOnly(h.createdAt)} · ${notificationTypeLabel(h.type)} — ${truncate(h.summary)}`);
    }
    const rest = model.highlights.length - HIGHLIGHT_LIMIT;
    if (rest > 0) lines.push(`  + ${rest} további kiemelt esemény`);
  }

  if (model.typeTotals.length > 0) {
    lines.push('', 'MI TÖRTÉNT');
    for (const t of model.typeTotals.slice(0, TYPE_LIMIT)) {
      lines.push(`- ${notificationTypeLabel(t.type)}: ${t.count}`);
    }
    const restTypes = model.typeTotals.slice(TYPE_LIMIT);
    if (restTypes.length > 0) {
      const restCount = restTypes.reduce((a, t) => a + t.count, 0);
      lines.push(`  + ${restTypes.length} további típus (${restCount} esemény)`);
    }
  }

  textActorSection(model.staff, 'Munkatársak', lines);
  textActorSection(model.patient, 'Páciensek', lines);

  if (model.otherSummaries.length > 0) {
    lines.push('', `EGYÉB (${model.otherSummaries.length})`);
    for (const s of model.otherSummaries.slice(0, OTHER_LIMIT)) {
      lines.push(`- ${truncate(s)}`);
    }
    const rest = model.otherSummaries.length - OTHER_LIMIT;
    if (rest > 0) lines.push(`  + ${rest} további esemény`);
  }

  lines.push('', 'Automatikus összefoglaló. A teljes napló a rendszerben érhető el.');
  return lines.join('\n');
}

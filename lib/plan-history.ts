/**
 * WP-2.2 — A kezelési terv változásnaplója (plan-history).
 *
 * Az `episode_work_phase_audit` sorainak ember-olvasható, magyar
 * megjelenítése. A fordítás (change_type → magyar összefoglaló) EGY helyen él:
 * itt. A GET /api/episodes/:id/plan-history route ezen a modulon keresztül
 * építi a válasz `summary` mezőjét, a kliens (PlanHistoryLog) csak megjeleníti.
 *
 * Csak olvasás — visszavonás-művelet ebben az iterációban nincs.
 */

import type { WorkPhaseAuditChangeType } from './work-phase-audit';

/** A route SQL-jének sor-alakja (snake_case, ahogy a pg visszaadja). */
export interface PlanHistoryDbRow {
  id: string;
  created_at: string | Date;
  changed_by: string;
  /** users.doktor_neve, ha a changed_by feloldható (e-mail vagy uuid). */
  changed_by_name: string | null;
  change_type: string;
  old_status: string | null;
  new_status: string | null;
  work_phase_code: string | null;
  custom_label: string | null;
  /** work_phase_catalog.label_hu, ha a kód katalógusbeli. */
  catalog_label: string | null;
  reason: string | null;
}

/** A GET /plan-history válaszának egy bejegyzése (camelCase, kliensnek). */
export interface PlanHistoryEntry {
  id: string;
  createdAt: string;
  /**
   * Ember-olvasható név: users.doktor_neve, ha a changed_by feloldható;
   * különben a nyers changed_by (rendszer-azonosítók, pl. 'auto-repair (…)'
   * szándékosan nyersen maradnak).
   */
  changedBy: string;
  changeType: string;
  oldStatus: string | null;
  newStatus: string | null;
  workPhaseCode: string | null;
  /** custom_label → katalógus label_hu → work_phase_code; NULL az epizód-szintű soron. */
  phaseLabel: string | null;
  reason: string | null;
  /** Ember-olvasható magyar összefoglaló, pl. „elhagyta: Koronapróba". */
  summary: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'várakozik',
  scheduled: 'időpont foglalva',
  completed: 'kész',
  skipped: 'átugorva',
  deleted: 'törölve',
};

function statusLabel(status: string | null): string {
  if (!status) return '?';
  return STATUS_LABELS[status] ?? status;
}

/**
 * A státusz-váltás sorok finomabb magyarítása: a gyakori átmenetek saját
 * igét kapnak, a többi a nyers pár-formára esik vissza.
 */
function statusChangeSummary(
  phase: string,
  oldStatus: string | null,
  newStatus: string | null
): string {
  if (newStatus === 'completed') return `késznek jelölte: ${phase}`;
  if (newStatus === 'skipped') return `kihagyta: ${phase}`;
  if (oldStatus === 'skipped' && newStatus === 'pending') return `visszavette a tervbe: ${phase}`;
  if (oldStatus === 'completed' && newStatus === 'pending') return `újranyitotta: ${phase}`;
  if (newStatus === 'scheduled') return `időpontot kapott: ${phase}`;
  if (oldStatus === 'scheduled' && newStatus === 'pending')
    return `foglalása felszabadult: ${phase}`;
  return `állapota módosult: ${phase} (${statusLabel(oldStatus)} → ${statusLabel(newStatus)})`;
}

/**
 * Ember-olvasható magyar összefoglaló egy napló-sorhoz. A `reason` NEM része —
 * azt a megjelenítés külön (halkabban) fűzi a sor végére, hogy ne duplázza a
 * mondanivalót.
 */
export function formatPlanHistorySummary(input: {
  changeType: string;
  oldStatus: string | null;
  newStatus: string | null;
  phaseLabel: string | null;
}): string {
  const phase = input.phaseLabel ?? 'ismeretlen fázis';
  const changeType = input.changeType as WorkPhaseAuditChangeType;
  switch (changeType) {
    case 'create':
      return `hozzáadta: ${phase}`;
    case 'delete':
      return `elhagyta: ${phase}`;
    case 'reorder':
      // Epizód-szintű összefoglaló sor (episode_work_phase_id NULL) — a
      // mozgatott fázisok kódját a reason hordozza.
      return 'átrendezte a tervet';
    case 'merge':
      return `összevonta: ${phase}`;
    case 'unmerge':
      return `szétbontotta: ${phase}`;
    case 'timing_change':
      return `időzítését módosította: ${phase}`;
    case 'template_apply':
      return `sablon alkalmazva: ${phase}`;
    case 'template_remove':
      return `sablon eltávolítva: ${phase}`;
    case 'integrity_repair':
      return input.phaseLabel
        ? `automatikus javítás: ${phase}`
        : 'automatikus javítás';
    case 'status_change':
      return statusChangeSummary(phase, input.oldStatus, input.newStatus);
    default:
      // Ismeretlen (jövőbeli) change_type — a napló akkor is olvasható maradjon.
      return input.phaseLabel ? `módosította: ${phase}` : 'módosította a tervet';
  }
}

/** DB-sor → API-bejegyzés (név-feloldás + fázis-címke + összefoglaló). */
export function mapPlanHistoryRow(row: PlanHistoryDbRow): PlanHistoryEntry {
  const phaseLabel = row.custom_label ?? row.catalog_label ?? row.work_phase_code ?? null;
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  return {
    id: row.id,
    createdAt,
    changedBy: row.changed_by_name ?? row.changed_by,
    changeType: row.change_type,
    oldStatus: row.old_status,
    newStatus: row.new_status,
    workPhaseCode: row.work_phase_code,
    phaseLabel,
    reason: row.reason,
    summary: formatPlanHistorySummary({
      changeType: row.change_type,
      oldStatus: row.old_status,
      newStatus: row.new_status,
      phaseLabel,
    }),
  };
}

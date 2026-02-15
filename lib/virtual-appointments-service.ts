/**
 * Virtual appointments service: batch read from episode_next_step_cache.
 * Returns VirtualAppointment[] for date range overlap, deterministic sort, cap.
 * Used by: GET /api/scheduling/virtual-appointments, calendar API, GANTT API.
 */

import { createHash } from 'crypto';
import { getDbPool } from './db';
import type { VirtualAppointment, VirtualStatus } from './virtual-appointments-types';

const TIMEZONE = 'Europe/Budapest';
const DEFAULT_HORIZON_DAYS = 90;
const ITEM_CAP = 2000;

/** Step code → Hungarian label (fallback when pathway label unavailable) */
const STEP_LABELS: Record<string, string> = {
  consult_1: 'Első konzultáció',
  diagnostic: 'Diagnosztika',
  impression_1: 'Lenyomat 1',
  try_in_1: 'Próba 1',
  try_in_2: 'Próba 2',
  delivery: 'Átadás',
  control_6m: '6 hónapos kontroll',
  control_12m: '12 hónapos kontroll',
};

function getStepLabel(stepCode: string): string {
  return STEP_LABELS[stepCode] ?? stepCode;
}

/** Format Date to YYYY-MM-DD in Budapest timezone (date-only, no time) */
function toDateOnly(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: TIMEZONE }); // en-CA gives YYYY-MM-DD
}

/** Deterministic virtualKey per plan */
function computeVirtualKey(
  episodeId: string,
  stepCode: string,
  windowStartDate: string,
  windowEndDate: string,
  pool: string
): string {
  const input = `${episodeId}|${stepCode}|${windowStartDate}|${windowEndDate}|${pool}`;
  return createHash('sha1').update(input).digest('hex');
}

/** Build worklist deep link URL */
function buildWorklistUrl(episodeId: string, stepCode: string, pool: string): string {
  const params = new URLSearchParams();
  params.set('tab', 'worklist');
  params.set('episodeId', episodeId);
  params.set('stepCode', stepCode);
  params.set('pool', pool);
  return `/?${params.toString()}`;
}

export interface FetchVirtualAppointmentsParams {
  rangeStartDate: string; // YYYY-MM-DD
  rangeEndDate: string;   // YYYY-MM-DD
  providerId?: string;
  pool?: string;
  readyOnly?: boolean;
}

export interface FetchVirtualAppointmentsResult {
  items: VirtualAppointment[];
  meta: {
    itemsBeforeFilter: number;
    itemsAfterFilter: number;
    computeMs: number;
    dbMs: number;
    limitApplied?: number;
  };
}

/**
 * Batch fetch virtual appointments from episode_next_step_cache.
 * Overlap filter: windowEndDate >= rangeStartDate && windowStartDate <= rangeEndDate
 */
export async function fetchVirtualAppointments(
  params: FetchVirtualAppointmentsParams
): Promise<FetchVirtualAppointmentsResult> {
  const startCompute = Date.now();
  const pool = getDbPool();

  const conditions: string[] = [
    `enc.status = 'ready'`,
    `enc.window_start IS NOT NULL`,
    `enc.window_end IS NOT NULL`,
    `enc.step_code IS NOT NULL`,
  ];
  const queryParams: unknown[] = [params.rangeStartDate, params.rangeEndDate];
  let paramIdx = 3;

  if (params.providerId) {
    conditions.push(`enc.provider_id = $${paramIdx}::uuid`);
    queryParams.push(params.providerId);
    paramIdx++;
  }
  if (params.pool) {
    conditions.push(`enc.pool = $${paramIdx}`);
    queryParams.push(params.pool);
    paramIdx++;
  }

  const dbStart = Date.now();
  const result = await pool.query(
    `SELECT
       enc.episode_id as "episodeId",
       enc.provider_id as "providerId",
       enc.pool,
       enc.duration_minutes as "durationMinutes",
       enc.window_start as "windowStart",
       enc.window_end as "windowEnd",
       enc.step_code as "stepCode",
       enc.status,
       pe.patient_id as "patientId",
       p.nev as "patientName",
       u.doktor_neve as "providerName"
     FROM episode_next_step_cache enc
     JOIN patient_episodes pe ON pe.id = enc.episode_id
     JOIN patients p ON p.id = pe.patient_id
     LEFT JOIN users u ON u.id = enc.provider_id
     WHERE ${conditions.join(' AND ')}
       AND (enc.window_end AT TIME ZONE 'Europe/Budapest')::date >= $1::date
       AND (enc.window_start AT TIME ZONE 'Europe/Budapest')::date <= $2::date
     ORDER BY enc.window_start, enc.window_end, p.nev, enc.step_code, enc.episode_id`,
    queryParams
  );
  const dbMs = Date.now() - dbStart;

  const serverNow = new Date();
  const computedAtISO = serverNow.toISOString();
  const itemsBeforeFilter = result.rows.length;

  const items: VirtualAppointment[] = [];
  for (const row of result.rows) {
    const windowStart = row.windowStart as Date;
    const windowEnd = row.windowEnd as Date;
    const windowStartDate = toDateOnly(windowStart);
    const windowEndDate = toDateOnly(windowEnd);

    if (windowEndDate < windowStartDate) continue; // invalid range

    const virtualStatus: VirtualStatus = row.status === 'ready' ? 'READY' : 'BLOCKED';
    if (params.readyOnly && virtualStatus !== 'READY') continue;

    const episodeId = row.episodeId as string;
    const stepCode = row.stepCode as string;
    const poolVal = (row.pool as string) || 'work';

    const virtualKey = computeVirtualKey(episodeId, stepCode, windowStartDate, windowEndDate, poolVal);

    items.push({
      virtualKey,
      episodeId,
      patientId: row.patientId as string,
      patientName: (row.patientName as string) ?? 'Név nélküli',
      stepCode,
      stepLabel: getStepLabel(stepCode),
      pool: poolVal as 'work' | 'consult' | 'control',
      durationMinutes: (row.durationMinutes as number) ?? 30,
      windowStartDate,
      windowEndDate,
      assignedProviderId: row.providerId ?? null,
      assignedProviderName: row.providerName ?? null,
      virtualStatus,
      derivedFrom: 'wip_next_step',
      computedAtISO,
      serverNowISO: computedAtISO,
      worklistUrl: buildWorklistUrl(episodeId, stepCode, poolVal),
      worklistParams: { episodeId, stepCode, pool: poolVal },
    });

    if (items.length >= ITEM_CAP) break;
  }

  const computeMs = Date.now() - startCompute;

  return {
    items,
    meta: {
      itemsBeforeFilter,
      itemsAfterFilter: items.length,
      computeMs,
      dbMs,
      limitApplied: items.length >= ITEM_CAP ? ITEM_CAP : undefined,
    },
  };
}

export { DEFAULT_HORIZON_DAYS, ITEM_CAP, TIMEZONE };

import { z } from 'zod';
import { isValidBlockKey } from './episode-block-taxonomy';

export interface EpisodeObstacle {
  id: string;
  episodeId: string;
  key: string;
  active: boolean;
  waitingOn: string | null;
  waitingSince: string;
  expectedUnblockDate: string | null;
  expiresAt: string | null;
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface WaitingObstacle extends EpisodeObstacle {
  patientId: string;
  patientName: string;
  episodeTitle: string;
  assignedProviderId: string | null;
  assignedProviderName: string | null;
  currentStageLabel: string | null;
}

export function obstacleDate(date: Date | string = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest' })
    .format(typeof date === 'string' ? new Date(date) : date);
}

export function obstacleWaitingDays(since: string, now: string | Date = new Date()): number {
  return Math.max(0, Math.round((Date.parse(obstacleDate(now)) - Date.parse(obstacleDate(since))) / 86400000));
}

export function isActiveObstacle(block: EpisodeObstacle, now: Date = new Date()): boolean {
  return block.active && (!block.expiresAt || Date.parse(block.expiresAt) > now.getTime());
}

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Érvénytelen dátum')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Érvénytelen dátum');
const key = z.string().refine(isValidBlockKey, 'Ismeretlen akadálytípus');
const waitingOn = z.string().trim().min(1, 'Adja meg, pontosan kire vagy melyik intézményre várunk').max(250);
const note = z.string().trim().max(4000).optional();
const expectedDate = calendarDate.nullable().optional();

export const createObstacleSchema = z.object({
  key,
  waitingOn,
  waitingSince: calendarDate.optional(),
  expectedUnblockDate: expectedDate,
  note,
}).superRefine((data, ctx) => {
  const since = data.waitingSince ?? obstacleDate();
  if (since > obstacleDate()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['waitingSince'], message: 'A várakozás kezdete nem lehet jövőbeli' });
  if (data.expectedUnblockDate && data.expectedUnblockDate < since) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedUnblockDate'], message: 'A várt válasz dátuma nem előzheti meg a várakozás kezdetét' });
});

export const updateObstacleSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('resolve'), resolutionNote: note }),
  z.object({ action: z.literal('update'), key, waitingOn, expectedUnblockDate: expectedDate, note }),
]);

/** Shared by reads and RETURNING; keep waiting history independent of edits. */
export const OBSTACLE_COLUMNS = `id, episode_id as "episodeId", key, active,
  waiting_on as "waitingOn", waiting_since as "waitingSince",
  expected_unblock_date as "expectedUnblockDate", expires_at as "expiresAt",
  note, created_at as "createdAt", updated_at as "updatedAt", renewal_count as "renewalCount",
  resolved_at as "resolvedAt", resolution_note as "resolutionNote"`;

export interface ObstacleWaitlistRow {
  episodeId: string;
  patientId: string;
  patientName: string;
  episodeTitle: string;
  assignedProviderName: string | null;
  currentStageLabel: string | null;
  waitingSince: string;
  obstacles: WaitingObstacle[];
}

/** Filter matching obstacles first; keep each treatment as a single queue row. */
export function obstacleWaitlistRows(
  obstacles: WaitingObstacle[],
  filters: { search?: string; key?: string; providerId?: string; sort?: 'oldest' | 'name' | 'expected' } = {},
  now: Date = new Date()
): ObstacleWaitlistRow[] {
  const groups = new Map<string, ObstacleWaitlistRow>();
  const search = filters.search?.trim().toLocaleLowerCase('hu-HU') ?? '';
  for (const obstacle of obstacles) {
    if (!isActiveObstacle(obstacle, now)) continue;
    if (filters.key && obstacle.key !== filters.key) continue;
    if (filters.providerId && obstacle.assignedProviderId !== filters.providerId) continue;
    if (search && ![obstacle.patientName, obstacle.waitingOn, obstacle.note, obstacle.episodeTitle]
      .some((value) => value?.toLocaleLowerCase('hu-HU').includes(search))) continue;
    let row = groups.get(obstacle.episodeId);
    if (!row) {
      row = { ...obstacle, waitingSince: obstacle.waitingSince, obstacles: [] };
      groups.set(obstacle.episodeId, row);
    }
    row.obstacles.push(obstacle);
    if (obstacle.waitingSince < row.waitingSince) row.waitingSince = obstacle.waitingSince;
  }
  const deadline = (row: ObstacleWaitlistRow) => Math.min(...row.obstacles
    .map((block) => block.expectedUnblockDate ? Date.parse(block.expectedUnblockDate) : Infinity));
  return Array.from(groups.values()).sort((a, b) => {
    if (filters.sort === 'name') return a.patientName.localeCompare(b.patientName, 'hu') || a.episodeId.localeCompare(b.episodeId);
    if (filters.sort === 'expected') {
      const da = deadline(a), db = deadline(b);
      if (da !== db) return da - db;
    }
    return a.waitingSince.localeCompare(b.waitingSince) || a.patientName.localeCompare(b.patientName, 'hu') || a.episodeId.localeCompare(b.episodeId);
  });
}

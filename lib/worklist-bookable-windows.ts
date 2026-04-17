/**
 * „Ablak” oszlop: legkorábbi elérhető szabad slot láncolva (offset), pathway ablak végéig.
 * Tanácsadó — más foglalás elviheti a slotot a megjelenítés és a foglalás között.
 */

import type { Pool } from 'pg';
import type { WorklistItemBackend } from '@/lib/worklist-types';

async function queryEarliestFreeStart(
  pool: Pool,
  args: {
    poolType: string;
    lowerBound: Date;
    durationMinutes: number;
    providerId: string | null;
  }
): Promise<Date | null> {
  const params: unknown[] = [args.poolType, args.lowerBound.toISOString(), args.durationMinutes];
  let provClause = '';
  if (args.providerId) {
    params.push(args.providerId);
    provClause = ' AND ats.user_id = $4';
  }
  const r = await pool.query<{ t: Date | string }>(
    `SELECT ats.start_time AS t
     FROM available_time_slots ats
     WHERE ats.state = 'free'
       AND (ats.slot_purpose = $1 OR ats.slot_purpose IS NULL OR ats.slot_purpose = 'flexible')
       AND ats.start_time >= $2::timestamptz
       AND (ats.duration_minutes >= $3 OR ats.duration_minutes IS NULL)${provClause}
     ORDER BY ats.start_time ASC
     LIMIT 1`,
    params
  );
  const row = r.rows[0];
  if (!row?.t) return null;
  return row.t instanceof Date ? row.t : new Date(row.t as string);
}

/**
 * Kitölti `bookableWindowStart` / `bookableWindowEnd` ahol lehet (nincs még foglalás, nem kész/kihagyott sor).
 */
export async function enrichWorklistBookableWindows(
  pool: Pool,
  items: WorklistItemBackend[],
  serverNow: Date
): Promise<void> {
  const candidates = items.filter(
    (i) =>
      i.status !== 'blocked' &&
      i.stepStatus !== 'completed' &&
      i.stepStatus !== 'skipped' &&
      !i.bookedAppointmentStartTime &&
      i.windowStart &&
      i.windowEnd &&
      i.stepCode
  );
  if (candidates.length === 0) return;

  const episodeIds = Array.from(new Set(candidates.map((i) => i.episodeId)));
  const intentResult = await pool.query(
    `SELECT episode_id, step_code, step_seq, suggested_start
     FROM slot_intents
     WHERE episode_id = ANY($1) AND state = 'open'`,
    [episodeIds]
  );
  type IntentRow = { episode_id: string; step_code: string; step_seq: number; suggested_start: Date | string | null };
  const intentSuggested = new Map<string, Date>();
  for (const row of intentResult.rows as IntentRow[]) {
    const key = `${row.episode_id}:${row.step_seq}:${row.step_code}`;
    if (row.suggested_start) {
      intentSuggested.set(key, new Date(row.suggested_start));
    }
  }

  const byEpisode = new Map<string, WorklistItemBackend[]>();
  for (const it of candidates) {
    const arr = byEpisode.get(it.episodeId) ?? [];
    arr.push(it);
    byEpisode.set(it.episodeId, arr);
  }

  for (const [, group] of Array.from(byEpisode.entries())) {
    group.sort((a: WorklistItemBackend, b: WorklistItemBackend) => (a.stepSeq ?? 0) - (b.stepSeq ?? 0));
    let prevEarliest: Date | null = null;
    let prevSuggested: Date | null = null;

    for (const item of group) {
      const pathwayStart = new Date(item.windowStart!);
      const pathwayEnd = new Date(item.windowEnd!);
      const key = `${item.episodeId}:${item.stepSeq ?? 0}:${item.stepCode}`;
      const suggestedFromIntent = intentSuggested.get(key);
      const currSuggested = suggestedFromIntent ?? pathwayStart;

      const lowerParts = [serverNow.getTime(), pathwayStart.getTime(), currSuggested.getTime()];
      if (prevEarliest && prevSuggested) {
        const deltaMs = currSuggested.getTime() - prevSuggested.getTime();
        if (deltaMs >= 0) {
          lowerParts.push(prevEarliest.getTime() + deltaMs);
        }
      }
      const lowerBound = new Date(Math.max(...lowerParts));

      const t = await queryEarliestFreeStart(pool, {
        poolType: item.pool,
        lowerBound,
        durationMinutes: item.durationMinutes || 30,
        providerId: item.assignedProviderId ?? null,
      });
      if (!t) {
        prevSuggested = currSuggested;
        continue;
      }

      const endDisplay =
        pathwayEnd.getTime() >= t.getTime()
          ? pathwayEnd
          : new Date(t.getTime() + 14 * 24 * 60 * 60 * 1000);

      item.bookableWindowStart = t.toISOString();
      item.bookableWindowEnd = endDisplay.toISOString();

      prevEarliest = t;
      prevSuggested = currSuggested;
    }
  }
}

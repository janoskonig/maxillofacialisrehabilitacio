import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { fetchVirtualAppointments } from '@/lib/virtual-appointments-service';

const REASON_VALUES = ['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot'];

function toDateOnlyBudapest(s: string | Date | null): string | null {
  if (!s) return null;
  const d = typeof s === 'string' ? new Date(s) : s;
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
}

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  const reason = req.nextUrl.searchParams.get('reason');
  const patientId = req.nextUrl.searchParams.get('patientId');
  const cohortMode = !patientId;
  if (cohortMode && reason && !REASON_VALUES.includes(reason)) {
    return NextResponse.json(
      { error: 'reason érvényes értékű kell legyen (traumás sérülés | veleszületett rendellenesség | onkológiai kezelés utáni állapot)' },
      { status: 400 }
    );
  }

  const pool = getDbPool();
  const tableExists = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patient_episodes'`
  );
  if (tableExists.rows.length === 0) {
    return NextResponse.json({ episodes: [], intervals: [] });
  }

  const status = req.nextUrl.searchParams.get('status') || 'all';
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  const includeVirtual = req.nextUrl.searchParams.get('includeVirtual') === 'true';

  let episodeQuery = `
    SELECT e.id, e.patient_id as "patientId", p.nev as "patientName", e.reason, e.chief_complaint as "chiefComplaint",
           e.status, e.opened_at as "openedAt", e.closed_at as "closedAt"
    FROM patient_episodes e
    JOIN patients p ON p.id = e.patient_id
    WHERE 1=1
  `;
  const params: (string | number)[] = [];
  let paramIdx = 1;
  if (patientId) {
    episodeQuery += ` AND e.patient_id = $${paramIdx}::uuid`;
    params.push(patientId);
    paramIdx++;
  }
  if (reason && REASON_VALUES.includes(reason)) {
    episodeQuery += ` AND e.reason = $${paramIdx}`;
    params.push(reason);
    paramIdx++;
  }
  if (status !== 'all') {
    episodeQuery += ` AND e.status = $${paramIdx}`;
    params.push(status);
    paramIdx++;
  }
  if (from) {
    episodeQuery += ` AND e.opened_at >= $${paramIdx}::timestamptz`;
    params.push(from);
    paramIdx++;
  }
  if (to) {
    episodeQuery += ` AND (e.closed_at IS NULL OR e.closed_at <= $${paramIdx}::timestamptz)`;
    params.push(to);
  }
  episodeQuery += ` ORDER BY e.opened_at DESC LIMIT 200`;

  const episodesResult = await pool.query(episodeQuery, params);
  const episodeIds = episodesResult.rows.map((r: { id: string }) => r.id);

  const episodesList = episodesResult.rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    patientId: r.patientId,
    patientName: r.patientName,
    reason: r.reason,
    chiefComplaint: r.chiefComplaint,
    status: r.status,
    openedAt: (r.openedAt as Date)?.toISOString?.() ?? r.openedAt,
    closedAt: r.closedAt ? (r.closedAt as Date)?.toISOString?.() ?? r.closedAt : null,
  }));

  let intervals: { episodeId: string; stageCode: string; start: string; end: string }[] = [];
  let virtualWindows: Array<{
    episodeId: string;
    virtualKey: string;
    patientName: string;
    stepCode: string;
    stepLabel: string;
    pool: string;
    durationMinutes: number;
    windowStartDate: string;
    windowEndDate: string;
    worklistUrl: string;
    worklistParams: { episodeId: string; stepCode: string; pool: string };
  }> = [];

  if (episodeIds.length > 0) {
    const eventsResult = await pool.query(
      `SELECT id, episode_id as "episodeId", stage_code as "stageCode", at
       FROM stage_events
       WHERE episode_id = ANY($1::uuid[])
       ORDER BY episode_id, at ASC`,
      [episodeIds]
    );

    const eventsByEpisode = new Map<string, { stageCode: string; at: string }[]>();
    for (const row of eventsResult.rows) {
      const epId = row.episodeId as string;
      if (!eventsByEpisode.has(epId)) eventsByEpisode.set(epId, []);
      eventsByEpisode.get(epId)!.push({
        stageCode: row.stageCode as string,
        at: (row.at as Date)?.toISOString?.() ?? String(row.at),
      });
    }

    const now = new Date().toISOString();
    for (const epId of episodeIds) {
      const evs = eventsByEpisode.get(epId) || [];
      for (let i = 0; i < evs.length; i++) {
        const start = evs[i].at;
        const end = i < evs.length - 1 ? evs[i + 1].at : now;
        intervals.push({
          episodeId: epId,
          stageCode: evs[i].stageCode,
          start,
          end,
        });
      }
    }
  }

  if (includeVirtual) {
    const rangeStart =
      toDateOnlyBudapest(from) ??
      toDateOnlyBudapest(episodesList[0]?.openedAt as string) ??
      toDateOnlyBudapest(new Date());
    const rangeEnd =
      toDateOnlyBudapest(to) ??
      toDateOnlyBudapest(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000));
    if (rangeStart && rangeEnd && rangeEnd >= rangeStart) {
      const { items } = await fetchVirtualAppointments({
        rangeStartDate: rangeStart,
        rangeEndDate: rangeEnd,
        readyOnly: true,
      });
      virtualWindows = items
        .filter((v) => episodeIds.includes(v.episodeId))
        .map((v) => ({
          episodeId: v.episodeId,
          virtualKey: v.virtualKey,
          patientName: v.patientName,
          stepCode: v.stepCode,
          stepLabel: v.stepLabel,
          pool: v.pool,
          durationMinutes: v.durationMinutes,
          windowStartDate: v.windowStartDate,
          windowEndDate: v.windowEndDate,
          worklistUrl: v.worklistUrl,
          worklistParams: v.worklistParams,
        }));
    }
  }

  return NextResponse.json({
    episodes: episodesList,
    intervals,
    ...(includeVirtual && { virtualWindows }),
  });
});

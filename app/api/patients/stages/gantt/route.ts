import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

const REASON_VALUES = ['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot'];

/**
 * GANTT adatok: epizódok stádium intervallumokkal.
 * Cohort: reason kötelező. Betegszintű: reason opcionális, patientId kötelező.
 * GET /api/patients/stages/gantt?reason=...&patientId=...&status=open|closed|all&from=...&to=...
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const reason = request.nextUrl.searchParams.get('reason');
    const patientId = request.nextUrl.searchParams.get('patientId');
    const cohortMode = !patientId;
    if (cohortMode && (!reason || !REASON_VALUES.includes(reason))) {
      return NextResponse.json(
        { error: 'reason kötelező és érvényes értékű (traumás sérülés | veleszületett rendellenesség | onkológiai kezelés utáni állapot)' },
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

    const status = request.nextUrl.searchParams.get('status') || 'all';
    const from = request.nextUrl.searchParams.get('from');
    const to = request.nextUrl.searchParams.get('to');

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

    if (episodeIds.length === 0) {
      return NextResponse.json({ episodes: episodesList, intervals: [] });
    }

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
    const intervals: { episodeId: string; stageCode: string; start: string; end: string }[] = [];

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

    return NextResponse.json({
      episodes: episodesList,
      intervals,
    });
  } catch (error) {
    console.error('Error fetching GANTT data:', error);
    return NextResponse.json(
      { error: 'Hiba a GANTT adatok lekérdezésekor' },
      { status: 500 }
    );
  }
}

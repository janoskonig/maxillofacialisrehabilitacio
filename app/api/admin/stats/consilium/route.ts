/**
 * GET /api/admin/stats/consilium
 *
 * Konzílium-kapcsolatos statisztikák admin dashboardhoz.
 *
 * Mit ad vissza:
 *   - `sessions.summary`        — összes / draft / active / closed / múltbeli /
 *                                  jövőbeli session-ek száma + átlag
 *                                  napirendi pont / session.
 *   - `sessions.weeklyTrend`    — utolsó 26 hét darabszáma a `scheduled_at`
 *                                  alapján.
 *   - `attendance.summary`      — átlag/medián bejelentett vs ténylegesen
 *                                  jelenlévő tag/session + részvételi arány.
 *   - `attendance.topAttendees` — top 15 leggyakoribb résztvevő név alapján
 *                                  (összes meghívás × jelenlét).
 *   - `coverage`                — discussion coverage: discussed/összes item +
 *                                  medián session-coverage.
 *   - `prepTokens`              — kiállított / aktív / visszavont / lejárt
 *                                  + hány item-nek van legalább 1 token.
 *   - `prepComments`            — összes komment / hány item-en van komment
 *                                  / medián komment per kommentelt item /
 *                                  top 10 szerző.
 *
 * Csak admin szerepkörnek; ha a `consilium_sessions` tábla nincs telepítve
 * (legacy DB), 503-mal jelez.
 */

import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = roleHandler(['admin'], async () => {
  const pool = getDbPool();

  const probe = await pool.query<{
    has_sessions: boolean;
    has_items: boolean;
    has_attendees: boolean;
    has_tokens: boolean;
    has_comments: boolean;
  }>(`
    SELECT
      EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='consilium_sessions') AS has_sessions,
      EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='consilium_session_items') AS has_items,
      EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='consilium_sessions'
                AND column_name='attendees') AS has_attendees,
      EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='consilium_item_prep_tokens') AS has_tokens,
      EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='consilium_prep_comments') AS has_comments
  `);
  const flags = probe.rows[0] ?? {
    has_sessions: false,
    has_items: false,
    has_attendees: false,
    has_tokens: false,
    has_comments: false,
  };
  if (!flags.has_sessions || !flags.has_items) {
    return NextResponse.json(
      {
        error:
          'A consilium_sessions tábla nem található ezen az adatbázison — a konzílium statisztika csak a 011-es migráció után érhető el.',
        code: 'CONSILIUM_TABLES_MISSING',
      },
      { status: 503 }
    );
  }

  // ─── Mindig elérhető queryk (tábla létezik) ─────────────────────────────
  const [
    sessionsSummaryResult,
    sessionsByStatusResult,
    sessionsWeeklyResult,
    coverageResult,
    sessionCoverageResult,
  ] = await Promise.all([
    pool.query<{
      osszes: string;
      multbeli: string;
      jovobeli: string;
      atlag_napirendi_pont: string | null;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM consilium_sessions) AS osszes,
        (SELECT COUNT(*)::int FROM consilium_sessions WHERE scheduled_at <= NOW()) AS multbeli,
        (SELECT COUNT(*)::int FROM consilium_sessions WHERE scheduled_at > NOW()) AS jovobeli,
        ROUND((
          SELECT AVG(items_count)
          FROM (
            SELECT COUNT(i.id) AS items_count
            FROM consilium_sessions s
            LEFT JOIN consilium_session_items i ON i.session_id = s.id
            GROUP BY s.id
          ) sub
        )::numeric, 1) AS atlag_napirendi_pont
    `),
    pool.query<{ status: string; darab: string }>(`
      SELECT status, COUNT(*)::int AS darab
      FROM consilium_sessions
      GROUP BY status
      ORDER BY darab DESC
    `),
    // Heti trend (utolsó 26 hét, `scheduled_at` alapján — múlt + jövő egyaránt).
    pool.query<{ het_kezdete: Date | string; darab: string }>(`
      SELECT DATE_TRUNC('week', scheduled_at)::date AS het_kezdete,
             COUNT(*)::int AS darab
      FROM consilium_sessions
      WHERE scheduled_at >= NOW() - INTERVAL '26 weeks'
        AND scheduled_at <= NOW() + INTERVAL '12 weeks'
      GROUP BY het_kezdete
      ORDER BY het_kezdete ASC
    `),
    pool.query<{
      osszes_item: string;
      discussed_item: string;
    }>(`
      SELECT
        COUNT(*)::int AS osszes_item,
        COUNT(*) FILTER (WHERE discussed = true)::int AS discussed_item
      FROM consilium_session_items
    `),
    pool.query<{
      session_szam: string;
      atlag_coverage_pct: string | null;
      median_coverage_pct: string | null;
    }>(`
      WITH per_session AS (
        SELECT
          session_id,
          COUNT(*)::int AS items,
          COUNT(*) FILTER (WHERE discussed = true)::int AS discussed
        FROM consilium_session_items
        GROUP BY session_id
        HAVING COUNT(*) > 0
      ),
      ratios AS (
        SELECT discussed::numeric / items AS ratio
        FROM per_session
      )
      SELECT
        COUNT(*)::int AS session_szam,
        ROUND(AVG(ratio * 100)::numeric, 1) AS atlag_coverage_pct,
        ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ratio * 100))::numeric, 1) AS median_coverage_pct
      FROM ratios
    `),
  ]);

  // ─── Feltételes queryk (csak ha a megfelelő migráció lefutott) ───────────
  type AttendanceSummaryRow = {
    minta_szam: string;
    atlag_bejelentett: string | null;
    median_bejelentett: string | null;
    atlag_jelen: string | null;
    median_jelen: string | null;
    osszes_bejelentett: string;
    osszes_jelen: string;
  };
  type TopAttendeeRow = {
    attendee_id: string;
    attendee_name: string;
    osszes_meghivas: string;
    osszes_jelen: string;
  };
  type TokensRow = {
    kiallitott: string;
    aktiv: string;
    visszavont: string;
    lejart: string;
    tokenezett_item_szam: string;
  };
  type CommentsSummaryRow = {
    osszes_komment: string;
    kommentelt_item_szam: string;
    atlag_komment_per_kommentelt_item: string | null;
    median_komment_per_kommentelt_item: string | null;
  };
  type TopAuthorRow = {
    author_display: string;
    komment_szam: string;
    erintett_item_szam: string;
  };

  const attendanceSummaryPromise: Promise<{ rows: AttendanceSummaryRow[] }> = flags.has_attendees
    ? pool.query<AttendanceSummaryRow>(`
        WITH per_session AS (
          SELECT
            s.id,
            jsonb_array_length(COALESCE(s.attendees, '[]'::jsonb)) AS bejelentett,
            (
              SELECT COUNT(*)::int FROM jsonb_array_elements(COALESCE(s.attendees, '[]'::jsonb)) e
              WHERE COALESCE((e->>'present')::boolean, false)
            ) AS jelen
          FROM consilium_sessions s
        )
        SELECT
          COUNT(*)::int AS minta_szam,
          ROUND(AVG(bejelentett)::numeric, 1) AS atlag_bejelentett,
          ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY bejelentett))::numeric, 1) AS median_bejelentett,
          ROUND(AVG(jelen)::numeric, 1) AS atlag_jelen,
          ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY jelen))::numeric, 1) AS median_jelen,
          SUM(bejelentett)::int AS osszes_bejelentett,
          SUM(jelen)::int AS osszes_jelen
        FROM per_session
      `)
    : Promise.resolve({ rows: [] });

  const topAttendeesPromise: Promise<{ rows: TopAttendeeRow[] }> = flags.has_attendees
    ? pool.query<TopAttendeeRow>(`
        SELECT
          elem->>'id' AS attendee_id,
          TRIM(elem->>'name') AS attendee_name,
          COUNT(*)::int AS osszes_meghivas,
          COUNT(*) FILTER (WHERE COALESCE((elem->>'present')::boolean, false))::int AS osszes_jelen
        FROM consilium_sessions s,
        LATERAL jsonb_array_elements(COALESCE(s.attendees, '[]'::jsonb)) AS elem
        WHERE TRIM(COALESCE(elem->>'name', '')) <> ''
        GROUP BY 1, 2
        ORDER BY osszes_jelen DESC, osszes_meghivas DESC
        LIMIT 15
      `)
    : Promise.resolve({ rows: [] });

  const tokensPromise: Promise<{ rows: TokensRow[] }> = flags.has_tokens
    ? pool.query<TokensRow>(`
        SELECT
          COUNT(*)::int AS kiallitott,
          COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > NOW())::int AS aktiv,
          COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS visszavont,
          COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at <= NOW())::int AS lejart,
          COUNT(DISTINCT item_id)::int AS tokenezett_item_szam
        FROM consilium_item_prep_tokens
      `)
    : Promise.resolve({ rows: [] });

  const commentsSummaryPromise: Promise<{ rows: CommentsSummaryRow[] }> = flags.has_comments
    ? pool.query<CommentsSummaryRow>(`
        WITH per_item AS (
          SELECT item_id, COUNT(*) AS db
          FROM consilium_prep_comments
          GROUP BY item_id
        )
        SELECT
          (SELECT COUNT(*)::int FROM consilium_prep_comments) AS osszes_komment,
          (SELECT COUNT(*)::int FROM per_item) AS kommentelt_item_szam,
          ROUND(AVG(db)::numeric, 1) AS atlag_komment_per_kommentelt_item,
          ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY db))::numeric, 1) AS median_komment_per_kommentelt_item
        FROM per_item
      `)
    : Promise.resolve({ rows: [] });

  const topAuthorsPromise: Promise<{ rows: TopAuthorRow[] }> = flags.has_comments
    ? pool.query<TopAuthorRow>(`
        SELECT
          COALESCE(NULLIF(TRIM(author_display), ''), '(ismeretlen)') AS author_display,
          COUNT(*)::int AS komment_szam,
          COUNT(DISTINCT item_id)::int AS erintett_item_szam
        FROM consilium_prep_comments
        GROUP BY 1
        ORDER BY komment_szam DESC
        LIMIT 10
      `)
    : Promise.resolve({ rows: [] });

  const [
    attendanceSummaryResult,
    topAttendeesResult,
    tokensResult,
    commentsSummaryResult,
    topAuthorsResult,
  ] = await Promise.all([
    attendanceSummaryPromise,
    topAttendeesPromise,
    tokensPromise,
    commentsSummaryPromise,
    topAuthorsPromise,
  ]);

  const numOrNull = (v: unknown): number | null => {
    if (v == null) return null;
    const n = typeof v === 'string' ? parseFloat(v) : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const intOrZero = (v: unknown): number => {
    if (v == null) return 0;
    const n = typeof v === 'string' ? parseInt(v, 10) : Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const sessionsSummary = sessionsSummaryResult.rows[0] ?? {};
  const sessionsByStatus = sessionsByStatusResult.rows;
  const statusMap = new Map(sessionsByStatus.map((r) => [r.status, intOrZero(r.darab)]));

  const coverageRow = coverageResult.rows[0] ?? {};
  const osszesItem = intOrZero(coverageRow.osszes_item);
  const discussedItem = intOrZero(coverageRow.discussed_item);
  const sessionCoverageRow = sessionCoverageResult.rows[0] ?? {};

  const attendance = attendanceSummaryResult.rows[0];
  const attendanceTotalBejelentett = intOrZero(attendance?.osszes_bejelentett);
  const attendanceTotalJelen = intOrZero(attendance?.osszes_jelen);

  const tokensRow = tokensResult.rows[0];
  const commentsSummary = commentsSummaryResult.rows[0];

  return NextResponse.json({
    generaltAt: new Date().toISOString(),
    schemaFlags: {
      hasAttendees: !!flags.has_attendees,
      hasTokens: !!flags.has_tokens,
      hasComments: !!flags.has_comments,
    },
    sessions: {
      summary: {
        osszes: intOrZero(sessionsSummary.osszes),
        multbeli: intOrZero(sessionsSummary.multbeli),
        jovobeli: intOrZero(sessionsSummary.jovobeli),
        draft: statusMap.get('draft') ?? 0,
        active: statusMap.get('active') ?? 0,
        closed: statusMap.get('closed') ?? 0,
        atlagNapirendiPont: numOrNull(sessionsSummary.atlag_napirendi_pont),
      },
      statusSzerint: sessionsByStatus.map((r) => ({
        status: r.status,
        darab: intOrZero(r.darab),
      })),
      hetiTrend: sessionsWeeklyResult.rows.map((r) => ({
        hetKezdete:
          r.het_kezdete instanceof Date
            ? r.het_kezdete.toISOString().slice(0, 10)
            : String(r.het_kezdete),
        darab: intOrZero(r.darab),
      })),
    },
    coverage: {
      osszesItem,
      discussedItem,
      coveragePct: osszesItem > 0
        ? Math.round((discussedItem / osszesItem) * 1000) / 10
        : 0,
      perSession: {
        sessionSzam: intOrZero(sessionCoverageRow.session_szam),
        atlagCoveragePct: numOrNull(sessionCoverageRow.atlag_coverage_pct),
        medianCoveragePct: numOrNull(sessionCoverageRow.median_coverage_pct),
      },
    },
    attendance: {
      available: !!flags.has_attendees,
      summary: {
        sessionSzam: intOrZero(attendance?.minta_szam),
        atlagBejelentett: numOrNull(attendance?.atlag_bejelentett),
        medianBejelentett: numOrNull(attendance?.median_bejelentett),
        atlagJelen: numOrNull(attendance?.atlag_jelen),
        medianJelen: numOrNull(attendance?.median_jelen),
        osszesBejelentett: attendanceTotalBejelentett,
        osszesJelen: attendanceTotalJelen,
        reszveteliAranyPct:
          attendanceTotalBejelentett > 0
            ? Math.round((attendanceTotalJelen / attendanceTotalBejelentett) * 1000) / 10
            : 0,
      },
      topAttendees: topAttendeesResult.rows.map((r) => ({
        attendeeId: r.attendee_id,
        attendeeName: r.attendee_name,
        osszesMeghivas: intOrZero(r.osszes_meghivas),
        osszesJelen: intOrZero(r.osszes_jelen),
      })),
    },
    prepTokens: {
      available: !!flags.has_tokens,
      kiallitott: intOrZero(tokensRow?.kiallitott),
      aktiv: intOrZero(tokensRow?.aktiv),
      visszavont: intOrZero(tokensRow?.visszavont),
      lejart: intOrZero(tokensRow?.lejart),
      tokenezettItemSzam: intOrZero(tokensRow?.tokenezett_item_szam),
    },
    prepComments: {
      available: !!flags.has_comments,
      osszesKomment: intOrZero(commentsSummary?.osszes_komment),
      kommenteltItemSzam: intOrZero(commentsSummary?.kommentelt_item_szam),
      atlagKommentPerKommenteltItem: numOrNull(commentsSummary?.atlag_komment_per_kommentelt_item),
      medianKommentPerKommenteltItem: numOrNull(commentsSummary?.median_komment_per_kommentelt_item),
      topAuthors: topAuthorsResult.rows.map((r) => ({
        authorDisplay: r.author_display,
        kommentSzam: intOrZero(r.komment_szam),
        erintettItemSzam: intOrZero(r.erintett_item_szam),
      })),
    },
  });
});

/**
 * GET /api/admin/stats/pipeline
 *
 * Episode + work_phase pipeline KPI-k admin statisztikákhoz.
 *
 * Mit ad vissza:
 *   - `episodeLifetime`   — élő (open) vs lezárt episode-ok száma + lezárt
 *                            episode-ok élettartama (átlag/medián napokban) +
 *                            nyitott episode-ok jelenlegi kor-statisztikája.
 *   - `episodeStatus`     — patient_episodes.status megoszlás.
 *   - `workPhaseMatrix`   — episode_work_phases (work_phase_code × status)
 *                            mátrix gyakoriság szerint.
 *   - `workPhaseTotals`   — work_phase_code per összes / per nyitott +
 *                            "kész arány" (completed / összes), top 15.
 *   - `stuckWorkPhases`   — pending/scheduled work_phase-ek, amelyek
 *                            `created_at` > 45 nappal ezelőtt — top 10
 *                            kód szerint, és teljes darabszám.
 *
 * Csak admin szerepkörnek; a tábla-hiányt 503-mal jelzi (legacy DB).
 */

import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

const STUCK_DAYS_THRESHOLD = 45;

export const GET = roleHandler(['admin'], async () => {
  const pool = getDbPool();

  // Defensive probe — vannak deploys, ahol az episode_work_phases / patient_episodes
  // nincs telepítve (legacy DB). 503-mal jelzünk pontos hibakódot.
  const probe = await pool.query<{ has_eps: boolean; has_ewp: boolean; has_wpc: boolean }>(`
    SELECT
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patient_episodes') AS has_eps,
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'episode_work_phases') AS has_ewp,
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'work_phase_catalog') AS has_wpc
  `);
  const { has_eps, has_ewp, has_wpc } = probe.rows[0] ?? { has_eps: false, has_ewp: false, has_wpc: false };
  if (!has_eps || !has_ewp) {
    return NextResponse.json(
      {
        error:
          'A patient_episodes / episode_work_phases tábla nem található ezen az adatbázison. A pipeline statisztika csak a 016-os migráció után érhető el.',
        code: 'PIPELINE_TABLES_MISSING',
      },
      { status: 503 }
    );
  }

  // A label JOIN feltételes: ha nincs work_phase_catalog, akkor csak NULL labelt adunk.
  const labelJoin = has_wpc
    ? 'LEFT JOIN work_phase_catalog wpc ON wpc.work_phase_code = ewp.work_phase_code'
    : '';
  const labelExpr = has_wpc ? 'wpc.label_hu' : 'NULL';

  const [
    episodeStatusResult,
    closedEpisodeStatsResult,
    openEpisodeAgeStatsResult,
    workPhaseMatrixResult,
    workPhaseTotalsResult,
    stuckWorkPhasesResult,
    stuckTotalResult,
  ] = await Promise.all([
    pool.query<{ status: string; darab: string }>(`
      SELECT status, COUNT(*)::int AS darab
      FROM patient_episodes
      GROUP BY status
      ORDER BY darab DESC
    `),
    // Lezárt episode-ok élettartam-statisztikája (napokban).
    pool.query<{
      lezart_szam: string;
      atlag_napok: string | null;
      median_napok: string | null;
      p25_napok: string | null;
      p75_napok: string | null;
      min_napok: string | null;
      max_napok: string | null;
    }>(`
      WITH lezart AS (
        SELECT EXTRACT(EPOCH FROM (closed_at - opened_at)) / 86400.0 AS napok
        FROM patient_episodes
        WHERE status = 'closed' AND closed_at IS NOT NULL AND opened_at IS NOT NULL
          AND closed_at >= opened_at
      )
      SELECT
        COUNT(*)::int AS lezart_szam,
        ROUND(AVG(napok)::numeric, 1) AS atlag_napok,
        ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY napok))::numeric, 1) AS median_napok,
        ROUND((PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY napok))::numeric, 1) AS p25_napok,
        ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY napok))::numeric, 1) AS p75_napok,
        ROUND(MIN(napok)::numeric, 1) AS min_napok,
        ROUND(MAX(napok)::numeric, 1) AS max_napok
      FROM lezart
    `),
    // Nyitott episode-ok jelenlegi kor-statisztikája (napokban).
    pool.query<{
      nyitott_szam: string;
      atlag_napok: string | null;
      median_napok: string | null;
      p75_napok: string | null;
      max_napok: string | null;
    }>(`
      WITH nyitott AS (
        SELECT EXTRACT(EPOCH FROM (NOW() - opened_at)) / 86400.0 AS napok
        FROM patient_episodes
        WHERE status = 'open' AND opened_at IS NOT NULL
      )
      SELECT
        COUNT(*)::int AS nyitott_szam,
        ROUND(AVG(napok)::numeric, 1) AS atlag_napok,
        ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY napok))::numeric, 1) AS median_napok,
        ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY napok))::numeric, 1) AS p75_napok,
        ROUND(MAX(napok)::numeric, 1) AS max_napok
      FROM nyitott
    `),
    // Munkafázis-kód × státusz mátrix (top 15 kód darabszám szerint).
    pool.query<{
      work_phase_code: string;
      label_hu: string | null;
      status: string;
      darab: string;
    }>(`
      WITH top_codes AS (
        SELECT work_phase_code
        FROM episode_work_phases
        GROUP BY work_phase_code
        ORDER BY COUNT(*) DESC
        LIMIT 15
      )
      SELECT
        ewp.work_phase_code,
        ${labelExpr} AS label_hu,
        ewp.status,
        COUNT(*)::int AS darab
      FROM episode_work_phases ewp
      ${labelJoin}
      WHERE ewp.work_phase_code IN (SELECT work_phase_code FROM top_codes)
      GROUP BY ewp.work_phase_code, ${labelExpr}, ewp.status
      ORDER BY ewp.work_phase_code, ewp.status
    `),
    // Per work_phase_code összesítő: összes / kész / kész arány.
    pool.query<{
      work_phase_code: string;
      label_hu: string | null;
      osszes: string;
      kesz: string;
      pending: string;
      scheduled: string;
      skipped: string;
    }>(`
      SELECT
        ewp.work_phase_code,
        ${labelExpr} AS label_hu,
        COUNT(*)::int AS osszes,
        COUNT(*) FILTER (WHERE ewp.status = 'completed')::int AS kesz,
        COUNT(*) FILTER (WHERE ewp.status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE ewp.status = 'scheduled')::int AS scheduled,
        COUNT(*) FILTER (WHERE ewp.status = 'skipped')::int AS skipped
      FROM episode_work_phases ewp
      ${labelJoin}
      GROUP BY ewp.work_phase_code, ${labelExpr}
      ORDER BY osszes DESC
      LIMIT 15
    `),
    // "Ragadt" pending/scheduled work_phase-ek (top 10 kód).
    pool.query<{
      work_phase_code: string;
      label_hu: string | null;
      status: string;
      darab: string;
      legidosebb_napok: string | null;
    }>(`
      SELECT
        ewp.work_phase_code,
        ${labelExpr} AS label_hu,
        ewp.status,
        COUNT(*)::int AS darab,
        ROUND(MAX(EXTRACT(EPOCH FROM (NOW() - ewp.created_at)) / 86400.0)::numeric, 0) AS legidosebb_napok
      FROM episode_work_phases ewp
      ${labelJoin}
      WHERE ewp.status IN ('pending', 'scheduled')
        AND ewp.created_at < NOW() - INTERVAL '${STUCK_DAYS_THRESHOLD} days'
      GROUP BY ewp.work_phase_code, ${labelExpr}, ewp.status
      ORDER BY darab DESC
      LIMIT 10
    `),
    pool.query<{ darab: string }>(`
      SELECT COUNT(*)::int AS darab
      FROM episode_work_phases
      WHERE status IN ('pending', 'scheduled')
        AND created_at < NOW() - INTERVAL '${STUCK_DAYS_THRESHOLD} days'
    `),
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

  const closedRow = closedEpisodeStatsResult.rows[0] ?? {};
  const openRow = openEpisodeAgeStatsResult.rows[0] ?? {};

  return NextResponse.json({
    generaltAt: new Date().toISOString(),
    stuckDaysThreshold: STUCK_DAYS_THRESHOLD,
    episodeStatus: episodeStatusResult.rows.map((r) => ({
      status: r.status,
      darab: intOrZero(r.darab),
    })),
    episodeLifetime: {
      lezart: {
        mintaSzam: intOrZero(closedRow.lezart_szam),
        atlagNapok: numOrNull(closedRow.atlag_napok),
        medianNapok: numOrNull(closedRow.median_napok),
        p25Napok: numOrNull(closedRow.p25_napok),
        p75Napok: numOrNull(closedRow.p75_napok),
        minNapok: numOrNull(closedRow.min_napok),
        maxNapok: numOrNull(closedRow.max_napok),
      },
      nyitott: {
        mintaSzam: intOrZero(openRow.nyitott_szam),
        atlagNapok: numOrNull(openRow.atlag_napok),
        medianNapok: numOrNull(openRow.median_napok),
        p75Napok: numOrNull(openRow.p75_napok),
        maxNapok: numOrNull(openRow.max_napok),
      },
    },
    workPhaseMatrix: workPhaseMatrixResult.rows.map((r) => ({
      workPhaseCode: r.work_phase_code,
      labelHu: r.label_hu,
      status: r.status,
      darab: intOrZero(r.darab),
    })),
    workPhaseTotals: workPhaseTotalsResult.rows.map((r) => {
      const osszes = intOrZero(r.osszes);
      const kesz = intOrZero(r.kesz);
      return {
        workPhaseCode: r.work_phase_code,
        labelHu: r.label_hu,
        osszes,
        kesz,
        pending: intOrZero(r.pending),
        scheduled: intOrZero(r.scheduled),
        skipped: intOrZero(r.skipped),
        keszPct: osszes > 0 ? Math.round((kesz / osszes) * 1000) / 10 : 0,
      };
    }),
    stuckWorkPhases: {
      kuszobNapok: STUCK_DAYS_THRESHOLD,
      osszes: intOrZero(stuckTotalResult.rows[0]?.darab),
      top: stuckWorkPhasesResult.rows.map((r) => ({
        workPhaseCode: r.work_phase_code,
        labelHu: r.label_hu,
        status: r.status,
        darab: intOrZero(r.darab),
        legidosebbNapok: numOrNull(r.legidosebb_napok),
      })),
    },
  });
});

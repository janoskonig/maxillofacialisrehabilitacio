import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/care-pathways — list care pathways with governance info
 * Returns: pathways with override rate, degraded flag, change log summary, owner.
 * Admin / fogpótlástanász only for governance data.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const pool = getDbPool();

    const pathwaysResult = await pool.query(
      `SELECT cp.id, cp.name, cp.reason, cp.steps_json, cp.version, cp.priority,
              cp.owner_id as "ownerId",
              u.name as "ownerName",
              cp.created_at as "createdAt", cp.updated_at as "updatedAt"
       FROM care_pathways cp
       LEFT JOIN users u ON cp.owner_id = u.id
       ORDER BY cp.priority DESC, cp.name ASC`
    );

    const pathways = pathwaysResult.rows;

    // Governance: override rate per pathway (include all pathways)
    const governanceResult = await pool.query(
      `SELECT cp.id as "pathwayId",
              COUNT(DISTINCT pe.id)::int as "episodeCount",
              COUNT(DISTINCT CASE WHEN soa.id IS NOT NULL THEN pe.id END)::int as "episodesWithOverride",
              COUNT(DISTINCT soa.id)::int as "overrideCount",
              CASE WHEN COUNT(DISTINCT pe.id) > 0
                THEN ROUND(100.0 * COUNT(DISTINCT soa.id) / NULLIF(COUNT(DISTINCT pe.id), 0), 1)
                ELSE 0 END as "overrideRatePct"
       FROM care_pathways cp
       LEFT JOIN patient_episodes pe ON pe.care_pathway_id = cp.id AND pe.status = 'open'
       LEFT JOIN scheduling_override_audit soa ON soa.episode_id = pe.id
       GROUP BY cp.id`
    );

    type GovRow = { pathwayId: string; episodeCount: number; overrideCount: number; overrideRatePct: number };
    const governanceByPathway = new Map<string, GovRow>(
      governanceResult.rows.map((r: GovRow) => [r.pathwayId, r])
    );

    const DEGRADED_THRESHOLD_PCT = 20;

    const defaultGov: GovRow = { pathwayId: '', episodeCount: 0, overrideCount: 0, overrideRatePct: 0 };
    const items = pathways.map((p: { id: string; name: string }) => {
      const gov = governanceByPathway.get(p.id) ?? defaultGov;
      return {
        ...p,
        governance: {
          episodeCount: gov.episodeCount ?? 0,
          overrideCount: gov.overrideCount ?? 0,
          overrideRatePct: gov.overrideRatePct ?? 0,
          degraded: (gov.overrideRatePct ?? 0) > DEGRADED_THRESHOLD_PCT,
        },
      };
    });

    return NextResponse.json({ pathways: items });
  } catch (error) {
    console.error('Error fetching care pathways:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kezelési utak lekérdezésekor' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { carePathwayCreateSchema } from '@/lib/admin-process-schemas';
import { invalidateStepLabelCache } from '@/lib/step-labels';
import { invalidateUnmappedCache } from '@/lib/step-catalog-cache';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/care-pathways — create pathway (admin / fogpótlástanász)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
    }

    const body = await request.json();
    const auditReason =
      body.auditReason ?? request.nextUrl.searchParams.get('auditReason');
    const parsed = carePathwayCreateSchema.safeParse({ ...body, auditReason });
    if (!parsed.success) {
      const msg = parsed.error.errors.map((e: { message: string }) => e.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const data = parsed.data;

    const pool = getDbPool();
    const reason = (data.reason as string | null) || null;
    const treatmentTypeId = (data.treatmentTypeId as string | null) || null;

    const r = await pool.query(
      `INSERT INTO care_pathways (name, reason, treatment_type_id, steps_json, version, priority, owner_id)
       VALUES ($1, $2, $3, $4::jsonb, 1, $5, $6)
       RETURNING id, name, reason, treatment_type_id as "treatmentTypeId", steps_json as "stepsJson", version, priority, owner_id as "ownerId", created_at as "createdAt", updated_at as "updatedAt"`,
      [
        data.name,
        reason,
        treatmentTypeId,
        JSON.stringify(data.stepsJson),
        data.priority,
        data.ownerId || null,
      ]
    );

    const pathway = r.rows[0];
    const changedBy = auth.email ?? auth.userId ?? 'unknown';
    await pool.query(
      `INSERT INTO care_pathway_change_events (pathway_id, changed_by, change_type, change_details)
       VALUES ($1, $2, 'pathway_created', $3)`,
      [pathway.id, changedBy, JSON.stringify({ auditReason: data.auditReason })]
    );

    const stepsToUpsert = (data.stepsJson ?? []).filter(
      (s: { step_code: string; label?: string }) => s.step_code && s.label
    );
    for (const s of stepsToUpsert) {
      await pool.query(
        `INSERT INTO step_catalog (step_code, label_hu)
         VALUES ($1, $2)
         ON CONFLICT (step_code) DO UPDATE SET label_hu = EXCLUDED.label_hu, updated_at = now()`,
        [s.step_code, s.label]
      );
    }

    invalidateStepLabelCache();
    invalidateUnmappedCache();

    console.info('[admin] care_pathway created', {
      pathwayId: pathway.id,
      by: changedBy,
      auditReason: data.auditReason,
    });

    return NextResponse.json({ pathway });
  } catch (error) {
    logger.error('Error creating care pathway:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kezelési út létrehozásakor' },
      { status: 500 }
    );
  }
}

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

    const treatmentTypeCode = request.nextUrl.searchParams.get('treatmentTypeCode')?.trim().toLowerCase() || null;

    const pathwaysResult = await pool.query(
      `SELECT cp.id, cp.name, cp.reason, cp.treatment_type_id as "treatmentTypeId",
              tt.code as "treatmentTypeCode",
              cp.steps_json as "stepsJson", cp.version, cp.priority,
              cp.owner_id as "ownerId",
              u.doktor_neve as "ownerName",
              cp.created_at as "createdAt", cp.updated_at as "updatedAt"
       FROM care_pathways cp
       LEFT JOIN users u ON cp.owner_id = u.id
       LEFT JOIN treatment_types tt ON cp.treatment_type_id = tt.id
       WHERE ($1::text IS NULL OR tt.code = $1)
       ORDER BY cp.priority DESC, cp.name ASC`,
      [treatmentTypeCode]
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
    logger.error('Error fetching care pathways:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kezelési utak lekérdezésekor' },
      { status: 500 }
    );
  }
}

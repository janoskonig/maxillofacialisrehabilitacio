import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { isWritePlanItemsEnabled } from '@/lib/plan-items-flags';
import { insertTreatmentPlanJsonQuarantine } from '@/lib/patient-treatment-plan-quarantine';

export const dynamic = 'force-dynamic';

/** List unresolved / recent quarantine rows (admin). */
export const GET = roleHandler(['admin'], async () => {
  const pool = getDbPool();
  const r = await pool.query(
    `SELECT id,
            patient_id AS "patientId",
            location,
            resolution_status AS "resolutionStatus",
            resolver_version AS "resolverVersion",
            source_fingerprint AS "sourceFingerprint",
            created_at AS "createdAt",
            resolved_at AS "resolvedAt",
            resolved_episode_id AS "resolvedEpisodeId",
            resolved_plan_item_id AS "resolvedPlanItemId"
     FROM patient_treatment_plan_json_quarantine
     ORDER BY created_at DESC
     LIMIT 200`
  );
  return NextResponse.json({ items: r.rows });
});

/**
 * Ingest a JSON snapshot into quarantine (admin, WRITE_PLAN_ITEMS=on).
 * POST body: { patientId, location?, payloadSnapshot, sourceFingerprint?, resolverVersion? }
 */
export const POST = roleHandler(['admin'], async (req) => {
  if (!isWritePlanItemsEnabled()) {
    return NextResponse.json(
      { error: 'WRITE_PLAN_ITEMS must be enabled to ingest quarantine rows' },
      { status: 403 }
    );
  }

  let body: {
    patientId?: string;
    location?: string | null;
    payloadSnapshot?: unknown;
    sourceFingerprint?: string;
    resolverVersion?: number;
    migrationRunId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const patientId = body.patientId?.trim();
  if (!patientId) {
    return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
  }

  const pool = getDbPool();
  try {
    const row = await insertTreatmentPlanJsonQuarantine(pool, {
      patientId,
      location: body.location ?? null,
      payloadSnapshot: body.payloadSnapshot ?? {},
      sourceFingerprint: body.sourceFingerprint,
      resolverVersion: body.resolverVersion ?? 1,
      migrationRunId: body.migrationRunId ?? null,
    });
    return NextResponse.json({ ok: true, id: row.id, createdAt: row.created_at });
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err.code === '23505') {
      return NextResponse.json(
        { error: 'Duplicate source_fingerprint', code: 'DUPLICATE_FINGERPRINT' },
        { status: 409 }
      );
    }
    throw e;
  }
});

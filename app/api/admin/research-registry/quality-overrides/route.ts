import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { applyQualityManualOverride } from '@/lib/research-registry/quality-override';
import type { QualityState } from '@/lib/research-registry/quality-state';

export const dynamic = 'force-dynamic';

/** GET — recent manual overrides for an entity */
export const GET = roleHandler(['admin'], async (req) => {
  const entityType = req.nextUrl.searchParams.get('entity_type');
  const entityId = req.nextUrl.searchParams.get('entity_id');
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10) || 20)
  );

  if (!entityType || !entityId) {
    return NextResponse.json(
      { error: 'entity_type and entity_id query params required' },
      { status: 400 }
    );
  }

  const pool = getDbPool();
  const r = await pool.query(
    `SELECT id, entity_type, entity_id, override_reason, override_actor,
            override_expiry, previous_state, new_state, created_at
     FROM quality_manual_overrides
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [entityType, entityId, limit]
  );

  return NextResponse.json({ overrides: r.rows });
});

/** POST — apply manual quality state override */
export const POST = roleHandler(['admin'], async (req, { auth }) => {
  const body = (await req.json()) as {
    entityType?: string;
    entityId?: string;
    newState?: QualityState;
    overrideReason?: string;
    overrideExpiry?: string | null;
  };

  const entityType = body.entityType?.trim();
  const entityId = body.entityId?.trim();
  const newState = body.newState;
  const overrideReason = body.overrideReason?.trim();

  if (!entityType || !entityId || !newState || !overrideReason) {
    return NextResponse.json(
      { error: 'entityType, entityId, newState, and overrideReason are required' },
      { status: 400 }
    );
  }

  try {
    const result = await applyQualityManualOverride({
      entityType,
      entityId,
      newState,
      overrideReason,
      overrideActor: auth.email,
      overrideExpiry: body.overrideExpiry ?? null,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Override failed';
    const status = message.includes('Invalid quality') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
});

import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import type { IntakeStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VALID_INTAKE_TRANSITIONS: Record<string, string[]> = {
  'JUST_REGISTERED': ['NEEDS_TRIAGE'],
  'NEEDS_TRIAGE': ['TRIAGED'],
  'TRIAGED': ['IN_CARE'],
  'IN_CARE': [],
};

/**
 * GET /api/patients/:id/intake-items — list intake items
 * POST /api/patients/:id/intake-items — create/update intake item
 * PATCH /api/patients/:id/intake-items — update intake_status (FSM transition)
 */
export const GET = authedHandler(async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;

  const [itemsResult, statusResult] = await Promise.all([
    pool.query(
      `SELECT id, patient_id as "patientId", kind, status, source,
        created_at as "createdAt", completed_at as "completedAt",
        created_by as "createdBy", notes
       FROM patient_intake_items WHERE patient_id = $1
       ORDER BY created_at DESC`,
      [patientId]
    ),
    pool.query(
      `SELECT intake_status as "intakeStatus" FROM patients WHERE id = $1`,
      [patientId]
    ),
  ]);

  const items = itemsResult.rows.map((row) => ({
    id: row.id,
    patientId: row.patientId,
    kind: row.kind,
    status: row.status,
    source: row.source,
    createdAt: (row.createdAt as Date)?.toISOString?.() ?? null,
    completedAt: (row.completedAt as Date)?.toISOString?.() ?? null,
    createdBy: row.createdBy,
    notes: row.notes,
  }));

  return NextResponse.json({
    items,
    intakeStatus: statusResult.rows[0]?.intakeStatus ?? 'JUST_REGISTERED',
  });
});

export const POST = authedHandler(async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;
  const body = await req.json();

  const kind = (body.kind as string)?.trim?.();
  const source = (body.source as string)?.trim?.() || null;
  const notes = (body.notes as string)?.trim?.() || null;

  if (!kind) {
    return NextResponse.json({ error: 'kind kötelező' }, { status: 400 });
  }

  const patientCheck = await pool.query('SELECT id FROM patients WHERE id = $1', [patientId]);
  if (patientCheck.rows.length === 0) {
    return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
  }

  const result = await pool.query(
    `INSERT INTO patient_intake_items (patient_id, kind, status, source, created_by, notes)
     VALUES ($1, $2, 'OPEN', $3, $4, $5)
     ON CONFLICT (patient_id, kind) WHERE status = 'OPEN' DO NOTHING
     RETURNING id, patient_id as "patientId", kind, status, source,
       created_at as "createdAt", created_by as "createdBy", notes`,
    [patientId, kind, source, auth.email, notes]
  );

  if (result.rows.length === 0) {
    return NextResponse.json(
      { error: 'Már létezik nyitott tétel ezzel a kind-dal' },
      { status: 409 }
    );
  }

  const row = result.rows[0];
  return NextResponse.json({
    item: {
      id: row.id,
      patientId: row.patientId,
      kind: row.kind,
      status: row.status,
      source: row.source,
      createdAt: (row.createdAt as Date)?.toISOString?.() ?? null,
      createdBy: row.createdBy,
      notes: row.notes,
    },
  }, { status: 201 });
});

export const PATCH = authedHandler(async (req, { auth, params }) => {
  const pool = getDbPool();
  const patientId = params.id;
  const body = await req.json();

  const targetStatus = body.intakeStatus as IntakeStatus;
  const isAdminOverride = body.adminOverride === true;
  const reason = (body.reason as string)?.trim?.() || null;

  if (!targetStatus) {
    return NextResponse.json({ error: 'intakeStatus kötelező' }, { status: 400 });
  }

  const validStatuses = ['JUST_REGISTERED', 'NEEDS_TRIAGE', 'TRIAGED', 'IN_CARE'];
  if (!validStatuses.includes(targetStatus)) {
    return NextResponse.json({ error: 'Érvénytelen intake_status' }, { status: 400 });
  }

  const currentRow = await pool.query(
    `SELECT intake_status FROM patients WHERE id = $1`,
    [patientId]
  );
  if (currentRow.rows.length === 0) {
    return NextResponse.json({ error: 'Beteg nem található' }, { status: 404 });
  }

  const currentStatus = currentRow.rows[0].intake_status ?? 'JUST_REGISTERED';

  const allowedTransitions = VALID_INTAKE_TRANSITIONS[currentStatus] ?? [];
  if (!allowedTransitions.includes(targetStatus) && !isAdminOverride) {
    return NextResponse.json(
      {
        error: `Érvénytelen átmenet: ${currentStatus} → ${targetStatus}. Engedélyezett: ${allowedTransitions.join(', ') || 'nincs'}`,
        currentStatus,
        allowedTransitions,
      },
      { status: 400 }
    );
  }

  if (isAdminOverride && auth.role !== 'admin') {
    return NextResponse.json(
      { error: 'Csak admin végezhet override-ot' },
      { status: 403 }
    );
  }

  await pool.query(
    `UPDATE patients SET intake_status = $1 WHERE id = $2`,
    [targetStatus, patientId]
  );

  if (isAdminOverride) {
    await pool.query(
      `INSERT INTO intake_status_overrides (patient_id, from_status, to_status, overridden_by, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [patientId, currentStatus, targetStatus, auth.email, reason]
    );
  }

  return NextResponse.json({
    intakeStatus: targetStatus,
    previousStatus: currentStatus,
    isOverride: isAdminOverride,
  });
});
